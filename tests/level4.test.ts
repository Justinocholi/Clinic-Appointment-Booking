import assert from 'assert';
import {
  callReset,
  callCreateBooking,
  callListBookings,
} from './test-helper';
import { query } from '../lib/db';

export async function runLevel4Tests() {
  console.log('\n--- Running Level 4 Tests: Reliability (Idempotency & Pagination) ---');

  // Generate 15 future slots for pagination tests
  const slots = Array.from({ length: 15 }, (_, i) => ({
    id: `s_p_${i + 1}`,
    provider: 'Dr Pagination',
    start: new Date(Date.now() + (i + 1) * 3600 * 1000).toISOString(),
    end: new Date(Date.now() + (i + 1) * 3600 * 1000 + 30 * 60 * 1000).toISOString(),
  }));

  await callReset(slots);

  // --- PART 1: IDEMPOTENCY ---
  console.log('Test 4.1: Idempotent request with same key and body returns same response');
  const idemKey = 'idemp_key_abc_123';
  const initialBody = {
    slot_id: 's_p_1',
    name: 'Idempotent User',
    email: 'idemp@example.com',
  };

  const req1 = await callCreateBooking(initialBody, { idempotencyKey: idemKey });
  assert.strictEqual(req1.status, 201, `First request should return 201, got ${req1.status}`);
  const firstBookingId = req1.data.id;
  assert.ok(firstBookingId);

  // Send exact same request with same key
  const req2 = await callCreateBooking(initialBody, { idempotencyKey: idemKey });
  assert.strictEqual(req2.status, 201, `Second request should replay with 201, got ${req2.status}`);
  assert.strictEqual(req2.data.id, firstBookingId, 'Second request must return the exact same booking id');
  assert.strictEqual(req2.data.slot_id, 's_p_1');
  console.log('✓ Idempotent replay successful with same status and booking id');

  // Test 4.2: Same key with a different body returns 422
  console.log('Test 4.2: Same Idempotency-Key with different body returns 422');
  const differentBody = {
    slot_id: 's_p_2', // different slot!
    name: 'Idempotent User',
    email: 'idemp@example.com',
  };
  const reqDifferent = await callCreateBooking(differentBody, { idempotencyKey: idemKey });
  assert.strictEqual(
    reqDifferent.status,
    422,
    `Reused key with different body should return 422, got ${reqDifferent.status}`
  );
  assert.ok(reqDifferent.data.error, 'Should contain error object');
  console.log('✓ Reused Idempotency-Key with different body correctly returned 422');

  // --- PART 2: PAGINATION ---
  console.log('Test 4.3: Populate 7 bookings for a patient with distinct timestamps');
  const patientEmail = 'pagination.patient@example.com';

  // Seed 7 bookings directly into DB with sequential created_at timestamps
  const baseTime = Date.now() - 7 * 60 * 60 * 1000; // 7 hours ago
  for (let i = 2; i <= 8; i++) {
    const bookingTime = new Date(baseTime + i * 30 * 60 * 1000).toISOString();
    await query(
      `INSERT INTO bookings (id, slot_id, name, email, status, created_at)
       VALUES ($1, $2, $3, $4, 'confirmed', $5)`,
      [`b_pag_${i}`, `s_p_${i}`, 'Pagination Patient', patientEmail, bookingTime]
    );
  }
  console.log('✓ 7 bookings seeded for pagination');

  // Test 4.4: Case-insensitive email query and default limit
  console.log('Test 4.4: List bookings with case-insensitive email match');
  const listAll = await callListBookings({ email: 'PAGINATION.PATIENT@EXAMPLE.COM' });
  assert.strictEqual(listAll.status, 200);
  assert.strictEqual(listAll.data.bookings.length, 7, 'Should find all 7 bookings regardless of casing');
  assert.strictEqual(listAll.data.next_cursor, null, 'next_cursor should be null when all items fit in 1 page');
  console.log('✓ Case-insensitive email lookup works');

  // Test 4.5: Oldest first ordering
  console.log('Test 4.5: Verify oldest-first ordering');
  for (let i = 0; i < listAll.data.bookings.length - 1; i++) {
    const tCurrent = new Date(listAll.data.bookings[i].created_at).getTime();
    const tNext = new Date(listAll.data.bookings[i + 1].created_at).getTime();
    assert.ok(tCurrent <= tNext, 'Bookings must be ordered oldest first (created_at ASC)');
  }
  console.log('✓ Oldest first ordering verified');

  // Test 4.6: Cursor pagination (page size = 3)
  console.log('Test 4.6: Cursor pagination across multiple pages');
  // Page 1 (limit: 3)
  const page1 = await callListBookings({ email: patientEmail, limit: 3 });
  assert.strictEqual(page1.status, 200);
  assert.strictEqual(page1.data.bookings.length, 3, 'Page 1 should have 3 items');
  assert.ok(page1.data.next_cursor, 'Page 1 should have next_cursor');

  // Page 2 (limit: 3, cursor: page1.next_cursor)
  const page2 = await callListBookings({ email: patientEmail, limit: 3, cursor: page1.data.next_cursor });
  assert.strictEqual(page2.status, 200);
  assert.strictEqual(page2.data.bookings.length, 3, 'Page 2 should have 3 items');
  assert.ok(page2.data.next_cursor, 'Page 2 should have next_cursor');

  // Verify no overlap between Page 1 and Page 2
  const page1Ids = page1.data.bookings.map((b: any) => b.id);
  const page2Ids = page2.data.bookings.map((b: any) => b.id);
  for (const id of page2Ids) {
    assert.ok(!page1Ids.includes(id), `Page 2 item ${id} should not appear in Page 1`);
  }

  // Page 3 (limit: 3, cursor: page2.next_cursor) -> remaining 1 item
  const page3 = await callListBookings({ email: patientEmail, limit: 3, cursor: page2.data.next_cursor });
  assert.strictEqual(page3.status, 200);
  assert.strictEqual(page3.data.bookings.length, 1, 'Page 3 should have remaining 1 item');
  assert.strictEqual(page3.data.next_cursor, null, 'Last page must have next_cursor: null');
  console.log('✓ Multi-page cursor pagination traverses all items without duplicates');

  // Test 4.7: Invalid pagination parameters
  console.log('Test 4.7: Handle invalid pagination parameters with 400');
  
  // Missing email
  const noEmail = await callListBookings({});
  assert.strictEqual(noEmail.status, 400, 'Missing email should return 400');

  // Limit < 1
  const zeroLimit = await callListBookings({ email: patientEmail, limit: 0 });
  assert.strictEqual(zeroLimit.status, 400, 'limit=0 should return 400');

  const negativeLimit = await callListBookings({ email: patientEmail, limit: -5 });
  assert.strictEqual(negativeLimit.status, 400, 'limit=-5 should return 400');

  // Limit > 50
  const overLimit = await callListBookings({ email: patientEmail, limit: 51 });
  assert.strictEqual(overLimit.status, 400, 'limit=51 should return 400');

  // Non-numeric limit
  const stringLimit = await callListBookings({ email: patientEmail, limit: 'ten' });
  assert.strictEqual(stringLimit.status, 400, 'Non-numeric limit should return 400');

  // Invalid cursor
  const badCursor = await callListBookings({ email: patientEmail, cursor: 'not-valid-base64-json' });
  assert.strictEqual(badCursor.status, 400, 'Invalid cursor should return 400');

  console.log('✓ Invalid pagination parameters properly rejected with 400');

  console.log('★ LEVEL 4 ALL TESTS PASSED ★\n');
}

if (require.main === module) {
  runLevel4Tests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Level 4 tests failed:', err);
      process.exit(1);
    });
}
