import { NextRequest } from 'next/server';
import { POST as resetHandler } from '../app/reset/route';
import { GET as slotsHandler } from '../app/slots/route';
import { POST as createBookingHandler, GET as listBookingsHandler } from '../app/bookings/route';
import { GET as getBookingHandler, DELETE as cancelBookingHandler } from '../app/bookings/[id]/route';

export const API_KEY = process.env.API_KEY || 'koya-assessment-api-key-secret';
export const BASE_URL = 'http://localhost:3000';

export async function callReset(slots: any[], apiKey: string | null = API_KEY) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey !== null) {
    headers['X-API-Key'] = apiKey;
  }
  const req = new NextRequest(`${BASE_URL}/reset`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ slots }),
  });
  const res = await resetHandler(req);
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

export async function callGetSlots(provider?: string, apiKey: string | null = API_KEY) {
  const headers: Record<string, string> = {};
  if (apiKey !== null) {
    headers['X-API-Key'] = apiKey;
  }
  const url = provider ? `${BASE_URL}/slots?provider=${encodeURIComponent(provider)}` : `${BASE_URL}/slots`;
  const req = new NextRequest(url, {
    method: 'GET',
    headers,
  });
  const res = await slotsHandler(req);
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

export async function callCreateBooking(
  body: any,
  options: { apiKey?: string | null; idempotencyKey?: string } = {}
) {
  const { apiKey = API_KEY, idempotencyKey } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey !== null) {
    headers['X-API-Key'] = apiKey;
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  const req = new NextRequest(`${BASE_URL}/bookings`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await createBookingHandler(req);
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

export async function callGetBooking(id: string, apiKey: string | null = API_KEY) {
  const headers: Record<string, string> = {};
  if (apiKey !== null) {
    headers['X-API-Key'] = apiKey;
  }
  const req = new NextRequest(`${BASE_URL}/bookings/${id}`, {
    method: 'GET',
    headers,
  });
  const res = await getBookingHandler(req, { params: Promise.resolve({ id }) });
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

export async function callCancelBooking(id: string, apiKey: string | null = API_KEY) {
  const headers: Record<string, string> = {};
  if (apiKey !== null) {
    headers['X-API-Key'] = apiKey;
  }
  const req = new NextRequest(`${BASE_URL}/bookings/${id}`, {
    method: 'DELETE',
    headers,
  });
  const res = await cancelBookingHandler(req, { params: Promise.resolve({ id }) });
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

export async function callListBookings(
  params: { email?: string; limit?: any; cursor?: string },
  apiKey: string | null = API_KEY
) {
  const headers: Record<string, string> = {};
  if (apiKey !== null) {
    headers['X-API-Key'] = apiKey;
  }
  const url = new URL(`${BASE_URL}/bookings`);
  if (params.email !== undefined) url.searchParams.set('email', params.email);
  if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit));
  if (params.cursor !== undefined) url.searchParams.set('cursor', params.cursor);

  const req = new NextRequest(url.toString(), {
    method: 'GET',
    headers,
  });
  const res = await listBookingsHandler(req);
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}
