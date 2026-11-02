-- Clinic Booking Database Schema

-- 1. Slots table
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  start TIMESTAMPTZ NOT NULL,
  "end" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slots_start ON slots (start ASC);
CREATE INDEX IF NOT EXISTS idx_slots_provider ON slots (provider);

-- 2. Bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Database-level protection against duplicate active bookings
-- Partial unique index ensures only ONE active (confirmed) booking exists per slot at any time
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_booking_per_slot 
ON bookings (slot_id) 
WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_bookings_email_created 
ON bookings (LOWER(email), created_at ASC, id ASC);

-- 3. Idempotency records
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  status_code INT NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Rate-limit tracking records
CREATE TABLE IF NOT EXISTS rate_limits (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_email_created 
ON rate_limits (email, created_at DESC);
