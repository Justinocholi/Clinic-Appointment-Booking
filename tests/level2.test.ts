import assert from 'assert';
import {
  callReset,
  callGetSlots,
  callCreateBooking,
  callGetBooking,
  API_KEY,
} from './test-helper';

export async function runLevel2Tests() {
  console.log('\n--- Running Level 2 Tests: Security and Validation ---');

  const pastSlot = {
    id: 's_past',
    provider: 'Dr Past',
    start: new Date(Date.now() - 3600 * 1000).toISOString(), // 1 hour ago
    end: new Date(Date.now() - 1800 * 1000).toISOString(),
  };

  const futureSlot = {
    id: 's_future',
    provider: 'Dr Future',
    start: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), // 1 day in future
    end: new Date(Date.now() + 24 * 3600 * 1000 + 30 * 60 * 1000).toISOString(),
  };

  // Reset with past and future slot
  const resetRes = await callReset([pastSlot, futureSlot]);
  assert.strictEqual(resetRes.status, 200);

  // 1. Test missing X-API-Key header -> 401
  console.log('Test 2.1: Request with missing X-API-Key returns 401');
  const noKeySlots = await callGetSlots(undefined, null);
  assert.strictEqual(noKeySlots.status, 401, `Missing API key should return 401, got ${noKeySlots.status}`);
  assert.ok(noKeySlots.data.error, 'Should contain error object');

  const noKeyBook = await callCreateBooking(
    { slot_id: 's_future', name: 'Test', email: 'test@example.com' },
    { apiKey: null }
  );
  assert.strictEqual(noKeyBook.status, 401, `Missing API key on booking should return 401, got ${noKeyBook.status}`);
  console.log('✓ Missing API key rejected with 401');

  // 2. Test wrong X-API-Key header -> 401
  console.log('Test 2.2: Request with wrong X-API-Key returns 401');
  const wrongKeySlots = await callGetSlots(undefined, 'wrong-secret-key-1234');
  assert.strictEqual(wrongKeySlots.status, 401, `Wrong API key should return 401, got ${wrongKeySlots.status}`);
  console.log('✓ Wrong API key rejected with 401');

  // 3. Test missing required fields -> 400
  console.log('Test 2.3: Reject missing or empty required fields with 400');
  
  // Missing slot_id
  const noSlot = await callCreateBooking({ name: 'Ada', email: 'ada@example.com' });
  assert.strictEqual(noSlot.status, 400, `Missing slot_id should return 400, got ${noSlot.status}`);
  assert.ok(noSlot.data.error);

  // Empty slot_id
  const emptySlot = await callCreateBooking({ slot_id: '   ', name: 'Ada', email: 'ada@example.com' });
  assert.strictEqual(emptySlot.status, 400, `Empty slot_id should return 400, got ${emptySlot.status}`);

  // Missing name
  const noName = await callCreateBooking({ slot_id: 's_future', email: 'ada@example.com' });
  assert.strictEqual(noName.status, 400, `Missing name should return 400, got ${noName.status}`);

  // Empty name
  const emptyName = await callCreateBooking({ slot_id: 's_future', name: '   ', email: 'ada@example.com' });
  assert.strictEqual(emptyName.status, 400, `Empty name should return 400, got ${emptyName.status}`);

  // Missing email
  const noEmail = await callCreateBooking({ slot_id: 's_future', name: 'Ada' });
  assert.strictEqual(noEmail.status, 400, `Missing email should return 400, got ${noEmail.status}`);

  // Empty email
  const emptyEmail = await callCreateBooking({ slot_id: 's_future', name: 'Ada', email: '   ' });
  assert.strictEqual(emptyEmail.status, 400, `Empty email should return 400, got ${emptyEmail.status}`);

  console.log('✓ Missing and empty fields properly rejected with 400');

  // 4. Test invalid email formatting -> 400
  console.log('Test 2.4: Reject invalid email addresses with 400');
  const invalidEmails = ['notanemail', 'plainaddress', '@missingusername.com', 'username@.com', 'user@domain'];
  for (const badEmail of invalidEmails) {
    const res = await callCreateBooking({ slot_id: 's_future', name: 'Ada', email: badEmail });
    assert.strictEqual(res.status, 400, `Invalid email "${badEmail}" should return 400, got ${res.status}`);
  }
  console.log('✓ Invalid email addresses properly rejected with 400');

  // 5. Test slot does not exist -> 404
  console.log('Test 2.5: Booking a non-existent slot returns 404');
  const nonExistentSlot = await callCreateBooking({
    slot_id: 'slot_does_not_exist_999',
    name: 'Ada Obi',
    email: 'ada@example.com',
  });
  assert.strictEqual(nonExistentSlot.status, 404, `Non-existent slot should return 404, got ${nonExistentSlot.status}`);
  assert.ok(nonExistentSlot.data.error);
  console.log('✓ Non-existent slot returns 404 with error message');

  // 6. Test slot has already started -> 400
  console.log('Test 2.6: Booking a slot that has already started returns 400');
  const pastBooking = await callCreateBooking({
    slot_id: 's_past',
    name: 'Ada Obi',
    email: 'ada@example.com',
  });
  assert.strictEqual(pastBooking.status, 400, `Slot already started should return 400, got ${pastBooking.status}`);
  assert.ok(pastBooking.data.error);
  console.log('✓ Slot in the past returns 400 with error message');

  // 7. Test trimming of name and lowercasing of email
  console.log('Test 2.7: Name is trimmed and email is stored in lowercase');
  const formatSlot = {
    id: 's_format',
    provider: 'Dr Format',
    start: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    end: new Date(Date.now() + 72 * 3600 * 1000 + 30 * 60 * 1000).toISOString(),
  };
  await callReset([formatSlot]);

  const untrimmedBook = await callCreateBooking({
    slot_id: 's_format',
    name: '   Ada Lovelace   ',
    email: '   ADA.LOVELACE@EXAMPLE.COM   ',
  });
  assert.strictEqual(untrimmedBook.status, 201);
  assert.strictEqual(untrimmedBook.data.name, 'Ada Lovelace', 'Name should be trimmed');
  assert.strictEqual(untrimmedBook.data.email, 'ada.lovelace@example.com', 'Email should be trimmed and lowercase');

  // Verify retrieved booking reflects trimmed name and lowercase email
  const verifyBooking = await callGetBooking(untrimmedBook.data.id);
  assert.strictEqual(verifyBooking.data.name, 'Ada Lovelace');
  assert.strictEqual(verifyBooking.data.email, 'ada.lovelace@example.com');
  console.log('✓ Name trimmed and email lowercased and verified in persistence');

  console.log('★ LEVEL 2 ALL TESTS PASSED ★\n');
}

if (require.main === module) {
  runLevel2Tests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Level 2 tests failed:', err);
      process.exit(1);
    });
}
