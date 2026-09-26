/**
 * src/scheduler.js
 * Automated Scheduler & Recurring Cron Jobs Module.
 *
 * Responsibilities:
 * 1. Daily Closing Reminder:
 *    - Dynamically evaluates loadConfig().
 *    - Evaluates every 60 seconds with ±2 min window.
 *    - Deduplicates per day using date string.
 *    - Dispatches reminder message to all whitelisted phone numbers.
 *
 * 2. Automatic End-of-Month Summary:
 *    - Evaluates if tomorrow is the 1st of next month.
 *    - Checks current time against configured hour/minute (±4 min window).
 *    - Deduplicates per month using month key.
 *    - Generates Excel recap report using generateRekapExcel.
 *    - Dispatches document to all Super Admins in wl.super_admins.
 *    - Guarantees strict file cleanup (unlink) in try ... finally block.
 *
 * 3. Idempotent Scheduler Lifecycle:
 *    - startScheduler(sock) automatically calls stopScheduler() first to clear
 *      any active timer, preventing timer leaks and duplicate broadcasts on reconnects.
 *    - stopScheduler() clears active interval and sets timer to null.
 *
 * 4. Testable Evaluators:
 *    - evaluateDailyReminder(now, cfg, state)
 *    - evaluateMonthlyRecap(now, cfg, state)
 */

import fs from 'fs';
import path from 'path';
import { formatMonthYearIndo, formatDateFileName } from './formatters.js';
import { loadConfig } from '../config_helper.js';
import { loadWhitelist, normalizeNumber } from '../whitelist_helper.js';
import { generateRekapExcel } from '../rekap_helper.js';

let activeInterval = null;

export const schedulerState = {
    lastReminderDate: '',
    lastMonthlyRecapMonth: ''
};

/**
 * Evaluates whether daily closing reminder should trigger.
 * @param {Date|string|number} [now=new Date()]
 * @param {object} [cfg=null]
 * @param {object|string} [state=null]
 * @returns {boolean}
 */
export function evaluateDailyReminder(now = new Date(), cfg = null, state = null) {
    const dateObj = (now instanceof Date) ? now : new Date(now || Date.now());
    const config = cfg || loadConfig();

    // If explicitly disabled (e.g. reminder_closing_enabled === false), do not trigger
    if (config.reminder_closing_enabled === false) {
        return false;
    }

    const targetHour = config.reminder_closing_jam !== undefined ? Number(config.reminder_closing_jam) : 21;
    const targetMin = config.reminder_closing_menit !== undefined ? Number(config.reminder_closing_menit) : 45;

    const currentHour = dateObj.getHours();
    const currentMinute = dateObj.getMinutes();
    const todayDateStr = dateObj.toDateString();

    let lastReminder = '';
    if (typeof state === 'string') {
        lastReminder = state;
    } else if (state && typeof state === 'object') {
        lastReminder = state.lastReminderDate ?? state.lastSentDate ?? '';
    } else {
        lastReminder = schedulerState.lastReminderDate || '';
    }

    const isTargetHour = currentHour === targetHour;
    const isWithinWindow = Math.abs(currentMinute - targetMin) <= 2;
    const isNotAlreadySent = lastReminder !== todayDateStr;

    return Boolean(isTargetHour && isWithinWindow && isNotAlreadySent);
}

/**
 * Evaluates whether automatic end-of-month recap should trigger.
 * @param {Date|string|number} [now=new Date()]
 * @param {object} [cfg=null]
 * @param {object|string} [state=null]
 * @returns {boolean}
 */
