'use server';

import { query, withTransaction } from '../lib/db';
import { getExpectedApiKey } from '../lib/auth';
import { Booking, SlotWithAvailability } from '../types';
import crypto from 'crypto';

// Internal helper to get API key for server actions without client exposure
const API_KEY = getExpectedApiKey();

// Pre-seed sample slots if DB is completely fresh
async function seedDefaultSlotsIfEmpty() {
  const countRes = await query('SELECT COUNT(*) as count FROM slots');
  const count = parseInt(countRes.rows[0]?.count || '0', 10);
  if (count === 0) {
    const now = new Date();
    const providers = ['Dr Ade', 'Dr Folake', 'Dr Smith'];
    
    // Create sample slots for tomorrow and day after
    for (let dayOffset = 1; dayOffset <= 3; dayOffset++) {
      const baseDate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const hours = [9, 10, 11, 14, 15, 16];
      
      for (let h of hours) {
        const start = new Date(baseDate);
        start.setUTCHours(h, 0, 0, 0);
        const end = new Date(baseDate);
        end.setUTCHours(h, 30, 0, 0);
        
        const provider = providers[(dayOffset + h) % providers.length];
        const slotId = `slot_${dayOffset}_${h}`;
        
        await query(
          `INSERT INTO slots (id, provider, start, "end")
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [slotId, provider, start.toISOString(), end.toISOString()]
        );
      }
    }
  }
}

export async function getAvailableSlots(provider?: string): Promise<{ slots: SlotWithAvailability[]; error?: string }> {
  try {
    await seedDefaultSlotsIfEmpty();

    let sql = `
      SELECT 
        s.id,
        s.provider,
        s.start,
        s."end",
        CASE WHEN b.id IS NOT NULL THEN false ELSE true END AS available
      FROM slots s
      LEFT JOIN bookings b ON b.slot_id = s.id AND b.status = 'confirmed'
    `;
    const params: any[] = [];

    if (provider && provider !== 'all') {
      sql += ` WHERE s.provider = $1`;
      params.push(provider);
    }

    sql += ` ORDER BY s.start ASC, s.id ASC`;

    const res = await query(sql, params);
    const slots: SlotWithAvailability[] = res.rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      start: new Date(row.start).toISOString(),
      end: new Date(row.end).toISOString(),
      available: Boolean(row.available),
    }));

    return { slots };
  } catch (err: any) {
    return { slots: [], error: err.message || 'Failed to fetch slots' };
  }
}

export async function bookAppointment(data: {
  slot_id: string;
  name: string;
  email: string;
}): Promise<{ booking?: Booking; error?: string; status?: number }> {
  try {
    const { slot_id, name, email } = data;
    if (!slot_id || !name || !email) {
      return { error: 'All fields are required', status: 400 };
    }

    // Call internal bookings endpoint logic securely on server
    const trimmedSlotId = slot_id.trim();
    const trimmedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    // Check slot existence & start time
    const slotRes = await query('SELECT * FROM slots WHERE id = $1', [trimmedSlotId]);
    if (slotRes.rows.length === 0) {
      return { error: 'Slot does not exist', status: 404 };
    }

    const slot = slotRes.rows[0];
    if (new Date(slot.start).getTime() <= Date.now()) {
      return { error: 'This appointment slot has already started', status: 400 };
    }

    const bookingId = 'b_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);

    const booking = await withTransaction(async (client) => {
      const active = await client.query(
        `SELECT id FROM bookings WHERE slot_id = $1 AND status = 'confirmed'`,
        [trimmedSlotId]
      );
      if (active.rows.length > 0) {
        throw { status: 409, message: 'This slot has already been booked by another patient' };
      }

      const insertRes = await client.query(
        `INSERT INTO bookings (id, slot_id, name, email, status, created_at)
         VALUES ($1, $2, $3, $4, 'confirmed', NOW())
         RETURNING id, slot_id, name, email, status, created_at`,
        [bookingId, trimmedSlotId, trimmedName, normalizedEmail]
      );

      return insertRes.rows[0];
    });

    return {
      booking: {
        id: booking.id,
        slot_id: booking.slot_id,
        name: booking.name,
        email: booking.email,
        status: booking.status,
        created_at: new Date(booking.created_at).toISOString(),
      },
      status: 201,
    };
  } catch (err: any) {
    return {
      error: err.message || 'Booking failed',
      status: err.status || 500,
    };
  }
}

export async function lookupBooking(id: string): Promise<{ booking?: Booking; slot?: any; error?: string }> {
  try {
    const res = await query(
      `SELECT b.*, s.provider, s.start, s."end"
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       WHERE b.id = $1`,
      [id.trim()]
    );

    if (res.rows.length === 0) {
      return { error: 'No booking found with this reference number' };
    }

    const row = res.rows[0];
    return {
      booking: {
        id: row.id,
        slot_id: row.slot_id,
        name: row.name,
        email: row.email,
        status: row.status,
        created_at: new Date(row.created_at).toISOString(),
      },
      slot: {
        id: row.slot_id,
        provider: row.provider,
        start: new Date(row.start).toISOString(),
        end: new Date(row.end).toISOString(),
      },
    };
  } catch (err: any) {
    return { error: err.message || 'Failed to lookup booking' };
  }
}

export async function lookupPatientBookings(
  email: string,
  cursor?: string
): Promise<{ bookings: (Booking & { provider: string; start: string; end: string })[]; next_cursor: string | null; error?: string }> {
  try {
    let sql = `
      SELECT b.id, b.slot_id, b.name, b.email, b.status, b.created_at,
             s.provider, s.start, s."end"
      FROM bookings b
      JOIN slots s ON s.id = b.slot_id
      WHERE LOWER(b.email) = LOWER($1)
    `;
    const params: any[] = [email.trim()];

    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        if (decoded.created_at && decoded.id) {
          sql += ` AND (b.created_at > $2 OR (b.created_at = $2 AND b.id > $3))`;
          params.push(decoded.created_at, decoded.id);
        }
      } catch {}
    }

    sql += ` ORDER BY b.created_at ASC, b.id ASC LIMIT 11`;

    const res = await query(sql, params);
    const hasMore = res.rows.length > 10;
    const rows = hasMore ? res.rows.slice(0, 10) : res.rows;

    let next_cursor: string | null = null;
    if (hasMore && rows.length > 0) {
      const last = rows[rows.length - 1];
      next_cursor = Buffer.from(
        JSON.stringify({
          created_at: new Date(last.created_at).toISOString(),
          id: last.id,
        })
      ).toString('base64');
    }

    const bookings = rows.map((r) => ({
      id: r.id,
      slot_id: r.slot_id,
      name: r.name,
      email: r.email,
      status: r.status as 'confirmed' | 'cancelled',
      created_at: new Date(r.created_at).toISOString(),
      provider: r.provider,
      start: new Date(r.start).toISOString(),
      end: new Date(r.end).toISOString(),
    }));

    return { bookings, next_cursor };
  } catch (err: any) {
    return { bookings: [], next_cursor: null, error: err.message || 'Lookup failed' };
  }
}

export async function cancelAppointment(bookingId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
    if (res.rows.length === 0) {
      return { success: false, error: 'Booking not found' };
    }
    if (res.rows[0].status === 'cancelled') {
      return { success: false, error: 'Booking is already cancelled' };
    }

    await query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Cancellation failed' };
  }
}
