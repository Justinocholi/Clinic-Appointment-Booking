# Clinic Appointment Booking API & Patient Portal

A production-ready clinic appointment booking system built to satisfy the **Koya AI Automation Developer assessment** specification ([Technical Specification](https://koyaacademy.com/assessment-api)).

---

## 🚀 Technical Stack

- **Framework**: Next.js 15 (App Router with Server Actions & Route Handlers)
- **Language**: TypeScript (Strict Mode)
- **Database**: PostgreSQL (Supabase / Postgres Connection Pooling)
- **Styling**: Tailwind CSS
- **Concurrency & Integrity**: PostgreSQL Partial Unique Index (`WHERE status = 'confirmed'`) + Database Transactions
- **Reliability & Idempotency**: SHA-256 Request Hashing with Replay Protection (Level 4)
- **Rate Limiting**: Server-side Distributed Rate Limiting (5 attempts/min/email) across instances
- **Testing**: Automated end-to-end integration test suite covering all 5 levels

---

## 📋 API Specification & Endpoint Compliance

Every endpoint strictly adheres to the OpenAPI 3.0.3 contract from `https://koyaacademy.com/assessment-api`. All error responses return `{ "error": "<message>" }`.

| Endpoint | Method | Level | Description | Key Status Codes |
|---|---|---|---|---|
| `/reset` | `POST` | Level 1 | Deletes all bookings and replaces all slots with the provided array (including past slots). | `200`, `401`, `400` |
| `/slots` | `GET` | Level 1 | Returns all slots ordered by earliest `start` first. Supports optional `?provider=` exact match query. Includes `available: boolean` (false while slot has a confirmed booking). | `200`, `401` |
| `/bookings` | `POST` | Levels 1–5 | Books an available slot. Validates required fields, rejects started slots (400), non-existent slots (404), double-bookings (409), enforces idempotency (422/replay), and rate limits (429 with `Retry-After`). | `201`, `400`, `401`, `404`, `409`, `422`, `429` |
| `/bookings/{id}` | `GET` | Level 1 | Retrieves booking details by unique identifier. | `200`, `401`, `404` |
| `/bookings/{id}` | `DELETE` | Level 3 | Cancels an active booking, setting status to `cancelled` and freeing the slot. Rejects already cancelled bookings with 409. | `200`, `401`, `404`, `409` |
| `/bookings` | `GET` | Level 4 | Lists a person's bookings by `?email=...`, oldest first (`created_at ASC`). Case-insensitive email match. Supports cursor pagination (`limit` 1–50, `cursor`, `next_cursor`). | `200`, `400`, `401` |

---

## 🛡️ Implementation of the 5 Levels

### Level 1: Basic Booking
- `POST /reset`: Clears bookings, idempotency logs, rate limits, and batch-inserts new slots.
- `GET /slots`: Computes availability dynamically based on active confirmed bookings.
- `POST /bookings`: Creates a confirmed booking and assigns a unique identifier (`b_...`).
- `GET /bookings/{id}`: Returns the booking record or 404.
- Frontend: Responsive UI displaying real-time available slots and appointment details.

### Level 2: Security & Validation
- `X-API-Key` Authentication: Enforced across all API endpoints via `lib/auth.ts`. Missing or invalid API key immediately returns HTTP `401` (`{ "error": "Unauthorized: Missing or invalid X-API-Key header" }`).
- Field Validation: Validates `slot_id`, `name`, and `email` on `POST /bookings`. Empty strings, missing keys, or whitespace-only inputs return HTTP `400`.
- Email Formatting: RFC 5322 regex checks valid email syntax; returns HTTP `400` on invalid email.
- Data Normalization: Automatically trims whitespace from `name` and `email`, and stores `email` in lowercase.
- Slot Validation: Non-existent slots return HTTP `404` (`{ "error": "Slot does not exist" }`). Slots that have already started (`start <= now()`) return HTTP `400` (`{ "error": "Slot has already started" }`).
- API Key Privacy: The private API key is never exposed to client-side bundles; frontend interactions utilize secure Next.js Server Actions.

### Level 3: Booking Integrity & Concurrency
- Database-Level Protection: A PostgreSQL partial unique index ensures only one confirmed booking can ever exist for a given slot:
  ```sql
  CREATE UNIQUE INDEX idx_unique_confirmed_booking_per_slot 
  ON bookings (slot_id) 
  WHERE status = 'confirmed';
  ```
- Simultaneous Request Handling: When concurrent requests attempt to book the same slot at the exact same millisecond, the database constraint atomically serializes the requests. Exactly one request succeeds with `201`, while all competing requests receive HTTP `409` (`{ "error": "Slot already booked" }`).
- Cancellation & Slot Recovery: `DELETE /bookings/{id}` sets `status = 'cancelled'`. Because the unique index only applies to `status = 'confirmed'`, cancelling a booking frees the slot immediately. Subsequent requests can re-book the slot.
- Duplicate Cancellation: Attempting to cancel an already cancelled booking returns HTTP `409` (`{ "error": "Already cancelled" }`).

### Level 4: Reliability (Idempotency & Pagination)
- Idempotency Header: Supports the optional `Idempotency-Key` header on `POST /bookings`.
  - Same key + same request payload: Returns the original booking response (identical status code `201` and same booking `id`) without creating a duplicate booking.
  - Same key + different request payload: Returns HTTP `422` (`{ "error": "Idempotency-Key reused with a different body" }`).
- Cursor Pagination: `GET /bookings?email=...&limit=...&cursor=...`
  - Case-insensitive email query (`LOWER(email) = LOWER(:email)`).
  - Ordered oldest first (`created_at ASC, id ASC`).
  - Strict parameter validation: `limit` must be an integer between 1 and 50 (inclusive); any other value returns HTTP `400`.
  - Cursor is an opaque base64-encoded pointer containing `{ created_at, id }`. Returns `next_cursor: null` on the final page.

### Level 5: Server-Side Rate Limiting
- Rate Limit Policy: At most 5 booking attempts per email per minute, **failed attempts included**.
- Threshold Enforcement: The 6th attempt returns HTTP `429` with:
  - Header: `Retry-After: <seconds>` (integer representing remaining seconds until the window frees up).
  - Body: `{ "error": "Too many attempts for this email" }`.
- Multi-Instance Support: Rate limits are persisted in the shared PostgreSQL database (`rate_limits` table) or Upstash Redis, guaranteeing distributed synchronization across all Vercel serverless instances. Other email addresses remain completely unaffected.

---

## 🗄️ Database Schema & Migrations

The database migration is located at [`migrations/001_init.sql`](file:///migrations/001_init.sql):

```sql
-- 1. Appointment Slots
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  start TIMESTAMPTZ NOT NULL,
  "end" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slots_start ON slots (start ASC);
CREATE INDEX IF NOT EXISTS idx_slots_provider ON slots (provider);

-- 2. Patient Bookings
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Crucial: Concurrency guard against double-bookings
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_booking_per_slot 
ON bookings (slot_id) 
WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_bookings_email_created 
ON bookings (LOWER(email), created_at ASC, id ASC);

-- 3. Idempotency Records
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  status_code INT NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Distributed Rate Limits
CREATE TABLE IF NOT EXISTS rate_limits (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_email_created 
ON rate_limits (email, created_at DESC);
```

---

## ⚙️ Environment Variables

Create a `.env.local` or configure the following environment variables in your deployment dashboard:

```env
# Required: The secret key expected in the X-API-Key request header
API_KEY=your_chosen_api_key_secret

# Supabase PostgreSQL Connection String (Session or Transaction Mode)
# Example: postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
DATABASE_URL=

# Optional: Upstash Redis for distributed rate limiting
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

> **Note on Zero-Config Local Development & Testing**:
> If `DATABASE_URL` is omitted, the application automatically uses an embedded PostgreSQL WASM engine (`@electric-sql/pglite`) executing real PostgreSQL transactions, constraints, and indexes in memory. This allows automated test suites and local development to run with zero external setup.

---

## 🧪 Automated Testing

The repository contains an automated end-to-end test suite testing each level sequentially:

```bash
# Run the complete test suite (Levels 1 through 5)
npm test
```

Individual test runners:
```bash
npx tsx tests/level1.test.ts # Level 1: Basic booking, slots, details
npx tsx tests/level2.test.ts # Level 2: API key rejection (401), validation (400), not found (404)
npx tsx tests/level3.test.ts # Level 3: 10 concurrent requests race condition (409), cancellation
npx tsx tests/level4.test.ts # Level 4: Idempotency replay, payload mismatch (422), cursor pagination
npx tsx tests/level5.test.ts # Level 5: Rate limit threshold (5 attempts/min), 429 & Retry-After header
```

---

## 📦 Deployment Instructions

### 1. Supabase Setup
1. Create a new project at [supabase.com](https://supabase.com).
2. Navigate to **Project Settings** → **Database** → **Connection string**.
3. Copy the URI string (URI mode, using `postgresql://...`).
4. Go to the **SQL Editor** in Supabase and run the SQL commands from [`migrations/001_init.sql`](file:///migrations/001_init.sql).

### 2. Vercel Deployment
1. Push this repository to GitHub or GitLab.
2. In [Vercel Dashboard](https://vercel.com), click **Add New** → **Project** and import the repository.
3. In **Environment Variables**, configure:
   - `API_KEY`: Set to your preferred secret key (e.g. `koya-assessment-api-key-secret`).
   - `DATABASE_URL`: Paste your Supabase PostgreSQL connection URI.
4. Click **Deploy**. Vercel will automatically build the Next.js project and deploy it with an HTTPS URL.

---

## 🖥️ Frontend Overview

The web interface is available at `/` and features:
- **Available Appointment Slots**: Real-time display of slots categorized by date and doctor.
- **Provider Filtering**: Filter slots by medical specialist or view all providers.
- **Patient Booking Form**: Client-side and server-side validation for patient name and email.
- **Booking Confirmation**: Displays unique booking reference ID with copy-to-clipboard functionality and appointment summary.
- **Lookup & Management**: Patients can search by booking reference ID or by email with multi-page cursor pagination.
- **Cancellation**: One-click cancellation with confirmation safeguards that immediately frees the slot for other patients.
