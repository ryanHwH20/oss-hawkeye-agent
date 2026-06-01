// Quick integration test — calls checkPackage directly and prints the formatted report
import { checkPackage } from '../src/checker.js';
import { formatResult } from '../src/formatter.js';
import { loadPolicy } from '../src/policy.js';

const policy = loadPolicy();

console.error('🔍 Testing inspect_package: NPM::lodash@latest...\n');

try {
  const result = await checkPackage('NPM', 'lodash', undefined, policy);
  const report = formatResult(result);
  console.log(report);
  console.error('\n✅ Test completed successfully.');
} catch (err) {
  console.error(`\n❌ Test failed: ${err}`);
  process.exit(1);
}
