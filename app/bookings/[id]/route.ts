import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { Booking } from '../../../types';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = validateApiKey(req);
  if (!auth.isValid) {
    return auth.response!;
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Booking id is required' }, { status: 400 });
  }

  try {
    const res = await query(
      `SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return NextResponse.json(
        { error: 'No booking with that id' },
        { status: 404 }
      );
    }

    const row = res.rows[0];
    const booking: Booking = {
      id: row.id,
      slot_id: row.slot_id,
      name: row.name,
      email: row.email,
      status: row.status,
      created_at: new Date(row.created_at).toISOString(),
    };

    return NextResponse.json(booking, { status: 200 });
  } catch (err: any) {
    console.error('Error in GET /bookings/{id}:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = validateApiKey(req);
  if (!auth.isValid) {
    return auth.response!;
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Booking id is required' }, { status: 400 });
  }

  try {
    // 1. Fetch current booking status
    const res = await query(
      `SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return NextResponse.json(
        { error: 'No booking with that id' },
        { status: 404 }
      );
    }

    const current = res.rows[0];

    // 2. Check if already cancelled
    if (current.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Already cancelled' },
        { status: 409 }
      );
    }

    // 3. Update status to cancelled, freeing the slot
    const updateRes = await query(
      `UPDATE bookings SET status = 'cancelled' WHERE id = $1
       RETURNING id, slot_id, name, email, status, created_at`,
      [id]
    );

    const updated = updateRes.rows[0];
    const booking: Booking = {
      id: updated.id,
      slot_id: updated.slot_id,
      name: updated.name,
      email: updated.email,
      status: updated.status,
      created_at: new Date(updated.created_at).toISOString(),
    };

    return NextResponse.json(booking, { status: 200 });
  } catch (err: any) {
    console.error('Error in DELETE /bookings/{id}:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