export function evaluateMonthlyRecap(now = new Date(), cfg = null, state = null) {
    const dateObj = (now instanceof Date) ? now : new Date(now || Date.now());
    const config = cfg || loadConfig();

    const targetHour = config.jam_rekap_otomatis !== undefined ? Number(config.jam_rekap_otomatis) : 23;
    const targetMin = config.menit_rekap_otomatis !== undefined ? Number(config.menit_rekap_otomatis) : 0;

    // Last day of month check: adding 1 day results in the 1st of next month
    const tomorrow = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate() + 1);
    const isLastDayOfMonth = tomorrow.getDate() === 1;
    const monthKey = `${dateObj.getFullYear()}-${dateObj.getMonth() + 1}`;

    const currentHour = dateObj.getHours();
    const currentMinute = dateObj.getMinutes();

    let lastRecap = '';
    if (typeof state === 'string') {
        lastRecap = state;
    } else if (state && typeof state === 'object') {
        lastRecap = state.lastMonthlyRecapMonth ?? state.lastSentMonth ?? '';
    } else {
        lastRecap = schedulerState.lastMonthlyRecapMonth || '';
    }

    const isTargetHour = currentHour === targetHour;
    const isWithinWindow = Math.abs(currentMinute - targetMin) <= 4;
    const isNotAlreadySent = lastRecap !== monthKey;

    return Boolean(isLastDayOfMonth && isTargetHour && isWithinWindow && isNotAlreadySent);
}

/**
 * Executes a single evaluation tick for daily closing reminder and monthly recap.
 * @param {object} sock - Baileys socket instance
 * @param {Date|object} [now=new Date()]
 * @param {object} [options={}]
 */
