import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const testDir = path.resolve('tests/tier1_feature_coverage');
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.js'));

console.log(`🚀 Running ${files.length} test suites in ${testDir}...\n`);

let passed = 0;
let failed = 0;

for (const file of files) {
    const fullPath = path.join(testDir, file);
    process.stdout.write(`Testing ${file} ... `);
    try {
        execSync(`node "${fullPath}"`, { stdio: 'pipe' });
        console.log('✅ PASSED');
        passed++;
    } catch (err) {
        console.log('❌ FAILED');
        console.error(err.stdout ? err.stdout.toString() : err.message);
        failed++;
    }
}

console.log(`\n========================================`);
console.log(`Result: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
