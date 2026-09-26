/**
 * src/upload_handler.js
 * Penanganan upload file media/dokumen (Excel Pareto .xls/.xlsx dan Jurnal POS Kasir .txt),
 * serta state machine alur konfirmasi interaktif (ambang batas stok PB dan input kas variance laci).
 */

import fs from 'fs';
import path from 'path';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { loadWhitelist } from '../whitelist_helper.js';
import { loadConfig, getStoreInfo } from '../config_helper.js';
import { analyzePareto, generatePbExcel, getPbSummaryText } from '../pareto_analyzer.js';
import { parsePosJournal, formatPosAuditMessage, getActiveOrLatestShift, calculateVariance, formatVarianceMessage } from '../struk_parser.js';
import { parseNominal, formatRp, formatDateFileName } from './formatters.js';

// In-memory state storage: Map<string, SessionState>
// Key: normSender (string)
const userSessions = new Map();

export const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function isSessionExpired(session) {
    return Date.now() - session.timestamp > SESSION_TIMEOUT_MS;
}

/**
 * Checks if user has an active session.
 * @param {string} normSender
 * @returns {boolean}
 */
export function hasPendingSession(normSender) {
    if (!normSender || !userSessions.has(normSender)) return false;
    const session = userSessions.get(normSender);
    if (isSessionExpired(session)) {
        clearUserSession(normSender);
        return false;
    }
    return true;
}

/**
 * Clears and cleans up any pending session and temporary files for a user.
 * @param {string} normSender
 */
export function clearUserSession(normSender) {
    if (!normSender || !userSessions.has(normSender)) return;
    const session = userSessions.get(normSender);
    if (session && session.filePath) {
        try {
            if (fs.existsSync(session.filePath)) {
                fs.unlinkSync(session.filePath);
            }
        } catch (_) {}
    }
    userSessions.delete(normSender);
}

/**
 * Gets active session for user if not expired.
 * @param {string} normSender
 * @returns {object|null}
 */
export function getUserSession(normSender) {
    if (!normSender || !userSessions.has(normSender)) return null;
    const session = userSessions.get(normSender);
    if (isSessionExpired(session)) {
        clearUserSession(normSender);
        return null;
    }
    return session;
}

/**
 * Initiates an interactive variance session (called from upload or !auditkas command).
 * @param {string} normSender - Normalized sender ID
 * @param {object} sessionData - { shift, tanggal, station }
 */
export function setPendingVarianceSession(normSender, sessionData) {
    if (!normSender) return;
    clearUserSession(normSender);
    const data = sessionData || {};
    userSessions.set(normSender, {
        type: 'VARIANCE',
        shift: data.shift,
        tanggal: data.tanggal,
        station: data.station,
        ...data,
        timestamp: data.timestamp || Date.now()
    });
}

/**
 * Background garbage collection for expired sessions and orphaned files.
 * @returns {number} Number of cleaned stale sessions
 */
export function cleanupStaleSessions() {
    const now = Date.now();
    let cleaned = 0;
    for (const [normSender, session] of userSessions.entries()) {
        if (now - session.timestamp > SESSION_TIMEOUT_MS) {
            clearUserSession(normSender);
            cleaned++;
        }
    }
    return cleaned;
}

/**
 * Helper to download buffer safely, with support for mock buffers in tests.
 */
async function downloadMediaBuffer(m, options) {
    if (options?.downloadMediaFn) {
        return await options.downloadMediaFn(m);
    }
    if (m?._mockBuffer || m?.mockBuffer) {
        return m._mockBuffer || m.mockBuffer;
    }
    return await downloadMediaMessage(m, 'buffer', {});
}

/**
 * Processes incoming document messages (.xls, .xlsx, .txt).
 * @param {object} sock - Baileys socket instance
 * @param {object} m - WAMessage object
 * @param {object} senderContext - Precomputed sender metadata { sender, normSender, isSenderAllowed, cleanText, lowerText }
 * @param {object} [options] - Optional overrides (e.g. downloadMediaFn)
 * @returns {Promise<boolean>} True if handled as a document upload; False otherwise
 */
