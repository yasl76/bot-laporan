/**
 * src/connection.js - Baileys WhatsApp Connection & Session Lifecycle Manager
 *
 * Responsibilities:
 * 1. Process-level interception of harmless libsignal decryption errors
 * 2. Automatic cleanup of stale multi-file session files older than maxAgeDays
 * 3. Boot-time cleanup of orphaned temporary upload and export files
 * 4. Baileys socket initialization, QR terminal rendering, credential synchronization,
 *    and reconnect backoff orchestration
 */

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';

export const LIBSIGNAL_ERROR_PATTERNS = [
    'Bad MAC',
    'Over 2000 messages',
    'SessionError',
    'Closing stale open session',
    'Failed to decrypt message'
];

/**
 * Determine if an error or log message is an internal libsignal session artifact
 * that should be suppressed to avoid unhandled rejections or console noise.
 * @param {any} content
 * @returns {boolean}
 */
export function isLibsignalError(content) {
    if (!content) return false;
    const str = typeof content === 'string'
        ? content
        : (content?.stack || content?.message || String(content));
    return LIBSIGNAL_ERROR_PATTERNS.some(pattern => str.includes(pattern));
}

let interceptorsInstalled = false;

/**
 * Intercept internal libsignal errors (Bad MAC, Over 2000 messages, SessionError, etc.)
 * in console.error and unhandled promise rejections to prevent node process instability.
 */
export function setupLibsignalInterceptors() {
    if (interceptorsInstalled) return;
    interceptorsInstalled = true;

    const originalConsoleError = console.error;
    console.error = (...args) => {
        const fullText = args.map(arg => {
            if (arg instanceof Error) {
                return (arg.stack || arg.message || String(arg));
            }
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return (arg.stack || arg.message || JSON.stringify(arg));
                } catch (_) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        if (isLibsignalError(fullText)) {
            return; // Suppress harmless libsignal race conditions
        }
        originalConsoleError.apply(console, args);
    };

    process.on('unhandledRejection', (reason) => {
        if (isLibsignalError(reason)) {
            return; // Suppress harmless libsignal race conditions
        }
        originalConsoleError('Unhandled Rejection:', reason);
    });
}

/**
 * Remove session-*.json files older than maxAgeDays to prevent disk bloat
 * @param {string} [sessionDir='sesi_bot'] - Session directory to inspect
 * @param {number} [maxAgeDays=7] - Maximum file age in days before removal
 * @returns {number} Count of deleted session files
 */
export function cleanupOldSessions(sessionDir = 'sesi_bot', maxAgeDays = 7) {
    try {
        const dir = path.resolve(sessionDir);
        if (!fs.existsSync(dir)) return 0;

        const dirStat = fs.statSync(dir);
        if (!dirStat.isDirectory()) return 0;

        const now = Date.now();
        const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
        let cleaned = 0;
        const files = fs.readdirSync(dir);

        for (const file of files) {
            if (!file.startsWith('session-')) continue;
            const filePath = path.join(dir, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.isFile() && (now - stat.mtimeMs > maxAgeMs)) {
                    fs.unlinkSync(filePath);
                    cleaned++;
                }
            } catch (_) {
                // Ignore files that may already have been unlinked or locked
            }
        }
        if (cleaned > 0) {
            console.log(`🧹 Auto-cleanup: ${cleaned} file sesi lama (>${maxAgeDays} hari) berhasil dihapus.`);
        }
        return cleaned;
    } catch (e) {
        console.error('⚠️ Gagal auto-cleanup sesi:', e.message);
        return 0;
    }
}

/**
 * Clean up orphaned temporary files left over from prior runs
 * Purges files matching:
 * - pareto_uploaded_*
 * - pos_uploaded_*
 * - Laporan_PB_Pareto_*
 * - Rekap_Bulanan_*
 *
 * @param {string} [targetDir='.'] - Directory to purge orphans from
 * @returns {string[]} List of cleaned file names
 */
export function cleanupOrphanedFiles(targetDir = '.') {
    const cleaned = [];
    try {
        const resolvedDir = path.resolve(targetDir);
        if (!fs.existsSync(resolvedDir)) return cleaned;

        const dirStat = fs.statSync(resolvedDir);
        if (!dirStat.isDirectory()) return cleaned;

        const files = fs.readdirSync(resolvedDir);
        for (const file of files) {
            const isOrphaned =
                file.startsWith('pareto_uploaded_') ||
                file.startsWith('pos_uploaded_') ||
                file.startsWith('Laporan_PB_Pareto_') ||
                file.startsWith('Rekap_Bulanan_');

            if (isOrphaned) {
                const fullPath = path.join(resolvedDir, file);
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.isFile()) {
                        fs.unlinkSync(fullPath);
                        cleaned.push(file);
                    }
                } catch (_) {
                    // Safe error handling for file access issues
                }
            }
        }
    } catch (_) {
        // Safe error handling on inaccessible or invalid directory
    }
    return cleaned;
}

/**
 * Establish WhatsApp connection via Baileys socket with complete lifecycle orchestration
 * @param {object} [options={}]
 * @param {string} [options.sessionDir='sesi_bot'] - Directory path for WhatsApp credentials & state
 * @param {Function} [options.onOpen] - Callback invoked when connection is established: (sock) => void
 * @param {Function} [options.onMessage] - Callback invoked on messages.upsert: (sock, upsertData) => void
 * @returns {Promise<object>} Baileys socket instance
 */
export async function startWhatsAppConnection({ sessionDir = 'sesi_bot', onOpen, onMessage } = {}) {
    setupLibsignalInterceptors();
    cleanupOldSessions(sessionDir, 7);
    cleanupOrphanedFiles('.');

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Chrome (Linux)', 'Chrome', '10.0.0'],
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    // KONEKSI & QR CODE
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📱 Scan QR code di bawah ini menggunakan WhatsApp (Perangkat Tertaut):\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            const isReplacedByNew = statusCode === 428; // Koneksi digantikan koneksi lain (multi-device)

            console.log(`🔄 Koneksi terputus (Kode: ${statusCode || 'unknown'}), menyambung ulang...`, !isLoggedOut);

            if (isLoggedOut) {
                console.log(`⚠️ Sesi WhatsApp telah logout atau tidak valid. Mereset ${sessionDir} agar QR code baru dapat dibuat...`);
                try {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                } catch (e) {
                    console.error('Error saat mereset sesi:', e);
                }
                setTimeout(() => startWhatsAppConnection({ sessionDir, onOpen, onMessage }), 3000);
            } else if (isReplacedByNew) {
                // Kode 428: sesi digantikan perangkat lain. Tunggu lebih lama sebelum reconnect.
                console.log('⚠️ Koneksi digantikan oleh perangkat/sesi lain. Menunggu 10 detik sebelum reconnect...');
                setTimeout(() => startWhatsAppConnection({ sessionDir, onOpen, onMessage }), 10000);
            } else {
                setTimeout(() => startWhatsAppConnection({ sessionDir, onOpen, onMessage }), 5000);
            }
        } else if (connection === 'open') {
            console.log('\n✅ BOT BERHASIL TERHUBUNG & SIAP DIGUNAKAN!');
            if (typeof onOpen === 'function') {
                try {
                    onOpen(sock);
                } catch (err) {
                    console.error('Error in onOpen callback:', err);
                }
            }
        }
    });

    // PENGOLAHAN PESAN MASUK
    if (typeof onMessage === 'function') {
        sock.ev.on('messages.upsert', async (data) => {
            try {
                await onMessage(sock, data);
            } catch (err) {
                console.error('Error processing messages.upsert:', err);
            }
        });
    }

    return sock;
}
