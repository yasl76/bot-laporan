import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTestSandbox } from '../helpers/test_fixture_helper.js';
import { addNumber, loadWhitelist } from '../../whitelist_helper.js';

export async function runTests() {
    console.log('--- Running Tier 1: Feature 5 (R2.2 LID Persistence) ---');
    const sandbox = createTestSandbox('feat05_lid_');
    const origCwd = process.cwd();

    try {
        process.chdir(sandbox.path);

        // Test 5.1: addNumber persists both phone number and LID
        {
            const res = addNumber('081234567890', 'Budi Kasir', '215633832722432@lid');
            assert.strictEqual(res.success, true, 'Case 5.1: addNumber should succeed');

            const data = loadWhitelist();
            const user = data.users.find(u => u.number === '6281234567890');
            assert.ok(user, 'User must exist in whitelist');
            assert.strictEqual(user.name, 'Budi Kasir');
            assert.strictEqual(user.lid, '215633832722432', 'LID must be stored and normalized');
            console.log('  ✔ Case 5.1: addNumber successfully persists phone number and resolved LID');
        }

        // Test 5.2: addNumber links LID to an existing user without LID
        {
            // First register without LID
            addNumber('087711223344', 'Siti Pramuniaga');
            let data = loadWhitelist();
            let user = data.users.find(u => u.number === '6287711223344');
            assert.ok(user);
            assert.ok(!user.lid, 'LID should initially be empty/falsy');

            // Now re-add with LID
            const linkRes = addNumber('087711223344', 'Siti Pramuniaga', '168779396993221');
            assert.strictEqual(linkRes.success, true, 'Should successfully link LID');

            data = loadWhitelist();
            user = data.users.find(u => u.number === '6287711223344');
            assert.strictEqual(user.lid, '168779396993221', 'LID should now be attached');
            console.log('  ✔ Case 5.2: addNumber links LID to an existing user previously lacking LID');
        }

        // Test 5.3: addNumber rejects invalid short numbers (< 9 digits)
        {
            const res = addNumber('12345', 'Invalid Short Number');
            assert.strictEqual(res.success, false, 'Should reject invalid short number');
            console.log('  ✔ Case 5.3: addNumber rejects invalid/too-short phone numbers');
        }

        // Test 5.4: addNumber without LID creates user with null/undefined lid
        {
            const res = addNumber('085233445566', 'Joko Staff');
            assert.strictEqual(res.success, true);

            const data = loadWhitelist();
            const user = data.users.find(u => u.number === '6285233445566');
            assert.ok(user);
            assert.strictEqual(user.lid || null, null);
            console.log('  ✔ Case 5.4: addNumber without LID properly defaults LID to null');
        }

        // Test 5.5: Persistence integrity through disk reload
        {
            const rawContent = fs.readFileSync('whitelist.json', 'utf8');
            const parsed = JSON.parse(rawContent);
            const userWithLid = parsed.users.find(u => u.number === '6281234567890');
            assert.strictEqual(userWithLid.lid, '215633832722432', 'Direct JSON read confirms LID persisted');
            console.log('  ✔ Case 5.5: Reloading whitelist directly from disk verifies complete persistence');
        }

        return { passed: 5, failed: 0, feature: 'Feature 5 (R2.2 LID Persistence)' };
    } finally {
        process.chdir(origCwd);
        sandbox.cleanup();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 5 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
