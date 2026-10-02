import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createTestSandbox } from '../helpers/test_fixture_helper.js';
import {
    linkLid,
    resolveReplyJid,
    isSuperAdmin,
    isAllowed,
    addNumber,
    loadWhitelist,
    saveWhitelist,
    normalizeNumber
} from '../../whitelist_helper.js';
import { messageStore, storeMessage, cleanupOldSessions } from '../../src/connection.js';
import { handleCommand } from '../../src/command_handler.js';

export async function runTests() {
    console.log('--- Running Tier 1: Feature 21 (E2EE Self-Chat & Retry Decryption) ---');
    const sandbox = createTestSandbox('feat21_e2ee_');
    const origCwd = process.cwd();

    try {
        process.chdir(sandbox.path);

        // Setup clean whitelist
        const initialWl = {
            admin: '6285852559058',
            admin_secondary: '6285123338591',
            admin_lid: '168779396993221',
            super_admins: ['6285852559058', '6285123338591', '168779396993221'],
            users: [
                { number: '6285852559058', lid: '168779396993221', name: 'Super Admin Utama', role: 'super_admin' },
                { number: '6285123338591', name: 'Super Admin Cadangan', role: 'super_admin' },
                { number: '6282264017152', lid: '215633832722432', name: 'raffi', role: 'admin_biasa' }
            ]
        };
        saveWhitelist(initialWl);

        // Test 21.1: linkLid links WhatsApp LID to registered user phone
        {
            const resValid = linkLid('085123338591', '998877665544');
            assert.strictEqual(resValid.success, true);
            const wl = loadWhitelist();
            const updated = wl.users.find(u => u.number === '6285123338591');
            assert.strictEqual(updated.lid, '998877665544');

            // linkLid rejects non-existent user
            const resNotFound = linkLid('089999999999', '111222333');
            assert.strictEqual(resNotFound.success, false);

            // linkLid rejects invalid inputs
            const resInvalid = linkLid('', '');
            assert.strictEqual(resInvalid.success, false);
            console.log('  ✔ Case 21.1: linkLid successfully links LID and validates inputs');
        }

        // Test 21.2: resolveReplyJid properly resolves self-chat and registered LIDs
        {
            const mockSock = {
                user: { id: '6285852559058:78@s.whatsapp.net', lid: '168779396993221:0@lid' }
            };

            // Self-chat via LID
            const r1 = resolveReplyJid(mockSock, '168779396993221@lid', '168779396993221');
            assert.strictEqual(r1, '6285852559058@s.whatsapp.net');

            // Self-chat via bot phone number
            const r2 = resolveReplyJid(mockSock, '6285852559058@s.whatsapp.net', '6285852559058');
            assert.strictEqual(r2, '6285852559058@s.whatsapp.net');

            // Whitelisted user via LID (Raffi)
            const r3 = resolveReplyJid(mockSock, '215633832722432@lid', '215633832722432');
            assert.strictEqual(r3, '6282264017152@s.whatsapp.net');

            // Whitelisted user via standard phone JID
            const r4 = resolveReplyJid(mockSock, '6282264017152@s.whatsapp.net', '6282264017152');
            assert.strictEqual(r4, '6282264017152@s.whatsapp.net');

            // Stranger / unknown LID
            const r5 = resolveReplyJid(mockSock, '999999999999@lid', '999999999999');
            assert.strictEqual(r5, '999999999999@lid');
            console.log('  ✔ Case 21.2: resolveReplyJid routes self-chat & LIDs to phone numbers to prevent E2EE stall');
        }

        // Test 21.3: Super Admin vs Regular Admin privilege boundaries (Raffi isolation)
        {
            // Raffi is regular admin, NOT super admin
            assert.strictEqual(isSuperAdmin('215633832722432@lid'), false);
            assert.strictEqual(isSuperAdmin('6282264017152@s.whatsapp.net'), false);
            assert.strictEqual(isAllowed('215633832722432@lid'), true);
            assert.strictEqual(isAllowed('6282264017152@s.whatsapp.net'), true);

            // Bot owner is Super Admin
            assert.strictEqual(isSuperAdmin('6285852559058@s.whatsapp.net'), true);
            assert.strictEqual(isSuperAdmin('168779396993221@lid'), true);
            console.log('  ✔ Case 21.3: Super Admin privilege boundaries correctly respect admin_biasa role');
        }

        // Test 21.4: messageStore in-memory cache and FIFO eviction at 1500 items
        {
            messageStore.clear();

            // Store single message
            storeMessage({
                key: { id: 'MSG_TEST_001' },
                message: { conversation: 'Hello World' }
            });
            assert.strictEqual(messageStore.get('MSG_TEST_001')?.conversation, 'Hello World');

            // Store up to 1505 messages to test FIFO eviction
            for (let i = 2; i <= 1505; i++) {
                storeMessage({
                    key: { id: `MSG_TEST_${String(i).padStart(4, '0')}` },
                    message: { conversation: `Content ${i}` }
                });
            }

            assert.strictEqual(messageStore.size, 1500);
            assert.strictEqual(messageStore.has('MSG_TEST_001'), false, 'Oldest message should be evicted');
            assert.strictEqual(messageStore.has('MSG_TEST_0005'), false, 'Eviction follows FIFO order');
            assert.strictEqual(messageStore.has('MSG_TEST_1505'), true, 'Latest message must be retained');
            console.log('  ✔ Case 21.4: messageStore retains last 1500 messages with FIFO eviction');
        }

        // Test 21.5: cleanupOldSessions is disabled to preserve Signal Double Ratchet sessions
        {
            const deletedCount = cleanupOldSessions(sandbox.path, 7);
            assert.strictEqual(deletedCount, 0, 'cleanupOldSessions must return 0 and not delete active sessions');
            console.log('  ✔ Case 21.5: cleanupOldSessions safely disabled to protect cryptographic state');
        }

        // Test 21.6: handleCommand wraps sock.sendMessage, routes to phone JID, and stores sent message
        {
            const sent = [];
            const mockSock = {
                user: { id: '6285852559058:78@s.whatsapp.net', lid: '168779396993221:0@lid' },
                sendMessage: async (jid, content) => {
                    sent.push({ jid, content });
                    return { key: { id: 'OUTGOING_MSG_001' }, message: { conversation: content.text || 'doc' } };
                }
            };

            const sender = '168779396993221@lid';
            const handled = await handleCommand(mockSock, {
                key: { remoteJid: sender },
                message: { conversation: '!menu' }
            });

            assert.strictEqual(handled, true);
            assert.strictEqual(sent.length, 1);
            // Must send to standard phone JID, not @lid!
            assert.strictEqual(sent[0].jid, '6285852559058@s.whatsapp.net');
            // Outgoing message must be in messageStore
            assert.ok(messageStore.has('OUTGOING_MSG_001'));
            console.log('  ✔ Case 21.6: handleCommand routes self-chat to phone JID and registers outgoing message in messageStore');
        }

        // Test 21.7: storeMessage caches incoming message and getMessage resolves key
        {
            const incoming = {
                key: { id: 'INCOMING_RETRY_001', remoteJid: '628123456789@s.whatsapp.net' },
                message: { conversation: 'Laporan harian' }
            };

            storeMessage(incoming);
            assert.strictEqual(messageStore.get('INCOMING_RETRY_001')?.conversation, 'Laporan harian');

            // Simulate getMessage callback behavior
            const getMessage = async (key) => messageStore.get(key.id) || undefined;
            const retrieved = await getMessage({ id: 'INCOMING_RETRY_001' });
            assert.strictEqual(retrieved?.conversation, 'Laporan harian');

            const notFound = await getMessage({ id: 'NON_EXISTENT_ID' });
            assert.strictEqual(notFound, undefined);
            console.log('  ✔ Case 21.7: storeMessage and getMessage successfully resolve encryption retry keys');
        }

        return { passed: 7, failed: 0, feature: 'Feature 21 (E2EE Self-Chat & Retry Decryption)' };
    } finally {
        process.chdir(origCwd);
        sandbox.cleanup();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 21 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