export async function runSchedulerTick(sock, now = new Date(), options = {}) {
    let tickNow = now;
    let tickOpts = options;
    if (now && !(now instanceof Date) && typeof now === 'object') {
        tickOpts = now;
        tickNow = tickOpts.now || new Date();
    } else if (!tickNow) {
        tickNow = new Date();
    }

    try {
        const cfg = loadConfig();
        const todayDateStr = tickNow.toDateString();

        // 1. PENGINGAT CLOSING HARIAN
        if (evaluateDailyReminder(tickNow, cfg, schedulerState)) {
            schedulerState.lastReminderDate = todayDateStr;
            const wl = loadWhitelist();
            const reminderJam = String(cfg.reminder_closing_jam !== undefined ? cfg.reminder_closing_jam : 21).padStart(2, '0');
            const reminderMenit = String(cfg.reminder_closing_menit !== undefined ? cfg.reminder_closing_menit : 45).padStart(2, '0');
            const namaToko = cfg.nama_toko || 'OMI TITAN EKSEKUTIF MART';

            const reminderText = `🔔 *PENGINGAT CLOSING TOKO (${reminderJam}:${reminderMenit} WIB)* 🔔\n\n` +
                `Kepada seluruh rekan tim operasional & kasir *${namaToko}*:\n` +
                `Waktu closing operasional harian telah tiba. Mohon segera hitung data kasir, SO harian, lalu kirimkan laporan harian menggunakan format:\n\n` +
                `Ketik *menu* untuk menyalin template laporan.\nTerima kasih atas dedikasi dan kerja keras hari ini! 🙏`;

            const recipients = new Set();
            if (wl.users && Array.isArray(wl.users)) {
                wl.users.forEach(u => {
                    const clean = normalizeNumber(u.number);
                    if (clean && clean.length >= 10 && !clean.startsWith('16877')) {
                        recipients.add(`${clean}@s.whatsapp.net`);
                    }
                });
            }
            if (wl.super_admins && Array.isArray(wl.super_admins)) {
                wl.super_admins.forEach(sa => {
                    const clean = normalizeNumber(sa);
                    if (clean && clean.length >= 10 && !clean.startsWith('16877')) {
                        recipients.add(`${clean}@s.whatsapp.net`);
                    }
                });
            }

            if (sock && typeof sock.sendMessage === 'function') {
                for (const jid of recipients) {
                    try {
                        await sock.sendMessage(jid, { text: reminderText });
                    } catch (e) {
                        console.error('Gagal mengirim reminder closing ke:', jid, e.message);
                    }
                }
            }
            console.log(`📢 Reminder closing harian (${todayDateStr}) terkirim ke ${recipients.size} pengguna.`);
        }

        // 2. REKAP BULANAN OTOMATIS AKHIR BULAN
        if (evaluateMonthlyRecap(tickNow, cfg, schedulerState)) {
            const monthKey = `${tickNow.getFullYear()}-${tickNow.getMonth() + 1}`;
            const rekapFilePath = tickOpts?.rekapDataPath || path.resolve(process.cwd(), 'rekap_data.json');

            if (fs.existsSync(rekapFilePath)) {
                let list = [];
                try {
                    const content = fs.readFileSync(rekapFilePath, 'utf8');
                    list = JSON.parse(content);
                } catch (err) {
                    console.error('Error membaca rekap_data.json:', err.message);
                }

                if (Array.isArray(list) && list.length > 0) {
                    const wl = loadWhitelist();
                    const monthName = formatMonthYearIndo(tickNow);
                    let outPath = null;
                    try {
                        outPath = path.resolve(process.cwd(), `Rekap_Bulanan_Otomatis_${monthKey}.xlsx`);
                        const storeInfo = {
                            nama_toko: cfg.nama_toko,
                            kode_toko: cfg.kode_toko,
                            cabang: cfg.cabang
                        };
                        generateRekapExcel(list, outPath, cfg.target_spd, storeInfo);

                        const superAdminRecipients = new Set();
                        if (wl.super_admins && Array.isArray(wl.super_admins)) {
                            wl.super_admins.forEach(sa => {
                                const clean = normalizeNumber(sa);
                                if (clean && clean.length >= 10 && !clean.startsWith('16877')) {
                                    superAdminRecipients.add(`${clean}@s.whatsapp.net`);
                                }
                            });
                        }

                        if (sock && typeof sock.sendMessage === 'function') {
                            const fileBuffer = fs.readFileSync(outPath);
                            const sanitizedMonthName = monthName.replace(/\s+/g, '_');
                            for (const adminJid of superAdminRecipients) {
                                try {
                                    await sock.sendMessage(adminJid, {
                                        document: fileBuffer,
                                        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                        fileName: `Rekap_Bulanan_${sanitizedMonthName}.xlsx`,
                                        caption: `📢 *REKAP OTOMATIS AKHIR BULAN TELAH SIAP!*\n\nBerikut rekapitulasi data penjualan toko ${cfg.nama_toko || 'OMI TITAN EKSEKUTIF MART'} periode *${monthName}*.\nTerima kasih atas kerja keras seluruh tim bulan ini! 🙏`
                                    });
                                } catch (e) {
                                    console.error('Gagal mengirim rekap bulanan ke super admin:', adminJid, e.message);
                                }
                            }
                        }
                        schedulerState.lastMonthlyRecapMonth = monthKey;
                        console.log(`✅ Rekap akhir bulan otomatis ${monthKey} berhasil dikirim ke Super Admin.`);
                    } finally {
                        if (outPath) {
                            try {
                                if (fs.existsSync(outPath)) {
                                    fs.unlinkSync(outPath);
                                }
                            } catch (_) {}
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error pada scheduler bot:', e);
    }
}

/**
 * Stops the scheduler interval if running.
 * Clears timer and sets activeInterval to null.
 */
export function stopScheduler() {
    if (activeInterval) {
        clearInterval(activeInterval);
        activeInterval = null;
    }
}

/**
 * Starts the recurring 60-second scheduler.
 * Idempotent: automatically calls stopScheduler() first to clear any existing interval,
 * preventing timer leaks on socket reconnects.
 * @param {object} sock - Baileys socket instance
 * @returns {object|NodeJS.Timeout} The active interval timer
 */
export function startScheduler(sock) {
    stopScheduler();
    activeInterval = setInterval(async () => {
        try {
            await runSchedulerTick(sock);
        } catch (e) {
            console.error('Error pada scheduler bot:', e);
        }
    }, 60 * 1000);
    return activeInterval;
}

/**
 * Returns current running status of scheduler.
 * @returns {boolean}
 */
export function isSchedulerRunning() {
    return activeInterval !== null;
}

/**
 * Returns a copy of current scheduler state.
 * @returns {{ lastReminderDate: string, lastMonthlyRecapMonth: string }}
 */
export function getSchedulerState() {
    return { ...schedulerState };
}

/**
 * Resets scheduler internal deduplication state (useful for tests).
 */
export function resetSchedulerState() {
    schedulerState.lastReminderDate = '';
    schedulerState.lastMonthlyRecapMonth = '';
}
