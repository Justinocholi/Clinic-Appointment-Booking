import assert from 'assert';
import { callReset, callGetSlots, callCreateBooking, callGetBooking } from './test-helper';

export async function runLevel1Tests() {
  console.log('\n--- Running Level 1 Tests: Basic Booking ---');

  // Future slots for testing
  const futureSlot1 = {
    id: 's1',
    provider: 'Dr Ade',
    start: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    end: new Date(Date.now() + 24 * 3600 * 1000 + 30 * 60 * 1000).toISOString(),
  };
  const futureSlot2 = {
    id: 's2',
    provider: 'Dr Smith',
    start: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    end: new Date(Date.now() + 48 * 3600 * 1000 + 30 * 60 * 1000).toISOString(),
  };

  // Test 1: Reset slots
  console.log('Test 1.1: Reset slots with initial data');
  const resetRes = await callReset([futureSlot1, futureSlot2]);
  assert.strictEqual(resetRes.status, 200, `Reset should return 200, got ${resetRes.status}`);
  console.log('✓ Reset successful');

  // Test 2: List slots
  console.log('Test 1.2: Retrieve available appointment slots');
  const slotsRes = await callGetSlots();
  assert.strictEqual(slotsRes.status, 200, `Get slots should return 200, got ${slotsRes.status}`);
  assert.ok(Array.isArray(slotsRes.data.slots), 'slots should be an array');
  assert.strictEqual(slotsRes.data.slots.length, 2, 'Should return 2 slots');
  assert.strictEqual(slotsRes.data.slots[0].id, 's1');
  assert.strictEqual(slotsRes.data.slots[0].available, true, 'Slot should be available initially');
  console.log('✓ Slots retrieved successfully with available: true');

  // Test 3: Provider filter
  console.log('Test 1.3: Filter slots by provider');
  const filteredRes = await callGetSlots('Dr Ade');
  assert.strictEqual(filteredRes.status, 200);
  assert.strictEqual(filteredRes.data.slots.length, 1);
  assert.strictEqual(filteredRes.data.slots[0].provider, 'Dr Ade');
  console.log('✓ Provider filtering works');

  // Test 4: Book an available slot
  console.log('Test 1.4: Allow patients to book an available slot');
  const bookRes = await callCreateBooking({
    slot_id: 's1',
    name: 'Ada Obi',
    email: 'ada@example.com',
  });
  assert.strictEqual(bookRes.status, 201, `Booking should return 201, got ${bookRes.status} (${JSON.stringify(bookRes.data)})`);
  assert.ok(bookRes.data.id, 'Booking should return an id');
  assert.strictEqual(bookRes.data.slot_id, 's1');
  assert.strictEqual(bookRes.data.name, 'Ada Obi');
  assert.strictEqual(bookRes.data.email, 'ada@example.com');
  assert.strictEqual(bookRes.data.status, 'confirmed');
  assert.ok(bookRes.data.created_at, 'created_at should be present');
  console.log(`✓ Booking created successfully with id ${bookRes.data.id}`);

  const bookingId = bookRes.data.id;

  // Test 5: Slot availability updated
  console.log('Test 1.5: Slot is marked unavailable after booking');
  const updatedSlotsRes = await callGetSlots();
  const s1 = updatedSlotsRes.data.slots.find((s: any) => s.id === 's1');
  assert.strictEqual(s1.available, false, 'Booked slot s1 should now be available: false');
  console.log('✓ Slot availability correctly updated to false');

  // Test 6: Retrieve booking details using specified identifier
  console.log('Test 1.6: Retrieve booking details by id');
  const getBookingRes = await callGetBooking(bookingId);
  assert.strictEqual(getBookingRes.status, 200, `Get booking should return 200, got ${getBookingRes.status}`);
  assert.strictEqual(getBookingRes.data.id, bookingId);
  assert.strictEqual(getBookingRes.data.slot_id, 's1');
  assert.strictEqual(getBookingRes.data.status, 'confirmed');
  console.log('✓ Booking details retrieved successfully');

  // Test 7: Non-existent booking returns 404
  console.log('Test 1.7: Non-existent booking returns 404');
  const notFoundRes = await callGetBooking('b_non_existent_123');
  assert.strictEqual(notFoundRes.status, 404, `Non-existent booking should return 404, got ${notFoundRes.status}`);
  assert.ok(notFoundRes.data.error, 'Should return error message');
  console.log('✓ Non-existent booking returns 404 with error message');

  console.log('★ LEVEL 1 ALL TESTS PASSED ★\n');
}

if (require.main === module) {
  runLevel1Tests().catch((err) => {
    console.error('Level 1 tests failed:', err);
    process.exit(1);
  });
}
