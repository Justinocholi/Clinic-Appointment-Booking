import assert from 'assert';
import {
  callReset,
  callCreateBooking,
} from './test-helper';

export async function runLevel5Tests() {
  console.log('\n--- Running Level 5 Tests: Rate Limiting ---');

  // Create 10 future slots
  const slots = Array.from({ length: 10 }, (_, i) => ({
    id: `s_rl_${i + 1}`,
    provider: 'Dr RateLimit',
    start: new Date(Date.now() + (i + 1) * 3600 * 1000).toISOString(),
    end: new Date(Date.now() + (i + 1) * 3600 * 1000 + 30 * 60 * 1000).toISOString(),
  }));

  await callReset(slots);

  const testEmail = 'ratelimit.test@example.com';
  const otherEmail = 'other.patient@example.com';

  console.log('Test 5.1: Send 5 attempts for test email (allowed within 1 minute)');
  for (let i = 1; i <= 5; i++) {
    const res = await callCreateBooking({
      slot_id: `s_rl_${i}`,
      name: 'Rate Limit Tester',
      email: testEmail,
    });
    assert.strictEqual(
      res.status,
      201,
      `Attempt ${i} should succeed with 201, got ${res.status}`
    );
  }
  console.log('✓ 5 attempts succeeded within the minute window');

  console.log('Test 5.2: 6th attempt for the same email must return 429 with Retry-After header');
  const res6 = await callCreateBooking({
    slot_id: 's_rl_6',
    name: 'Rate Limit Tester',
    email: testEmail,
  });

  assert.strictEqual(res6.status, 429, `6th attempt must return 429, got ${res6.status}`);
  assert.ok(res6.data.error, 'Should contain error object');
  
  const retryAfter = res6.headers.get('retry-after');
  assert.ok(retryAfter, 'Response must include Retry-After header');
  const retryAfterSec = parseInt(retryAfter, 10);
  assert.ok(!isNaN(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 60, `Retry-After must be a positive integer in seconds <= 60, got ${retryAfter}`);
  console.log(`✓ 6th attempt rejected with 429 and Retry-After: ${retryAfterSec} seconds`);

  console.log('Test 5.3: Other emails are unaffected by the first email\'s rate limit');
  const otherRes = await callCreateBooking({
    slot_id: 's_rl_6',
    name: 'Other Patient',
    email: otherEmail,
  });
  assert.strictEqual(
    otherRes.status,
    201,
    `Other email must succeed with 201, got ${otherRes.status}`
  );
  console.log('✓ Other email succeeded with 201 (rate limit is per-email)');

  console.log('Test 5.4: Failed attempts are also counted towards the rate limit');
  const failEmail = 'fail.tester@example.com';
  // Send 5 failed attempts (slot does not exist: 404)
  for (let i = 1; i <= 5; i++) {
    const failRes = await callCreateBooking({
      slot_id: 'non_existent_slot',
      name: 'Fail Tester',
      email: failEmail,
    });
    assert.strictEqual(failRes.status, 404);
  }
  // The 6th attempt (even for a valid slot) must be rate limited with 429!
  const failRes6 = await callCreateBooking({
    slot_id: 's_rl_7',
    name: 'Fail Tester',
    email: failEmail,
  });
  assert.strictEqual(
    failRes6.status,
    429,
    `6th attempt after 5 failed attempts must return 429, got ${failRes6.status}`
  );
  assert.ok(failRes6.headers.get('retry-after'));
  console.log('✓ Failed attempts properly counted; 6th attempt returned 429');

  console.log('★ LEVEL 5 ALL TESTS PASSED ★\n');
}

if (require.main === module) {
  runLevel5Tests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Level 5 tests failed:', err);
      process.exit(1);
    });
}
