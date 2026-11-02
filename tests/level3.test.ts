import assert from 'assert';
import {
  callReset,
  callGetSlots,
  callCreateBooking,
  callGetBooking,
  callCancelBooking,
} from './test-helper';

export async function runLevel3Tests() {
  console.log('\n--- Running Level 3 Tests: Booking Integrity & Concurrency ---');

  const slotA = {
    id: 's_integrity_a',
    provider: 'Dr Integrity',
    start: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    end: new Date(Date.now() + 24 * 3600 * 1000 + 30 * 60 * 1000).toISOString(),
  };

  const slotB = {
    id: 's_integrity_b',
    provider: 'Dr Race',
    start: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    end: new Date(Date.now() + 48 * 3600 * 1000 + 30 * 60 * 1000).toISOString(),
  };

  await callReset([slotA, slotB]);

  // Test 3.1: Sequential duplicate booking returns 409
  console.log('Test 3.1: Sequential duplicate booking returns 409');
  const book1 = await callCreateBooking({
    slot_id: 's_integrity_a',
    name: 'Patient 1',
    email: 'patient1@example.com',
  });
  assert.strictEqual(book1.status, 201, 'First booking should succeed');

  const book2 = await callCreateBooking({
    slot_id: 's_integrity_a',
    name: 'Patient 2',
    email: 'patient2@example.com',
  });
  assert.strictEqual(book2.status, 409, `Second booking for same slot should return 409, got ${book2.status}`);
  assert.ok(book2.data.error, 'Should contain error object');
  console.log('✓ Sequential duplicate booking rejected with 409');

  // Test 3.2: Simultaneous / Concurrent booking requests for the same slot
  console.log('Test 3.2: Simultaneous race condition - 10 concurrent requests for same slot');
  // Use unique emails so rate limiting (5 attempts/min/email) is not triggered
  const concurrentAttempts = Array.from({ length: 10 }, (_, i) => ({
    slot_id: 's_integrity_b',
    name: `Racer ${i + 1}`,
    email: `racer${i + 1}@example.com`,
  }));

  const results = await Promise.all(
    concurrentAttempts.map((body) => callCreateBooking(body))
  );

  const successes = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);

  assert.strictEqual(
    successes.length,
    1,
    `Exactly one concurrent request must succeed with 201 (got ${successes.length})`
  );
  assert.strictEqual(
    conflicts.length,
    9,
    `All other 9 concurrent requests must return 409 (got ${conflicts.length})`
  );
  console.log(`✓ Concurrency verified: exactly 1 succeeded (201) and 9 conflicted (409)`);

  // Verify slot is unavailable
  const slotsCheck = await callGetSlots();
  const slotBCheck = slotsCheck.data.slots.find((s: any) => s.id === 's_integrity_b');
  assert.strictEqual(slotBCheck.available, false, 'Slot B should be marked unavailable');
  console.log('✓ Slot marked unavailable after race winner booked');

  // Test 3.3: Booking cancellation (DELETE /bookings/{id})
  console.log('Test 3.3: Cancel booking frees the slot');
  const winnerBookingId = successes[0].data.id;
  const cancelRes = await callCancelBooking(winnerBookingId);
  assert.strictEqual(cancelRes.status, 200, `Cancellation should return 200, got ${cancelRes.status}`);
  assert.strictEqual(cancelRes.data.id, winnerBookingId);
  assert.strictEqual(cancelRes.data.status, 'cancelled');
  console.log('✓ Booking cancelled successfully (status: cancelled)');

  // Test 3.4: Cancelled slot becomes available again
  console.log('Test 3.4: Cancelled slot is available again for new bookings');
  const slotsAfterCancel = await callGetSlots();
  const slotBAvailable = slotsAfterCancel.data.slots.find((s: any) => s.id === 's_integrity_b');
  assert.strictEqual(slotBAvailable.available, true, 'Slot B should be available: true after cancellation');
  console.log('✓ Slot is now available: true');

  // Test 3.5: Slot can now be re-booked
  console.log('Test 3.5: Re-booking the freed slot succeeds');
  const rebookRes = await callCreateBooking({
    slot_id: 's_integrity_b',
    name: 'New Patient',
    email: 'newpatient@example.com',
  });
  assert.strictEqual(rebookRes.status, 201, `Re-booking freed slot should return 201, got ${rebookRes.status}`);
  console.log('✓ Freed slot successfully re-booked');

  // Test 3.6: Cancelling an already cancelled booking returns 409
  console.log('Test 3.6: Cancelling an already cancelled booking returns 409');
  const cancelAgainRes = await callCancelBooking(winnerBookingId);
  assert.strictEqual(cancelAgainRes.status, 409, `Cancelling already cancelled booking should return 409, got ${cancelAgainRes.status}`);
  assert.ok(cancelAgainRes.data.error);
  console.log('✓ Already cancelled booking returns 409');

  // Test 3.7: Cancelling non-existent booking returns 404
  console.log('Test 3.7: Cancelling non-existent booking returns 404');
  const cancelNotFound = await callCancelBooking('b_does_not_exist_999');
  assert.strictEqual(cancelNotFound.status, 404, `Cancelling non-existent booking should return 404, got ${cancelNotFound.status}`);
  assert.ok(cancelNotFound.data.error);
  console.log('✓ Cancelling non-existent booking returns 404');

  console.log('★ LEVEL 3 ALL TESTS PASSED ★\n');
}

if (require.main === module) {
  runLevel3Tests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Level 3 tests failed:', err);
      process.exit(1);
    });
}
