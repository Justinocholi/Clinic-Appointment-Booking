import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '../../lib/auth';
import { withTransaction } from '../../lib/db';
import { Slot } from '../../types';

export async function POST(req: NextRequest) {
  const auth = validateApiKey(req);
  if (!auth.isValid) {
    return auth.response!;
  }

  try {
    const body = await req.json();
    if (!body || !Array.isArray(body.slots)) {
      return NextResponse.json(
        { error: 'Invalid request body: "slots" array is required' },
        { status: 400 }
      );
    }

    const slots: Slot[] = body.slots;

    await withTransaction(async (client) => {
      // Delete all bookings and slots
      await client.query('DELETE FROM bookings');
      await client.query('DELETE FROM slots');
      await client.query('DELETE FROM idempotency_keys');
      await client.query('DELETE FROM rate_limits');

      // Insert new slots (including slots in the past)
      for (const slot of slots) {
        if (!slot.id || !slot.provider || !slot.start || !slot.end) {
          throw new Error('Each slot must include id, provider, start, and end');
        }
        await client.query(
          `INSERT INTO slots (id, provider, start, "end")
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             provider = EXCLUDED.provider,
             start = EXCLUDED.start,
             "end" = EXCLUDED."end"`,
          [slot.id, slot.provider, new Date(slot.start).toISOString(), new Date(slot.end).toISOString()]
        );
      }
    });

    return NextResponse.json({ message: 'Done' }, { status: 200 });
  } catch (err: any) {
    console.error('Error in POST /reset:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to reset slots' },
      { status: 400 }
    );
  }
}
