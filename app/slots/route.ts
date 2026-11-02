import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '../../lib/auth';
import { query } from '../../lib/db';
import { SlotWithAvailability } from '../../types';

export async function GET(req: NextRequest) {
  const auth = validateApiKey(req);
  if (!auth.isValid) {
    return auth.response!;
  }

  try {
    const provider = req.nextUrl.searchParams.get('provider');

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

    if (provider !== null && provider !== undefined && provider.trim() !== '') {
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

    return NextResponse.json({ slots }, { status: 200 });
  } catch (err: any) {
    console.error('Error in GET /slots:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
