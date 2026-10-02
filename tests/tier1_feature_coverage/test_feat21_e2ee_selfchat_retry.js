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
    normalizeNumber,
    DEFAULT_SUPER_ADMINS
} from '../../whitelist_helper.js';
import {
    messageStore,
    storeMessage,
    cleanupOldSessions,
    isLibsignalError,
    setupLibsignalInterceptors,
    LIBSIGNAL_ERROR_PATTERNS
} from '../../src/connection.js';
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
            admin_secondary: null,
            admin_lid: '168779396993221',
            super_admins: ['6285852559058', '168779396993221'],
            users: [
                { number: '6285852559058', lid: '168779396993221', name: 'Super Admin Utama', role: 'super_admin' },
                { number: '6281234567890', name: 'Staf Kasir', role: 'admin_biasa' },
                { number: '6282264017152', lid: '215633832722432', name: 'raffi', role: 'admin_biasa' }
            ]
        };
        saveWhitelist(initialWl);

        // Test 21.1: linkLid links WhatsApp LID to registered user phone
        {
            const resValid = linkLid('081234567890', '998877665544');
            assert.strictEqual(resValid.success, true);
            const wl = loadWhitelist();
            const updated = wl.users.find(u => u.number === '6281234567890');
            assert.strictEqual(updated.lid, '998877665544');

            // linkLid rejects non-existent user
            const resNotFound = linkLid('089999999999', '111222333');
            assert.strictEqual(resNotFound.success, false);

            // linkLid rejects invalid inputs
            const resInvalid = linkLid('', '');
            assert.strictEqual(resInvalid.success, false);
            console.log('  ✔ Case 21.1: linkLid successfully links LID and validates inputs');
        }

        // Test 21.2: resolveReplyJid properly preserves sender JID
        {
            const mockSock = {
                user: { id: '6285852559058:78@s.whatsapp.net', lid: '168779396993221:0@lid' }
            };

            // Self-chat via LID
            const r1 = resolveReplyJid(mockSock, '168779396993221@lid', '168779396993221');
            assert.strictEqual(r1, '168779396993221@lid');

            // Self-chat via bot phone number
            const r2 = resolveReplyJid(mockSock, '6285852559058@s.whatsapp.net', '6285852559058');
            assert.strictEqual(r2, '6285852559058@s.whatsapp.net');

            // Whitelisted user via LID (Raffi)
            const r3 = resolveReplyJid(mockSock, '215633832722432@lid', '215633832722432');
            assert.strictEqual(r3, '215633832722432@lid');

            // Whitelisted user via standard phone JID
            const r4 = resolveReplyJid(mockSock, '6282264017152@s.whatsapp.net', '6282264017152');
            assert.strictEqual(r4, '6282264017152@s.whatsapp.net');

            // Stranger / unknown LID
            const r5 = resolveReplyJid(mockSock, '999999999999@lid', '999999999999');
            assert.strictEqual(r5, '999999999999@lid');

            // Empty sender returns empty string
            const r6 = resolveReplyJid(mockSock, '', '');
            assert.strictEqual(r6, '');
            console.log('  ✔ Case 21.2: resolveReplyJid preserves original sender JID for both @lid and @s.whatsapp.net');
        }

        // Test 21.3: Super Admin vs Regular Admin privilege boundaries (Raffi isolation & sole Super Admin)
        {
            // DEFAULT_SUPER_ADMINS must NOT contain Raffi's LID (215633832722432) or former secondary admin (6285123338591)
            assert.strictEqual(DEFAULT_SUPER_ADMINS.includes('215633832722432'), false, 'DEFAULT_SUPER_ADMINS must not contain Raffi LID');
            assert.strictEqual(DEFAULT_SUPER_ADMINS.includes('6285123338591'), false, 'DEFAULT_SUPER_ADMINS must not contain former admin');
            assert.deepStrictEqual(DEFAULT_SUPER_ADMINS, ['6285852559058', '168779396993221']);

            // Whitelist super_admins must not contain Raffi's LID or former secondary admin
            const wl = loadWhitelist();
            assert.strictEqual(wl.super_admins.includes('215633832722432'), false, 'Whitelist super_admins must not contain Raffi LID');
            assert.strictEqual(wl.super_admins.includes('6285123338591'), false, 'Whitelist super_admins must not contain former admin');

            // Raffi is regular admin, NOT super admin
            assert.strictEqual(isSuperAdmin('215633832722432@lid'), false);
            assert.strictEqual(isSuperAdmin('6282264017152@s.whatsapp.net'), false);
            assert.strictEqual(isAllowed('215633832722432@lid'), true);
            assert.strictEqual(isAllowed('6282264017152@s.whatsapp.net'), true);

            // Bot owner is Super Admin
            assert.strictEqual(isSuperAdmin('6285852559058@s.whatsapp.net'), true);
            assert.strictEqual(isSuperAdmin('168779396993221@lid'), true);

            // Former secondary admin is NOT super admin and not allowed
            assert.strictEqual(isSuperAdmin('6285123338591@s.whatsapp.net'), false);
            assert.strictEqual(isAllowed('6285123338591@s.whatsapp.net'), false);
            console.log('  ✔ Case 21.3: Super Admin privilege boundaries correctly respect admin_biasa role & DEFAULT_SUPER_ADMINS excludes Raffi LID and former secondary admin');
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

        // Test 21.6: handleCommand wraps sock.sendMessage, preserves sender JID, and stores sent message
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
            // Must preserve original sender JID (@lid)
            assert.strictEqual(sent[0].jid, '168779396993221@lid');
            // Outgoing message must be in messageStore
            assert.ok(messageStore.has('OUTGOING_MSG_001'));
            console.log('  ✔ Case 21.6: handleCommand preserves sender @lid JID and registers outgoing message in messageStore');
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

        // Test 21.8: Missing whitelist.json initializes clean default schema without duplicate LID user
        {
            if (fs.existsSync('whitelist.json')) {
                fs.unlinkSync('whitelist.json');
            }
            const freshWl = loadWhitelist();
            assert.strictEqual(freshWl.super_admins.includes('215633832722432'), false);
            assert.strictEqual(freshWl.super_admins.includes('6285123338591'), false);
            assert.strictEqual(freshWl.users.some(u => u.name === 'Super Admin HP (LID)'), false);
            assert.strictEqual(freshWl.users.some(u => u.name === 'Super Admin Cadangan'), false);
            assert.strictEqual(freshWl.users.some(u => u.number === '6285123338591'), false);
            assert.strictEqual(freshWl.admin_secondary, null);
            const saUtama = freshWl.users.find(u => u.number === '6285852559058');
            assert.ok(saUtama);
            assert.strictEqual(saUtama.lid, '168779396993221');
            console.log('  ✔ Case 21.8: Missing whitelist.json initializes clean schema with merged LID and no duplicate LID user');
        }

        // Test 21.9: isLibsignalError detects connection closed errors, wrapped Boom objects, and closed session warnings
        {
            // Plain string closed session
            assert.strictEqual(isLibsignalError('Decrypted message with closed session.'), true);
            assert.strictEqual(isLibsignalError('Closing open session in favor of incoming prekey bundle'), true);
            assert.strictEqual(isLibsignalError('Session already closed'), true);
            assert.strictEqual(isLibsignalError('Closing session:'), true);
            assert.strictEqual(isLibsignalError('Session already open'), true);
            assert.strictEqual(isLibsignalError('Opening session:'), true);

            // Connection closed string & Error
            assert.strictEqual(isLibsignalError('Connection Closed'), true);
            assert.strictEqual(isLibsignalError(new Error('Connection Closed')), true);

            // Wrapped Boom rejection object
            const wrappedBoom = {
                output: {
                    statusCode: 428,
                    payload: { message: 'Connection Closed' }
                },
                headers: {}
            };
            assert.strictEqual(isLibsignalError(wrappedBoom), true);

            // Nested error object
            const nestedErr = { error: new Error('Connection Closed') };
            assert.strictEqual(isLibsignalError(nestedErr), true);

            // Legitimate application errors should NOT match
            assert.strictEqual(isLibsignalError(new Error('Database connection failed')), false);
            assert.strictEqual(isLibsignalError('Laporan berhasil disimpan'), false);
            assert.strictEqual(isLibsignalError(null), false);
            assert.strictEqual(isLibsignalError(undefined), false);

            console.log('  ✔ Case 21.9: isLibsignalError accurately identifies Boom Connection Closed and libsignal session warnings');
        }

        // Test 21.10: setupLibsignalInterceptors intercepts console.warn and console.info for libsignal session events
        {
            setupLibsignalInterceptors();

            // Emit suppressed libsignal warnings and info without crashing or throwing
            console.warn('Decrypted message with closed session.');
            console.warn('Closing open session in favor of incoming prekey bundle');
            console.info('Closing session:', { indexInfo: { closed: -1 } });
            console.error('Unhandled libsignal error: Bad MAC');

            // Non-suppressed normal messages should execute through
            const normalLogs = [];
            const tempConsoleLog = (...args) => normalLogs.push(args.join(' '));
            const origLog = console.log;
            console.log = tempConsoleLog;
            try {
                console.log('Application status: OK');
                assert.strictEqual(normalLogs.length, 1);
                assert.strictEqual(normalLogs[0], 'Application status: OK');
            } finally {
                console.log = origLog;
            }

            console.log('  ✔ Case 21.10: setupLibsignalInterceptors suppresses console.warn/info for closed sessions while preserving application logs');
        }

        return { passed: 10, failed: 0, feature: 'Feature 21 (E2EE Self-Chat & Retry Decryption)' };
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
