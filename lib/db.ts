import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
}

let pool: Pool | null = null;
let pgliteInstance: any = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

// Read migration SQL
function getMigrationSql(): string {
  try {
    const migrationPath = path.join(process.cwd(), 'migrations', '001_init.sql');
    if (fs.existsSync(migrationPath)) {
      return fs.readFileSync(migrationPath, 'utf8');
    }
  } catch (err) {
    console.error('Error reading migration file:', err);
  }
  // Fallback embedded schema
  return `
    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      start TIMESTAMPTZ NOT NULL,
      "end" TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_slots_start ON slots (start ASC);
    CREATE INDEX IF NOT EXISTS idx_slots_provider ON slots (provider);

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_booking_per_slot 
    ON bookings (slot_id) 
    WHERE status = 'confirmed';
    CREATE INDEX IF NOT EXISTS idx_bookings_email_created 
    ON bookings (LOWER(email), created_at ASC, id ASC);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      status_code INT NOT NULL,
      response_body JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limits_email_created 
    ON rate_limits (email, created_at DESC);
  `;
}

async function initDbInternal() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;

  if (connectionString) {
    if (!pool) {
      pool = new Pool({
        connectionString,
        ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
      });
    }
    const schemaSql = getMigrationSql();
    await pool.query(schemaSql);
  } else {
    if (!pgliteInstance) {
      const { PGlite } = await import('@electric-sql/pglite');
      // Store in memory or local data folder
      const dbPath = process.env.PGLITE_DATA_DIR || undefined;
      pgliteInstance = new PGlite(dbPath);
    }
    const schemaSql = getMigrationSql();
    await pgliteInstance.exec(schemaSql);
  }
  isInitialized = true;
}

export async function ensureDbInitialized(): Promise<void> {
  if (isInitialized) return;
  if (!initPromise) {
    initPromise = initDbInternal().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  await ensureDbInitialized();
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;

  if (connectionString && pool) {
    const res = await pool.query(text, params);
    return {
      rows: res.rows,
      rowCount: res.rowCount ?? res.rows.length,
    };
  } else if (pgliteInstance) {
    const res = await pgliteInstance.query(text, params);
    return {
      rows: res.rows,
      rowCount: res.rows.length,
    };
  }
  throw new Error('Database not initialized');
}

export async function withTransaction<T>(
  callback: (client: DbClient) => Promise<T>
): Promise<T> {
  await ensureDbInitialized();
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;

  if (connectionString && pool) {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const txClient: DbClient = {
        query: async (text: string, params?: any[]) => {
          const res = await client.query(text, params);
          return {
            rows: res.rows,
            rowCount: res.rowCount ?? res.rows.length,
          };
        },
      };
      const result = await callback(txClient);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else if (pgliteInstance) {
    return await pgliteInstance.transaction(async (tx: any) => {
      const txClient: DbClient = {
        query: async (text: string, params?: any[]) => {
          const res = await tx.query(text, params);
          return {
            rows: res.rows,
            rowCount: res.rows.length,
          };
        },
      };
      return await callback(txClient);
    });
  }
  throw new Error('Database not initialized');
}
