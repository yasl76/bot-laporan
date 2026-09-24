import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTestSandbox } from '../helpers/test_fixture_helper.js';
import { addNumber, isAllowed, isSuperAdmin, saveWhitelist, loadWhitelist } from '../../whitelist_helper.js';

export async function runTests() {
    console.log('--- Running Tier 1: Feature 6 (R2.3 Multi-Device LID Authorization) ---');
    const sandbox = createTestSandbox('feat06_lid_auth_');
    const origCwd = process.cwd();

    try {
        process.chdir(sandbox.path);

        // Setup test whitelist
        addNumber('081234567890', 'Budi Regular Admin', '111222333444@lid');
        
        // Add a super admin with LID
        const wl = loadWhitelist();
        wl.users.push({
            number: '628999888777',
            name: 'Boss Super Admin',
            role: 'super_admin',
            lid: '555666777888'
        });
        wl.super_admins.push('628999888777');
        saveWhitelist(wl);

        // Test 6.1: isAllowed returns true for registered phone number
        {
            const res = isAllowed('6281234567890@s.whatsapp.net');
            assert.strictEqual(res, true, 'Case 6.1: Registered phone number must be allowed');
            console.log('  ✔ Case 6.1: isAllowed returns true for registered user phone number');
        }

        // Test 6.2: isAllowed returns true for registered LID
        {
            const res = isAllowed('111222333444@lid');
            assert.strictEqual(res, true, 'Case 6.2: Registered user LID must be allowed');
            console.log('  ✔ Case 6.2: isAllowed returns true for registered user @lid');
        }

        // Test 6.3: isAllowed returns false for unwhitelisted phone and LID
        {
            assert.strictEqual(isAllowed('628000000000@s.whatsapp.net'), false, 'Case 6.3: Unknown phone rejected');
            assert.strictEqual(isAllowed('999999999999@lid'), false, 'Case 6.3: Unknown LID rejected');
            console.log('  ✔ Case 6.3: isAllowed returns false for unwhitelisted phone and LID');
        }

        // Test 6.4: isSuperAdmin returns true for Super Admin phone and Super Admin LID
        {
            assert.strictEqual(isSuperAdmin('628999888777@s.whatsapp.net'), true, 'Case 6.4: Super Admin phone allowed');
            assert.strictEqual(isSuperAdmin('555666777888@lid'), true, 'Case 6.4: Super Admin LID allowed');
            console.log('  ✔ Case 6.4: isSuperAdmin recognizes both Super Admin phone number and LID');
        }

        // Test 6.5: isSuperAdmin returns false for regular admin phone and regular admin LID
        {
            assert.strictEqual(isSuperAdmin('6281234567890@s.whatsapp.net'), false, 'Case 6.5: Regular admin phone must not be Super Admin');
            assert.strictEqual(isSuperAdmin('111222333444@lid'), false, 'Case 6.5: Regular admin LID must not be Super Admin');
            console.log('  ✔ Case 6.5: isSuperAdmin correctly restricts regular admins from elevated privileges');
        }

        return { passed: 5, failed: 0, feature: 'Feature 6 (R2.3 Multi-Device LID Authorization)' };
    } finally {
        process.chdir(origCwd);
        sandbox.cleanup();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 6 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
