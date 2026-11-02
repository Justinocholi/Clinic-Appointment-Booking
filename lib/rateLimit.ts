import { query } from './db';

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number; // in whole seconds
}

export async function checkRateLimit(email: string): Promise<RateLimitResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxAttempts = 5;

  // Check recent attempts in the last 60 seconds from shared DB
  const res = await query(
    `SELECT created_at FROM rate_limits 
     WHERE email = $1 AND created_at >= NOW() - INTERVAL '60 seconds' 
     ORDER BY created_at ASC`,
    [normalizedEmail]
  );

  if (res.rows.length >= maxAttempts) {
    const oldest = new Date(res.rows[0].created_at).getTime();
    const remainingMs = oldest + windowMs - now;
    const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));
    return {
      allowed: false,
      retryAfter,
    };
  }

  // Record this attempt
  await query(
    `INSERT INTO rate_limits (email, created_at) VALUES ($1, NOW())`,
    [normalizedEmail]
  );

  // Background cleanup of expired records (older than 5 minutes)
  query(`DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '5 minutes'`).catch(() => {});

  return { allowed: true };
}
