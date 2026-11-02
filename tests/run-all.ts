import { runLevel1Tests } from './level1.test';
import { runLevel2Tests } from './level2.test';
import { runLevel3Tests } from './level3.test';
import { runLevel4Tests } from './level4.test';
import { runLevel5Tests } from './level5.test';

async function main() {
  console.log('====================================================');
  console.log(' KOYA CLINIC APPOINTMENT BOOKING API - TEST SUITE   ');
  console.log(' Verified against https://koyaacademy.com/assessment-api ');
  console.log('====================================================');

  const startTime = Date.now();

  try {
    await runLevel1Tests();
    await runLevel2Tests();
    await runLevel3Tests();
    await runLevel4Tests();
    await runLevel5Tests();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n====================================================');
    console.log(` ✅ ALL 5 LEVELS PASSED SUCCESSFULLY IN ${duration}s `);
    console.log(' Level 1: Basic booking (Reset, Slots, Book, Details)');
    console.log(' Level 2: Security & validation (API Key, Format, 400, 404)');
    console.log(' Level 3: Concurrency integrity & Cancellation (409)');
    console.log(' Level 4: Reliability (Idempotency & Cursor pagination)');
    console.log(' Level 5: Rate limiting (5 attempts/min/email, 429)');
    console.log('====================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test suite failed with error:', err);
    process.exit(1);
  }
}

main();
