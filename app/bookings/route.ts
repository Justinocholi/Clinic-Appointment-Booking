import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { validateApiKey } from '../../lib/auth';
import { query, withTransaction } from '../../lib/db';
import { checkRateLimit } from '../../lib/rateLimit';
import { hashRequestBody, checkIdempotency, saveIdempotency } from '../../lib/idempotency';
import { Booking } from '../../types';

// Email validation regex (RFC 5322 compatible pattern)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  // 1. API key authentication (Level 2)
  const auth = validateApiKey(req);
  if (!auth.isValid) {
    return auth.response!;
  }

  // 2. Parse request body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { slot_id, name, email } = body || {};

  // 3. Validation of required fields (Level 2)
  if (!slot_id || typeof slot_id !== 'string' || !slot_id.trim()) {
    return NextResponse.json(
      { error: 'slot_id is required' },
      { status: 400 }
    );
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json(
      { error: 'name is required' },
      { status: 400 }
    );
  }

  if (!email || typeof email !== 'string' || !email.trim()) {
    return NextResponse.json(
      { error: 'email is required' },
      { status: 400 }
    );
  }

  const trimmedSlotId = slot_id.trim();
  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  // Validate email format
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return NextResponse.json(
      { error: 'Invalid email format' },
      { status: 400 }
    );
  }

  // 4. Rate limiting (Level 5) - applies per email per minute, including failed attempts
  const rateLimit = await checkRateLimit(normalizedEmail);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts for this email' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfter || 60),
        },
      }
    );
  }

  // 5. Idempotency handling (Level 4)
  const idempotencyKey = req.headers.get('idempotency-key');
  let bodyHash = '';
  if (idempotencyKey) {
    bodyHash = hashRequestBody(body);
    const idempResult = await checkIdempotency(idempotencyKey, bodyHash);
    if (idempResult.found) {
      if (!idempResult.match) {
        // Idempotency key reused with a different body -> 422
        return NextResponse.json(
          { error: 'Idempotency-Key reused with a different body' },
          { status: 422 }
        );
      }
      // Replay stored response
      return NextResponse.json(idempResult.responseBody, { status: idempResult.statusCode });
    }
  }

  // 6. Check slot existence & start time (Level 2)
  const slotRes = await query(
    `SELECT id, provider, start, "end" FROM slots WHERE id = $1`,
    [trimmedSlotId]
  );

  if (slotRes.rows.length === 0) {
    return NextResponse.json(
      { error: 'Slot does not exist' },
      { status: 404 }
    );
  }

  const slot = slotRes.rows[0];
  const slotStart = new Date(slot.start).getTime();
  const now = Date.now();

  if (slotStart <= now) {
    return NextResponse.json(
      { error: 'Slot has already started' },
      { status: 400 }
    );
  }

  // 7. Atomic booking creation & Level 3 integrity
  try {
    const bookingId = 'b_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);

    const booking = await withTransaction(async (client) => {
      // Check if slot already has a confirmed booking
      const activeBooking = await client.query(
        `SELECT id FROM bookings WHERE slot_id = $1 AND status = 'confirmed'`,
        [trimmedSlotId]
      );

      if (activeBooking.rows.length > 0) {
        throw { status: 409, message: 'Slot already booked' };
      }

      // Insert new confirmed booking protected by unique partial index
      const insertRes = await client.query(
        `INSERT INTO bookings (id, slot_id, name, email, status, created_at)
         VALUES ($1, $2, $3, $4, 'confirmed', NOW())
         RETURNING id, slot_id, name, email, status, created_at`,
        [bookingId, trimmedSlotId, trimmedName, normalizedEmail]
      );

      return insertRes.rows[0];
    });

    const responseBooking: Booking = {
      id: booking.id,
      slot_id: booking.slot_id,
      name: booking.name,
      email: booking.email,
      status: booking.status,
      created_at: new Date(booking.created_at).toISOString(),
    };

    // Store in idempotency table if key was provided
    if (idempotencyKey) {
      await saveIdempotency(idempotencyKey, bodyHash, 201, responseBooking);
    }

    return NextResponse.json(responseBooking, { status: 201 });
  } catch (err: any) {
    if (err.status === 409 || err.code === '23505' || err.message?.includes('idx_unique_confirmed_booking_per_slot')) {
      return NextResponse.json(
        { error: 'Slot already booked' },
        { status: 409 }
      );
    }
    console.error('Error in POST /bookings:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  // 1. API key authentication (Level 2)
  const auth = validateApiKey(req);
  if (!auth.isValid) {
    return auth.response!;
  }

  const { searchParams } = req.nextUrl;
  const emailParam = searchParams.get('email');

  // Email is required
  if (!emailParam || !emailParam.trim()) {
    return NextResponse.json(
      { error: 'email query parameter is required' },
      { status: 400 }
    );
  }

  // Limit parsing (1 to 50, default 10)
  let limit = 10;
  if (searchParams.has('limit')) {
    const rawLimit = searchParams.get('limit')!;
    if (!/^\d+$/.test(rawLimit)) {
      return NextResponse.json(
        { error: 'Invalid limit: must be an integer between 1 and 50' },
        { status: 400 }
      );
    }
    limit = parseInt(rawLimit, 10);
    if (limit < 1 || limit > 50) {
      return NextResponse.json(
        { error: 'Invalid limit: must be between 1 and 50' },
        { status: 400 }
      );
    }
  }

  // Cursor handling
  const cursorParam = searchParams.get('cursor');
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;

  if (cursorParam) {
    try {
      const decoded = JSON.parse(Buffer.from(cursorParam, 'base64').toString('utf8'));
      if (decoded && decoded.created_at && decoded.id) {
        cursorCreatedAt = decoded.created_at;
        cursorId = decoded.id;
      } else {
        return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    }
  }

  try {
    let sql = `
      SELECT id, slot_id, name, email, status, created_at
      FROM bookings
      WHERE LOWER(email) = LOWER($1)
    `;
    const params: any[] = [emailParam.trim()];

    if (cursorCreatedAt && cursorId) {
      sql += ` AND (created_at > $2 OR (created_at = $2 AND id > $3))`;
      params.push(cursorCreatedAt, cursorId);
    }

    sql += ` ORDER BY created_at ASC, id ASC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const res = await query(sql, params);
    const hasMore = res.rows.length > limit;
    const pageRows = hasMore ? res.rows.slice(0, limit) : res.rows;

    let next_cursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      next_cursor = Buffer.from(
        JSON.stringify({
          created_at: new Date(last.created_at).toISOString(),
          id: last.id,
        })
      ).toString('base64');
    }

    const bookings: Booking[] = pageRows.map((row) => ({
      id: row.id,
      slot_id: row.slot_id,
      name: row.name,
      email: row.email,
      status: row.status,
      created_at: new Date(row.created_at).toISOString(),
    }));

    return NextResponse.json({ bookings, next_cursor }, { status: 200 });
  } catch (err: any) {
    console.error('Error in GET /bookings:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
