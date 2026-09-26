/**
 * index.js - WhatsApp Bot Bootstrap & Orchestrator
 * Lean Entry Point (<150 lines)
 */
import { startWhatsAppConnection } from './src/connection.js';
import { startScheduler, stopScheduler } from './src/scheduler.js';
import {
    handleDocumentUpload,
    handleInteractiveResponse,
    setPendingVarianceSession
} from './src/upload_handler.js';
import { handleCommand } from './src/command_handler.js';
import {
    normalizeNumber,
    loadWhitelist,
    saveWhitelist,
    isSuperAdmin,
    isAllowed
} from './whitelist_helper.js';

/**
 * Resolve candidate phone numbers, auto-link WhatsApp LID, and evaluate permissions
 */
export function resolveSenderContext(sock, m) {
    const sender = m.key?.remoteJid || '';
    const senderNumber = m.key?.participant || sender;
    const senderPn = m.key?.senderPn || m.key?.participantPn || '';
    const senderLid = m.key?.senderLid || m.key?.participantLid || '';

    const candidates = [
        normalizeNumber(senderNumber),
        normalizeNumber(sender),
        normalizeNumber(senderPn),
        normalizeNumber(senderLid)
    ].filter(Boolean);

    const normSender = candidates[0] || normalizeNumber(senderNumber);

    // Auto-link LID WhatsApp ke pengguna terdaftar jika belum tersimpan
    if (sender.endsWith('@lid')) {
        const currentLid = normalizeNumber(sender);
        const wl = loadWhitelist();
        const matchedUser = wl.users?.find(u =>
            (candidates.length > 0 && candidates.some(c => c !== currentLid && normalizeNumber(u.number) === c)) ||
            (u.lid && normalizeNumber(u.lid) === currentLid)
        );
        if (matchedUser && !matchedUser.lid) {
            matchedUser.lid = currentLid;
            saveWhitelist(wl);
            console.log(`🔗 Auto-link LID WhatsApp ${currentLid} ke ${matchedUser.name} (${matchedUser.number})`);
        }
    }

    const isSenderSuperAdmin = candidates.some(c => isSuperAdmin(c));
    const isSenderAllowed = candidates.some(c => isAllowed(c));

    const text = m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.documentMessage?.caption ||
        m.message?.documentWithCaptionMessage?.message?.documentMessage?.caption || '';

    const cleanText = text.trim();
    const lowerText = cleanText.toLowerCase();

    return {
        sender,
        senderNumber,
        senderPn,
        senderLid,
        normSender,
        candidates,
        isSenderSuperAdmin,
        isSenderAllowed,
        cleanText,
        lowerText
    };
}

/**
 * Master incoming message router & pipeline
 */
export async function onIncomingMessage(sock, { messages } = {}) {
    const m = messages?.[0];
    if (!m || !m.message) return;

    const senderContext = resolveSenderContext(sock, m);

    // Filter self-chat loops (allow m.key.fromMe only if command/interactive digit)
    if (m.key?.fromMe) {
        const isBotCommand = senderContext.lowerText.startsWith('!') ||
            ['menu', 'lapor', 'rekap', 'pb', 'batal'].includes(senderContext.lowerText) ||
            /^\d+$/.test(senderContext.lowerText);
        const botUserNumber = sock?.user?.id ? normalizeNumber(sock.user.id) : '';
        const isSelfChat = normalizeNumber(senderContext.sender) === botUserNumber || senderContext.sender.endsWith('@lid');
        if (!(isSelfChat && isBotCommand)) return;
    }

    try {
        // Step 1: Interactive response handler (Pareto stock threshold or cash variance flow)
        if (await handleInteractiveResponse(sock, m, senderContext)) return;

        // Step 2: Document upload handler (.xls, .xlsx, .txt)
        if (m.message?.documentMessage || m.message?.documentWithCaptionMessage) {
            if (await handleDocumentUpload(sock, m, senderContext)) return;
        }

        // Step 3: Command handler and report dispatcher
        await handleCommand(sock, m, senderContext, { setPendingVarianceSession });
    } catch (err) {
        console.error('⚠️ Error processing incoming message:', err);
    }
}

// Boot WhatsApp Bot Connection & Wire Handlers
console.log('⏳ Memulai program bot laporan & analisa pareto toko...');
export const sockPromise = startWhatsAppConnection({
    sessionDir: 'sesi_bot',
    onOpen: (sock) => startScheduler(sock),
    onMessage: (sock, upsertData) => onIncomingMessage(sock, upsertData)
}).catch((err) => {
    console.error('Fatal initialization error:', err);
});

process.on('SIGINT', () => {
    stopScheduler();
    process.exit(0);
});

process.on('SIGTERM', () => {
    stopScheduler();
    process.exit(0);
});