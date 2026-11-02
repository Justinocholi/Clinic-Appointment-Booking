import crypto from 'crypto';
import { query } from './db';

export function hashRequestBody(body: any): string {
  // Normalize key order by sorting keys if object
  const normalized = typeof body === 'object' && body !== null
    ? JSON.stringify(body, Object.keys(body).sort())
    : JSON.stringify(body);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export interface IdempotencyLookupResult {
  found: boolean;
  match?: boolean;
  statusCode?: number;
  responseBody?: any;
}

export async function checkIdempotency(key: string, bodyHash: string): Promise<IdempotencyLookupResult> {
  const res = await query(
    `SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE key = $1`,
    [key]
  );

  if (res.rows.length === 0) {
    return { found: false };
  }

  const record = res.rows[0];
  if (record.request_hash !== bodyHash) {
    return {
      found: true,
      match: false,
    };
  }

  return {
    found: true,
    match: true,
    statusCode: record.status_code,
    responseBody: typeof record.response_body === 'string' ? JSON.parse(record.response_body) : record.response_body,
  };
}

export async function saveIdempotency(key: string, bodyHash: string, statusCode: number, responseBody: any): Promise<void> {
  await query(
    `INSERT INTO idempotency_keys (key, request_hash, status_code, response_body, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (key) DO NOTHING`,
    [key, bodyHash, statusCode, JSON.stringify(responseBody)]
  );
}