export async function handleDocumentUpload(sock, m, senderContext, options = {}) {
    const doc = m?.message?.documentMessage || m?.message?.documentWithCaptionMessage?.message?.documentMessage;
    if (!doc) return false;

    const rawFileName = doc.fileName || '';
    const fileName = rawFileName.toLowerCase();
    const isExcel = fileName.endsWith('.xls') || fileName.endsWith('.xlsx');
    const isTxt = fileName.endsWith('.txt');

    if (!isExcel && !isTxt) return false;

    const sender = senderContext?.sender || m?.key?.remoteJid;
    const normSender = senderContext?.normSender || (sender ? sender.replace(/[^0-9]/g, '') : '');
    const isSenderAllowed = !!senderContext?.isSenderAllowed;
    const cleanText = (senderContext?.cleanText ?? doc.caption ?? '').trim();

    // 1. EXCEL PARETO (.xls / .xlsx)
    if (isExcel) {
        if (!isSenderAllowed) {
            const wl = loadWhitelist();
            await sock.sendMessage(sender, {
                text: `⚠️ Maaf, nomor Anda (*${normSender}*) belum terdaftar untuk mengupload data ke bot.\nSilakan hubungi Super Admin (${wl.super_admins?.[0] || wl.admin}).`
            });
            return true;
        }

        let savedPath = null;
        try {
            const buffer = await downloadMediaBuffer(m, options);
            const ext = path.extname(rawFileName) || '.xls';
            savedPath = `pareto_uploaded_${Date.now()}${ext}`;
            fs.writeFileSync(savedPath, buffer);

            const cfg = loadConfig();
            const storeInfo = getStoreInfo(cfg);

            // Direct match flow: !pb [N] (e.g. "!pb 5" or "!pb 15")
            const directMatch = cleanText.match(/^!pb\s+(\d+)$/i);
            if (directMatch) {
                clearUserSession(normSender);
                const directThreshold = parseInt(directMatch[1], 10);
                await sock.sendMessage(sender, {
                    text: `⏳ Mengunduh dan menganalisa dokumen pareto *${rawFileName}* (Ambang Batas Stok <= *${directThreshold} pcs*)...`
                });

                let excelOutput = null;
                try {
                    const analysis = analyzePareto(savedPath, directThreshold);
                    const summaryText = getPbSummaryText(analysis, 10, storeInfo);
                    excelOutput = `Laporan_PB_Pareto_${Date.now()}.xlsx`;
                    await generatePbExcel(analysis, excelOutput, storeInfo);

                    await sock.sendMessage(sender, { text: summaryText });
                    await sock.sendMessage(sender, {
                        document: fs.readFileSync(excelOutput),
                        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        fileName: `Laporan_PB_Pareto_${formatDateFileName(new Date(), 'long')}.xlsx`,
                        caption: `📊 *Hasil Analisa Dokumen Pareto (Batas: <= ${directThreshold} pcs)*\nFile Excel rekomendasi restock ${analysis.totalKritis} item kritis siap kirim ke supplier.`
                    });
                } finally {
                    if (excelOutput) {
                        try { if (fs.existsSync(excelOutput)) fs.unlinkSync(excelOutput); } catch (_) {}
                    }
                    if (savedPath) {
                        try { if (fs.existsSync(savedPath)) fs.unlinkSync(savedPath); } catch (_) {}
                    }
                }
                return true;
            }

            // Interactive Flow: Store pending state and prompt user
            clearUserSession(normSender);
            userSessions.set(normSender, {
                type: 'PARETO',
                filePath: savedPath,
                fileName: rawFileName || 'Dokumen Pareto',
                timestamp: Date.now()
            });

            const defaultStok = cfg.ambang_stok_pb || 10;
            const promptText = `📥 *DOKUMEN PARETO DITERIMA!*\n` +
                `• File: *${rawFileName}*\n\n` +
                `Silakan ketik angka ambang batas sisa stok yang ingin dianalisa:\n` +
                `1️⃣ Ketik *${defaultStok}* : Analisa item kritis (Stok <= ${defaultStok} pcs) [Standar]\n` +
                `2️⃣ Ketik *5*  : Analisa item sangat kritis (Stok <= 5 pcs) [Urgent]\n` +
                `3️⃣ Ketik *angka lain* (misal: *15*, *20*) sesuai kebutuhan analisa toko\n` +
                `4️⃣ Ketik *batal* : Batalkan analisa dokumen ini\n\n` +
                `⏳ _Kirimkan angka ambang batas stok untuk melanjutkan analisa..._`;

            await sock.sendMessage(sender, { text: promptText });
            return true;
        } catch (err) {
            if (savedPath) {
                try { if (fs.existsSync(savedPath)) fs.unlinkSync(savedPath); } catch (_) {}
            }
            console.error('Error memproses dokumen pareto:', err);
            try {
                await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan saat memproses file pareto: ${err.message}` });
            } catch (_) {}
            return true;
        }
    }

    // 2. POS CASHIER JOURNAL (.txt)
    if (isTxt) {
        if (!isSenderAllowed) {
            const wl = loadWhitelist();
            await sock.sendMessage(sender, {
                text: `⚠️ Maaf, nomor Anda (*${normSender}*) belum terdaftar untuk mengupload log ke bot.\nSilakan hubungi Super Admin (${wl.super_admins?.[0] || wl.admin}).`
            });
            return true;
        }

        let tempTxtPath = null;
        try {
            await sock.sendMessage(sender, {
                text: `⏳ Mengunduh dan menganalisa log jurnal kasir *${rawFileName}*...`
            });

            const buffer = await downloadMediaBuffer(m, options);
            tempTxtPath = `pos_uploaded_${Date.now()}.txt`;
            fs.writeFileSync(tempTxtPath, buffer);

            const contentStr = buffer.toString('latin1');
            if (contentStr.includes('INISIALISASI') || contentStr.includes('TITAN EKSEKUTIF MART') || contentStr.includes('Station :')) {
                const auditResult = parsePosJournal(tempTxtPath);
                const auditMsg = formatPosAuditMessage(auditResult);
                await sock.sendMessage(sender, { text: auditMsg });

                // Interactive cash drawer variance hook
                const activeShift = getActiveOrLatestShift(auditResult);
                if (activeShift) {
                    setPendingVarianceSession(normSender, {
                        shift: activeShift,
                        tanggal: auditResult.tanggal,
                        station: auditResult.station
                    });
                    const inviteText = `\n💡 *Rekonsiliasi Kas Laci Langsung:*\n` +
                        `Ketik nominal uang fisik kas di laci saat ini (cth: *${activeShift.totalFisikLaci}* atau *Rp ${formatRp(activeShift.totalFisikLaci)}*) untuk menghitung selisih (variance), atau ketik *batal*.`;
                    await sock.sendMessage(sender, { text: inviteText });
                }
            } else {
                await sock.sendMessage(sender, {
                    text: `⚠️ File *${rawFileName}* bukan format log jurnal kasir POS OMI (tidak ditemukan blok INISIALISASI).`
                });
            }
        } catch (err) {
            console.error('Error memproses log jurnal kasir:', err);
            try {
                await sock.sendMessage(sender, {
                    text: `❌ Gagal memproses file log kasir *${rawFileName}*: ${err.message}`
                });
            } catch (_) {}
        } finally {
            if (tempTxtPath) {
                try { if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath); } catch (_) {}
            }
        }
        return true;
    }

    return false;
}

/**
 * Intercepts text responses from users who have an active interactive session.
 * @param {object} sock - Baileys socket instance
 * @param {object} m - WAMessage object
 * @param {object} senderContext - Precomputed sender metadata { sender, normSender, cleanText, lowerText }
 * @returns {Promise<boolean>} True if handled/consumed; False if not in session or interrupted by command
 */
export async function handleInteractiveResponse(sock, m, senderContext) {
    const sender = senderContext?.sender || m?.key?.remoteJid;
    const normSender = senderContext?.normSender || (sender ? sender.replace(/[^0-9]/g, '') : '');
    if (!normSender || !userSessions.has(normSender)) return false;

    const session = userSessions.get(normSender);

    // Timeout check (10 mins)
    if (isSessionExpired(session)) {
        clearUserSession(normSender);
        return false;
    }

    let cleanText = senderContext?.cleanText;
    let lowerText = senderContext?.lowerText;
    if (cleanText === undefined || cleanText === null) {
        const text = m?.message?.conversation ||
                     m?.message?.extendedTextMessage?.text ||
                     m?.message?.imageMessage?.caption ||
                     m?.message?.documentMessage?.caption || '';
        cleanText = text.trim();
        lowerText = cleanText.toLowerCase();
    } else if (lowerText === undefined) {
        lowerText = cleanText.toLowerCase();
    }

    // Cancellation: 'batal'
    if (lowerText === 'batal') {
        const fileName = session.fileName || 'dokumen';
        const isPareto = session.type === 'PARETO';
        clearUserSession(normSender);
        if (isPareto) {
            await sock.sendMessage(sender, { text: `❌ Analisa dokumen pareto *${fileName}* telah dibatalkan.` });
        } else {
            await sock.sendMessage(sender, { text: '❌ Alur rekonsiliasi kas telah dibatalkan.' });
        }
        return true;
    }

    // Command interruption: allow command pass-through
    if (lowerText.startsWith('!') || ['menu', 'lapor', 'rekap', 'pb', 'auditkas'].includes(lowerText)) {
        clearUserSession(normSender);
        return false; // Yield to command_handler
    }

    // A. PARETO STOCK THRESHOLD SESSION
    if (session.type === 'PARETO') {
        if (/^\d+$/.test(lowerText)) {
            const chosenThreshold = parseInt(lowerText, 10);
            if (chosenThreshold <= 0 || chosenThreshold > 500) {
                await sock.sendMessage(sender, {
                    text: '⚠️ Harap masukkan angka ambang batas stok yang wajar (1 - 500) atau ketik *batal*.'
                });
                return true;
            }

            const filePath = session.filePath;
            const fileName = session.fileName;
            userSessions.delete(normSender);

            let excelOutput = null;
            try {
                await sock.sendMessage(sender, {
                    text: `⏳ Sedang menganalisa dokumen *${fileName}* dengan ambang batas stok <= *${chosenThreshold} pcs*...`
                });

                const cfg = loadConfig();
                const storeInfo = getStoreInfo(cfg);
                const analysis = analyzePareto(filePath, chosenThreshold);
                const summaryText = getPbSummaryText(analysis, 10, storeInfo);
                excelOutput = `Laporan_PB_Pareto_${Date.now()}.xlsx`;
                await generatePbExcel(analysis, excelOutput, storeInfo);

                await sock.sendMessage(sender, { text: summaryText });
                await sock.sendMessage(sender, {
                    document: fs.readFileSync(excelOutput),
                    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    fileName: `Laporan_PB_Pareto_${formatDateFileName(new Date(), 'long')}.xlsx`,
                    caption: `📊 *Hasil Analisa Dokumen Pareto (Batas: <= ${chosenThreshold} pcs)*\nFile Excel rekomendasi restock ${analysis.totalKritis} item kritis siap kirim ke supplier.`
                });
            } catch (err) {
                console.error('Error saat analisa interaktif:', err);
                try {
                    await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan analisa pareto: ${err.message}` });
                } catch (_) {}
            } finally {
                if (excelOutput) {
                    try { if (fs.existsSync(excelOutput)) fs.unlinkSync(excelOutput); } catch (_) {}
                }
                if (filePath) {
                    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
                }
            }
            return true;
        }

        await sock.sendMessage(sender, {
            text: `⚠️ Mohon ketik angka ambang batas stok (misal: *10*, *5*, *15*), atau ketik *batal* untuk membatalkan analisa file *${session.fileName}*.`
        });
        return true;
    }

    // B. CASH DRAWER VARIANCE AUDIT SESSION
    if (session.type === 'VARIANCE') {
        const digitsOnly = cleanText.replace(/[^0-9]/g, '');
        if (digitsOnly.length > 0) {
            const nominal = parseNominal(cleanText);
            userSessions.delete(normSender);
            const varianceMsg = formatVarianceMessage({
                shift: session.shift,
                kasFisikAktual: nominal,
                tanggal: session.tanggal,
                station: session.station
            });
            await sock.sendMessage(sender, { text: varianceMsg });
            return true;
        }

        await sock.sendMessage(sender, {
            text: '⚠️ Masukkan nominal uang fisik laci kasir (cth: *580000* atau *Rp 580.400*), atau ketik *batal*.'
        });
        return true;
    }

    return false;
}
