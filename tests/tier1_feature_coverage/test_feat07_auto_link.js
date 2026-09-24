import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTestSandbox } from '../helpers/test_fixture_helper.js';
import { addNumber, isAllowed, loadWhitelist, saveWhitelist, normalizeNumber } from '../../whitelist_helper.js';

/**
 * Simulates incoming message auto-link resolution matching index.js
 */
export function handleIncomingMessageAutoLink(senderJid, candidatePhoneNumbers = []) {
    const normSender = normalizeNumber(senderJid);
    const wl = loadWhitelist();

    if (senderJid.endsWith('@lid')) {
        const currentLid = normSender;
        const normalizedCandidates = candidatePhoneNumbers.map(c => normalizeNumber(c)).filter(Boolean);

        const matchedUser = wl.users.find(u => {
            const userPhone = normalizeNumber(u.number);
            return (normalizedCandidates.length > 0 && normalizedCandidates.some(c => c !== currentLid && userPhone === c)) ||
                   (u.lid && normalizeNumber(u.lid) === currentLid);
        });

        if (matchedUser) {
            if (!matchedUser.lid) {
                matchedUser.lid = currentLid;
                saveWhitelist(wl);
                return { linked: true, user: matchedUser };
            }
            return { linked: false, alreadyLinked: true, user: matchedUser };
        }

    }
    return { linked: false, user: null };
}

export async function runTests() {
    console.log('--- Running Tier 1: Feature 7 (R2.4 Auto-Linking Circularity Fix) ---');
    const sandbox = createTestSandbox('feat07_auto_link_');
    const origCwd = process.cwd();

    try {
        process.chdir(sandbox.path);

        // Precondition: User registered by Super Admin with phone number only
        addNumber('081234567890', 'Ahmad Kasir');
        const dataInit = loadWhitelist();
        const initialUser = dataInit.users.find(u => u.number === '6281234567890');
        assert.ok(initialUser);
        assert.strictEqual(initialUser.lid || null, null);

        // Test 7.1: Incoming @lid message with candidate phone triggers auto-link
        {
            const senderLid = '987654321012345@lid';
            const candidatePn = ['6281234567890'];

            const linkResult = handleIncomingMessageAutoLink(senderLid, candidatePn);
            assert.strictEqual(linkResult.linked, true, 'Case 7.1: Auto-link should succeed');
            assert.strictEqual(linkResult.user.lid, '987654321012345');
            console.log('  ✔ Case 7.1: Auto-link maps incoming @lid to matching registered candidate phone number');
        }

        // Test 7.2: Pre-auth circularity fix: sender was not allowed prior to auto-link, but auto-link succeeds
        {
            addNumber('081399887766', 'Dewi Kasir');
            const unlinkedLid = '123456789098765@lid';
            
            // Prior to auto-link, isAllowed on this unknown LID is false
            assert.strictEqual(isAllowed(unlinkedLid), false, 'Unknown LID initially not allowed');

            // Incoming message delivers candidate phone number
            const res = handleIncomingMessageAutoLink(unlinkedLid, ['081399887766']);
            assert.strictEqual(res.linked, true);
            console.log('  ✔ Case 7.2: Auto-linking executes without requiring sender to already be authenticated');
        }

        // Test 7.3: Subsequent calls from auto-linked LID are now authorized
        {
            const authorized = isAllowed('123456789098765@lid');
            assert.strictEqual(authorized, true, 'Case 7.3: Auto-linked LID is now authorized');
            console.log('  ✔ Case 7.3: Subsequent calls from auto-linked @lid pass authorization');
        }

        // Test 7.4: Idempotent when message from already-linked LID arrives
        {
            const res = handleIncomingMessageAutoLink('123456789098765@lid', ['081399887766']);
            assert.strictEqual(res.alreadyLinked, true, 'Should detect already linked');
            console.log('  ✔ Case 7.4: Auto-link operation is idempotent for already linked users');
        }

        // Test 7.5: Rejects hijacking when candidate phone does not match any registered user
        {
            const strangerLid = '888888888888888@lid';
            const res = handleIncomingMessageAutoLink(strangerLid, ['089999999999']);
            assert.strictEqual(res.linked, false, 'Unregistered candidate must not be linked');
            assert.strictEqual(isAllowed(strangerLid), false, 'Stranger must remain disallowed');
            console.log('  ✔ Case 7.5: Auto-link securely ignores unregistered candidate phone numbers');
        }

        return { passed: 5, failed: 0, feature: 'Feature 7 (R2.4 Auto-Linking Circularity Fix)' };
    } finally {
        process.chdir(origCwd);
        sandbox.cleanup();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 7 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
