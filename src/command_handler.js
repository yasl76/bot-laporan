/**
 * src/command_handler.js
 * Command parser, authorization middleware (Super Admin vs. Allowed User),
 * and business dispatch router for WhatsApp bot commands.
 */

import fs from 'fs';
import path from 'path';
import {
    isSuperAdmin,
    isAllowed,
    addNumber,
    removeNumber,
    listNumbers,
    normalizeNumber,
    loadWhitelist,
    saveWhitelist
} from '../whitelist_helper.js';
import {
    loadConfig,
    updateConfig,
    getConfigSummary
} from '../config_helper.js';
import {
    getLatestParetoFile,
    analyzePareto,
    generatePbExcel,
    getPbSummaryText
} from '../pareto_analyzer.js';
import {
    getStructuredTextRekap,
    generateRekapExcel
} from '../rekap_helper.js';
import {
    parsePosJournal,
    formatPosAuditMessage,
    getActiveOrLatestShift
} from '../struk_parser.js';
import {
    parseNominal,
    formatRp,
    calculateAch,
    escapeRegex
} from './formatters.js';

/**
 * Tokenizes cleanText into command token, arguments array, and payload string.
 * @param {string} cleanText
 * @returns {{ command: string, args: string[], payload: string }}
 */
export function parseCommand(cleanText) {
    if (!cleanText || typeof cleanText !== 'string') {
        return { command: '', args: [], payload: '' };
    }
    const trimmed = cleanText.trim();
    if (!trimmed) {
        return { command: '', args: [], payload: '' };
    }
    const parts = trimmed.split(/\s+/);
    const command = parts[0] || '';
    const args = parts.slice(1);
    const payload = trimmed.slice(command.length).trim();
    return { command, args, payload };
}

/**
 * Main command router entry point.
 * Parses and executes Super Admin or operational command.
 * @param {object} sock - Baileys socket instance (or mock socket with sendMessage)
 * @param {object} m - WAMessage object
 * @param {object} [senderContext={}] - Precomputed metadata { sender, normSender, isSenderAllowed, isSenderSuperAdmin, cleanText, lowerText }
 * @param {object} [options={}] - Optional dependencies/handlers (e.g., setPendingVarianceSession, struckDir, rekapFilePath, paretoDir)
 * @returns {Promise<boolean>} True if command was matched and handled; False otherwise
 */
export async function handleCommand(sock, m, senderContext = {}, options = {}) {
    const cleanText = (senderContext?.cleanText !== undefined ? senderContext.cleanText : (
        m?.message?.conversation ||
        m?.message?.extendedTextMessage?.text ||
        m?.message?.imageMessage?.caption ||
        m?.message?.documentMessage?.caption || ''
    )).trim();

    if (!cleanText) return false;

    const lowerText = senderContext?.lowerText
        ? senderContext.lowerText.trim().toLowerCase()
        : cleanText.toLowerCase();

    const sender = senderContext?.sender || m?.key?.remoteJid || '';
    const normSender = senderContext?.normSender || normalizeNumber(sender);

    const isSenderSuperAdmin = senderContext?.isSenderSuperAdmin !== undefined
        ? Boolean(senderContext.isSenderSuperAdmin)
        : isSuperAdmin(sender || normSender);

    const isSenderAllowed = senderContext?.isSenderAllowed !== undefined
        ? Boolean(senderContext.isSenderAllowed)
        : isAllowed(sender || normSender);

    // ============================================================
    // 1. SUPER ADMIN COMMANDS
    // ============================================================
    const superAdminPrefixes = [
        '!setting', '!pengaturan', '!config',
        '!settarget', '!setrab', '!settoko', '!setstok',
        '!setreminder', '!setjam', '!setvalidasi', '!resetdata',
        '!tambahnomor', '!linklid', '!hapusnomor', '!listnomor', '!whitelist'
    ];

    const isTargetingSuperAdmin = superAdminPrefixes.some(prefix =>
        lowerText === prefix || lowerText.startsWith(prefix + ' ') || lowerText.startsWith(prefix)
    );

    if (isTargetingSuperAdmin) {
        if (!isSenderSuperAdmin) {
            await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
            return true;
        }

        // 1.1 CONFIG SUMMARY (!setting / !pengaturan / !config)
        if (lowerText === '!setting' || lowerText === '!pengaturan' || lowerText === '!config') {
            await sock.sendMessage(sender, { text: getConfigSummary() });
            return true;
        }

        // 1.2 SET TARGET SPD (!settarget [nominal])
        if (lowerText === '!settarget' || lowerText.startsWith('!settarget ')) {
            const parts = cleanText.split(/\s+/);
            const targetVal = parseNominal(parts[1]);
            if (!targetVal || targetVal < 100000) {
                await sock.sendMessage(sender, { text: '⚠️ Format salah. Contoh: *!settarget 5000000* atau *!settarget 4.725.000*' });
                return true;
            }
            updateConfig({ target_spd: targetVal });
            await sock.sendMessage(sender, { text: `✅ Target SPD harian toko berhasil diubah menjadi: *Rp ${formatRp(targetVal)}*` });
            return true;
        }

        // 1.3 SET RAB TARGETS (!setrab [spd] [std] [apc] [gm])
        if (lowerText === '!setrab' || lowerText.startsWith('!setrab ')) {
            const parts = cleanText.split(/\s+/);
            if (parts.length < 5) {
                await sock.sendMessage(sender, {
                    text: `⚠️ Format salah. Gunakan format:\n*!setrab [SPD] [STD] [APC] [GM%]*\nContoh: *!setrab 4725000 135 35000 21.00*`
                });
                return true;
            }
            const spd = parseNominal(parts[1]);
            const std = parseNominal(parts[2]);
            const apc = parseNominal(parts[3]);
            const gm = parts[4].replace(/%/g, '').replace(/,/g, '.').trim();

            if (!spd || spd <= 0 || !std || std <= 0 || !apc || apc <= 0 || isNaN(parseFloat(gm)) || parseFloat(gm) <= 0) {
                await sock.sendMessage(sender, { text: '⚠️ Nilai angka target RAB tidak valid. Mohon periksa kembali!' });
                return true;
            }

            updateConfig({ target_spd: spd, target_std: std, target_apc: apc, target_gm: gm });
            await sock.sendMessage(sender, {
                text: `✅ *Target RAB Berhasil Diperbarui!*\n\n• Target SPD : Rp ${formatRp(spd)}\n• Target STD : ${std}\n• Target APC : Rp ${formatRp(apc)}\n• Target GM% : ${gm}%`
            });
            return true;
        }

        // 1.4 SET PROFIL TOKO (!settoko [Nama] | [Kode] | [Cabang])
        if (lowerText === '!settoko' || lowerText.startsWith('!settoko ')) {
            const payload = cleanText.slice('!settoko'.length).trim();
            const parts = payload.split('|').map(s => s.trim());
            if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
                await sock.sendMessage(sender, {
                    text: '⚠️ Format salah. Pisahkan dengan tanda |\nContoh: *!settoko OMI TITAN EKSEKUTIF MART | O8BM | BEKASI*'
                });
                return true;
            }
            updateConfig({ nama_toko: parts[0], kode_toko: parts[1], cabang: parts[2] });
            await sock.sendMessage(sender, {
                text: `✅ *Profil Toko Berhasil Diperbarui!*\n\n• Nama Toko : *${parts[0]}*\n• Kode Toko : *${parts[1]}*\n• Cabang    : *${parts[2]}*`
            });
            return true;
        }

        // 1.5 SET AMBANG BATAS STOK PB (!setstok [angka])
        if (lowerText === '!setstok' || lowerText.startsWith('!setstok ')) {
            const parts = cleanText.split(/\s+/);
            const stok = parseInt(parts[1], 10);
            if (!stok || stok <= 0 || stok > 500) {
                await sock.sendMessage(sender, { text: '⚠️ Format salah. Masukkan angka wajar (1 - 500).\nContoh: *!setstok 10* atau *!setstok 5*' });
                return true;
            }
            updateConfig({ ambang_stok_pb: stok });
            await sock.sendMessage(sender, { text: `✅ Default ambang batas stok kritis PB berhasil diubah menjadi: *<= ${stok} pcs*` });
            return true;
        }

        // 1.6 SET PENGINGAT CLOSING (!setreminder [jam:menit / off / on])
        if (lowerText === '!setreminder' || lowerText.startsWith('!setreminder ')) {
            const parts = cleanText.split(/\s+/);
            const arg = (parts[1] || '').toLowerCase();

            if (arg === 'off') {
                updateConfig({ reminder_closing_enabled: false });
                await sock.sendMessage(sender, { text: '✅ Pengingat closing harian telah *DINONAKTIFKAN*.' });
                return true;
            }

            if (arg === 'on') {
                updateConfig({ reminder_closing_enabled: true });
                const cfg = loadConfig();
                await sock.sendMessage(sender, {
                    text: `✅ Pengingat closing harian telah *DIAKTIFKAN* (Pukul ${String(cfg.reminder_closing_jam).padStart(2, '0')}:${String(cfg.reminder_closing_menit).padStart(2, '0')} WIB).`
                });
                return true;
            }

            const timeMatch = arg.match(/^(\d{1,2})[:.](\d{1,2})$/);
            if (timeMatch) {
                const jam = parseInt(timeMatch[1], 10);
                const menit = parseInt(timeMatch[2], 10);
                if (jam >= 0 && jam <= 23 && menit >= 0 && menit <= 59) {
                    updateConfig({ reminder_closing_enabled: true, reminder_closing_jam: jam, reminder_closing_menit: menit });
                    await sock.sendMessage(sender, {
                        text: `✅ Pengingat closing harian diatur ke pukul *${String(jam).padStart(2, '0')}:${String(menit).padStart(2, '0')} WIB* (Status: Aktif).`
                    });
                    return true;
                }
            }

            await sock.sendMessage(sender, {
                text: '⚠️ Format salah. Contoh penggunaan:\n• *!setreminder 21:45*\n• *!setreminder off*\n• *!setreminder on*'
            });
            return true;
        }

        // 1.7 SET JAM REKAP BULANAN OTOMATIS (!setjam [jam:menit])
        if (lowerText === '!setjam' || lowerText.startsWith('!setjam ')) {
            const parts = cleanText.split(/\s+/);
            const arg = parts[1] || '';
            const timeMatch = arg.match(/^(\d{1,2})[:.](\d{1,2})$/);
            if (timeMatch) {
                const jam = parseInt(timeMatch[1], 10);
                const menit = parseInt(timeMatch[2], 10);
                if (jam >= 0 && jam <= 23 && menit >= 0 && menit <= 59) {
                    updateConfig({ jam_rekap_otomatis: jam, menit_rekap_otomatis: menit });
                    await sock.sendMessage(sender, {
                        text: `✅ Jadwal pengiriman rekap bulanan otomatis diatur ke pukul *${String(jam).padStart(2, '0')}:${String(menit).padStart(2, '0')} WIB*.`
                    });
                    return true;
                }
            }
            await sock.sendMessage(sender, { text: '⚠️ Format salah. Contoh: *!setjam 23:00*' });
            return true;
        }

        // 1.8 SET VALIDASI SPD (!setvalidasi [min] [max])
        if (lowerText === '!setvalidasi' || lowerText.startsWith('!setvalidasi ')) {
            const parts = cleanText.split(/\s+/);
            const min = parseNominal(parts[1]);
            const max = parseNominal(parts[2]);
            if (!min || !max || min >= max) {
                await sock.sendMessage(sender, { text: '⚠️ Format salah. Contoh: *!setvalidasi 1000000 20000000*' });
                return true;
            }
            updateConfig({ validasi_spd_min: min, validasi_spd_max: max });
            await sock.sendMessage(sender, {
                text: `✅ Rentang validasi SPD wajar diperbarui: *Rp ${formatRp(min)}* s/d *Rp ${formatRp(max)}*`
            });
            return true;
        }

        // 1.9 RESET DATA BULANAN (!resetdata)
        if (lowerText === '!resetdata') {
            const rekapFile = options?.rekapFilePath || 'rekap_data.json';
            if (fs.existsSync(rekapFile)) {
                const oldContent = fs.readFileSync(rekapFile, 'utf8');
                const backupName = `rekap_data_backup_${Date.now()}.json`;
                fs.writeFileSync(backupName, oldContent);
                fs.writeFileSync(rekapFile, '[]');
                await sock.sendMessage(sender, {
                    text: `✅ Seluruh data rekap bulanan berhasil direset ke 0.\n📁 File cadangan disimpan otomatis: *${backupName}*.\nSistem siap mencatat periode baru!`
                });
            } else {
                fs.writeFileSync(rekapFile, '[]');
                await sock.sendMessage(sender, { text: '✅ Database rekap telah disiapkan kosong.' });
            }
            return true;
        }

        // 1.10 TAMBAH NOMOR WHITELIST (!tambahnomor [no] [nama])
        if (lowerText === '!tambahnomor' || lowerText.startsWith('!tambahnomor ')) {
            const cleanParams = cleanText.slice('!tambahnomor'.length).trim();
            let targetNumber = '';
            let targetName = 'Karyawan Toko';

            const bracketMatch = cleanParams.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]$/);
            if (bracketMatch) {
                targetNumber = bracketMatch[1].trim();
                targetName = bracketMatch[2].trim();
            } else {
                const parts = cleanParams.split(/\s+/);
                targetNumber = parts[0] ? parts[0].replace(/[\[\]]/g, '').trim() : '';
                targetName = parts.slice(1).join(' ').replace(/[\[\]]/g, '').trim() || 'Karyawan Toko';
            }

            if (!targetNumber) {
                await sock.sendMessage(sender, {
                    text: '⚠️ Format salah. Contoh penggunaan:\n• *!tambahnomor 08123456789 Budi*\n• *!tambahnomor [08123456789] [Budi]*'
                });
                return true;
            }

            let resolvedLid = '';
            const normTarget = normalizeNumber(targetNumber);
            try {
                if (normTarget && sock?.onWhatsApp) {
                    const waLookup = await sock.onWhatsApp(normTarget);
                    if (waLookup && waLookup.length > 0 && waLookup[0].lid) {
                        resolvedLid = normalizeNumber(waLookup[0].lid);
                    }
                }
            } catch (e) {
                console.log('Tidak dapat lookup LID onWhatsApp:', e.message);
            }

            const res = addNumber(targetNumber, targetName, resolvedLid);
            await sock.sendMessage(sender, { text: res.message });
            return true;
        }

        // 1.11 LINK LID KE NOMOR HP (!linklid [nomor_hp] [lid])
        if (lowerText === '!linklid' || lowerText.startsWith('!linklid ')) {
            const parts = cleanText.split(/\s+/);
            if (parts.length < 3) {
                await sock.sendMessage(sender, { text: '⚠️ Format salah. Contoh:\n*!linklid 082264017152 215633832722432*' });
                return true;
            }
            const targetPhone = normalizeNumber(parts[1]);
            const targetLid = normalizeNumber(parts[2]);
            const wl = loadWhitelist();
            const user = wl.users.find(u => normalizeNumber(u.number) === targetPhone);
            if (!user) {
                await sock.sendMessage(sender, { text: `⚠️ Nomor HP *${targetPhone}* belum terdaftar dalam whitelist. Tambahkan dulu dengan *!tambahnomor*.` });
                return true;
            }
            user.lid = targetLid;
            saveWhitelist(wl);
            await sock.sendMessage(sender, { text: `✅ Berhasil menautkan LID *${targetLid}* ke akun *${user.name}* (${user.number})!` });
            return true;
        }

        // 1.12 HAPUS NOMOR DARI WHITELIST (!hapusnomor [no])
        if (lowerText === '!hapusnomor' || lowerText.startsWith('!hapusnomor ')) {
            const parts = cleanText.split(/\s+/);
            const targetNumber = parts[1];

            if (!targetNumber) {
                await sock.sendMessage(sender, { text: '⚠️ Format salah. Contoh:\n*!hapusnomor 08123456789*' });
                return true;
            }

            const res = removeNumber(targetNumber);
            await sock.sendMessage(sender, { text: res.message });
            return true;
        }

        // 1.13 LIST NOMOR / WHITELIST (!listnomor / !whitelist)
        if (lowerText === '!listnomor' || lowerText === '!whitelist') {
            await sock.sendMessage(sender, { text: listNumbers() });
            return true;
        }
    }

    // ============================================================
    // 2. OPERATIONAL COMMANDS (ALLOWED USERS)
    // ============================================================
    const isTargetingOperational =
        cleanText.includes('!kirimlaporan') ||
        lowerText === 'menu' || lowerText === 'lapor' || lowerText === '!menu' ||
        lowerText === '!auditkas' || lowerText === '!cekshift' ||
        lowerText === '!pb' || lowerText === 'pb' || lowerText.startsWith('!pb ') || lowerText.startsWith('pb ') ||
        lowerText === '!rekap' || lowerText === 'rekap' || lowerText.startsWith('!rekap ') || lowerText.startsWith('rekap ') ||
        lowerText === '!hapusdata';

    if (isTargetingOperational) {
        if (!isSenderAllowed) {
            const wl = loadWhitelist();
            await sock.sendMessage(sender, {
                text: `⚠️ Maaf, nomor Anda (*${normSender}*) belum terdaftar untuk menggunakan bot ini.\nSilakan hubungi Super Admin (${wl.super_admins?.[0] || wl.admin}) untuk pendaftaran akses.`
            });
            return true;
        }

        // 2.1 MENU & TEMPLATE LAPORAN (menu / lapor / !menu)
        if (lowerText === 'lapor' || lowerText === 'menu' || lowerText === '!menu') {
            const isSuper = isSenderSuperAdmin;
            const cfg = loadConfig();

            let templatePesan = `Halo! Silakan salin dan isi data laporan di bawah ini, lalu kirim kembali:\n\n!kirimlaporan\n` +
                `SPD: \n` +
                `STD: \n` +
                `APC: \n` +
                `MGRP: \n` +
                `MG%: \n` +
                `LPP: \n` +
                `Avg SPD: \n` +
                `Avg STD: \n` +
                `Avg APC: \n` +
                `Avg MGRP: \n` +
                `Avg MG%: \n` +
                `YCCG: \n` +
                `Sosis Ori: \n` +
                `Sosis Keju: \n` +
                `MPP: \n` +
                `NBH: \n` +
                `Total MPP: \n` +
                `Total NBH: \n\n` +
                `💡 *Fitur & Perintah Operasional:*\n` +
                `- *!auditkas* : Audit pra-closing kasir (Cash, E-Money, EDC & Uang Laci hari ini)\n` +
                `- *Upload File Kasir (.TXT)* : Otomatis audit rekonsiliasi kas shift berjalan\n` +
                `- *!rekap* : Ringkasan performa penjualan & SO bulan ini\n` +
                `- *!rekap excel* : Unduh file Excel rekapitulasi harian lengkap\n` +
                `- *!pb* : Analisa ringkasan stok pareto kritis (default <= ${cfg.ambang_stok_pb} pcs)\n` +
                `- *!pb [angka]* : Analisa pareto dengan batas stok kustom (cth: *!pb 5*)\n` +
                `- *!pb excel* : Unduh file Excel rekomendasi restock suplier\n` +
                `- *Upload Dokumen (.xls/.xlsx)* : Analisa interaktif dengan pilihan batas stok\n` +
                `- *!hapusdata* : Koreksi/hapus laporan hari ini jika ada salah ketik`;

            if (isSuper) {
                templatePesan += `\n\n👑 *Menu Khusus Super Admin:*\n` +
                    `- *!setting* : Lihat & kelola pengaturan profil toko & target\n` +
                    `- *!settarget [nominal]* : Ubah target SPD harian\n` +
                    `- *!setrab [spd] [std] [apc] [gm]* : Ubah 4 target RAB toko\n` +
                    `- *!settoko [Nama] | [Kode] | [Cabang]* : Ubah profil toko\n` +
                    `- *!setstok [angka]* : Ubah default batas stok kritis PB\n` +
                    `- *!setreminder [jam:menit / off]* : Atur jadwal pengingat closing\n` +
                    `- *!listnomor* : Kelola nomor akses Super Admin & Admin Biasa\n` +
                    `- *!tambahnomor [no] [nama]* : Daftarkan Admin Biasa baru\n` +
                    `- *!hapusnomor [no]* : Hapus nomor admin\n` +
                    `- *!resetdata* : Reset data rekap bulanan baru`;
            }

            await sock.sendMessage(sender, { text: templatePesan });
            return true;
        }

        // 2.2 AUDIT PRA-CLOSING KASIR POS (!auditkas / !cekshift)
        if (lowerText === '!auditkas' || lowerText === '!cekshift') {
            const struckDir = options?.struckDir ? path.resolve(options.struckDir) : path.resolve('struck');
            if (!fs.existsSync(struckDir)) {
                await sock.sendMessage(sender, {
                    text: '⚠️ Folder log jurnal POS (*struck*) belum ditemukan di server.\nSilakan langsung kirimkan/upload file *02-YYYYMMDD.TXT* kasir ke chat ini.'
                });
                return true;
            }

            const txtFiles = fs.readdirSync(struckDir)
                .filter(f => f.toLowerCase().endsWith('.txt') && !f.startsWith('~$'))
                .map(f => ({ name: f, fullPath: path.join(struckDir, f), mtime: fs.statSync(path.join(struckDir, f)).mtime }))
                .sort((a, b) => b.mtime - a.mtime);

            if (txtFiles.length === 0) {
                await sock.sendMessage(sender, {
                    text: '⚠️ Belum ada file log kasir (.TXT) di folder struck.\nSilakan langsung kirimkan file *02-YYYYMMDD.TXT* kasir Anda ke chat ini.'
                });
                return true;
            }

            try {
                const latestTxt = txtFiles[0].fullPath;
                await sock.sendMessage(sender, {
                    text: `⏳ Memproses audit pra-closing dari log kasir terbaru (*${txtFiles[0].name}*)...`
                });
                const auditResult = parsePosJournal(latestTxt);
                const auditMsg = formatPosAuditMessage(auditResult);
                await sock.sendMessage(sender, { text: auditMsg });

                // Interactive cash drawer variance hook
                if (options?.setPendingVarianceSession) {
                    const activeShift = getActiveOrLatestShift(auditResult);
                    if (activeShift) {
                        options.setPendingVarianceSession(normSender, {
                            shift: activeShift,
                            tanggal: auditResult.tanggal,
                            station: auditResult.station
                        });
                        const invite = `\n💡 *Rekonsiliasi Kas Laci Langsung:*\n` +
                            `Ketik nominal uang fisik kas di laci saat ini (cth: *${activeShift.totalFisikLaci}* atau *Rp ${formatRp(activeShift.totalFisikLaci)}*) untuk menghitung selisih (variance), atau ketik *batal*.`;
                        await sock.sendMessage(sender, { text: invite });
                    }
                }
            } catch (err) {
                console.error('Error saat !auditkas:', err);
                await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan saat audit kas: ${err.message}` });
            }
            return true;
        }

        // 2.3 PB EXCEL REPORT GENERATION (!pb excel / !pb excel [angka])
        if (lowerText.startsWith('!pb excel') || lowerText.startsWith('pb excel')) {
            const baseDir = options?.paretoDir || '.';
            const latestFile = getLatestParetoFile(baseDir);
            if (!latestFile) {
                await sock.sendMessage(sender, {
                    text: '⚠️ File laporan Pareto (.xls / .xlsx) belum ditemukan di server.\nSilakan kirimkan file Excel Pareto Anda ke chat bot ini.'
                });
                return true;
            }

            let outPath = null;
            try {
                const cfg = loadConfig();
                const storeInfo = { nama_toko: cfg.nama_toko, kode_toko: cfg.kode_toko, cabang: cfg.cabang };

                const parts = cleanText.split(/\s+/);
                let threshold = cfg.ambang_stok_pb || 10;
                if (parts.length > 2 && /^\d+$/.test(parts[2])) {
                    threshold = parseInt(parts[2], 10);
                }

                await sock.sendMessage(sender, {
                    text: `⏳ Sedang meng-generate file Excel rekomendasi PB (Batas stok <= *${threshold} pcs*)...`
                });

                const analysis = analyzePareto(latestFile, threshold);
                const optionsDate = { day: 'numeric', month: 'long', year: 'numeric' };
                const todayClean = new Date().toLocaleDateString('id-ID', optionsDate).replace(/[\s\/]/g, '_');
                outPath = `Laporan_PB_Pareto_${Date.now()}.xlsx`;
                await generatePbExcel(analysis, outPath, storeInfo);

                await sock.sendMessage(sender, {
                    document: fs.readFileSync(outPath),
                    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    fileName: `Laporan_PB_Pareto_${todayClean}.xlsx`,
                    caption: `📊 *Laporan Rekomendasi PB (Pareto Toko)*\nTotal: ${analysis.totalKritis} item kritis yang perlu di-restock oleh suplier.`
                });
            } catch (err) {
                await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan: ${err.message}` });
            } finally {
                if (outPath) {
                    try {
                        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
                    } catch (_) {}
                }
            }
            return true;
        }

        // 2.4 PB TEXT SUMMARY (!pb / pb / !pb [angka])
        if (lowerText === '!pb' || lowerText === 'pb' || lowerText.startsWith('!pb ') || lowerText.startsWith('pb ')) {
            const baseDir = options?.paretoDir || '.';
            const latestFile = getLatestParetoFile(baseDir);
            if (!latestFile) {
                await sock.sendMessage(sender, {
                    text: '⚠️ File laporan Pareto (.xls / .xlsx) belum ditemukan di server.\nSilakan kirimkan file Excel Pareto Anda ke chat bot ini.'
                });
                return true;
            }

            try {
                const cfg = loadConfig();
                const storeInfo = { nama_toko: cfg.nama_toko, kode_toko: cfg.kode_toko, cabang: cfg.cabang };

                const parts = cleanText.split(/\s+/);
                let threshold = cfg.ambang_stok_pb || 10;
                if (parts.length > 1 && /^\d+$/.test(parts[1])) {
                    threshold = parseInt(parts[1], 10);
                }

                await sock.sendMessage(sender, {
                    text: `⏳ Menganalisa stok pareto toko (Batas sisa stok <= *${threshold} pcs*)...`
                });

                const analysis = analyzePareto(latestFile, threshold);
                const summary = getPbSummaryText(analysis, 10, storeInfo);
                await sock.sendMessage(sender, { text: summary });
            } catch (err) {
                await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan saat membaca file pareto: ${err.message}` });
            }
            return true;
        }

        // 2.5 REKAP EXCEL REPORT GENERATION (!rekap excel)
        if (lowerText === '!rekap excel' || lowerText === 'rekap excel') {
            const rekapFile = options?.rekapFilePath || 'rekap_data.json';
            if (!fs.existsSync(rekapFile) || fs.readFileSync(rekapFile, 'utf8') === '[]') {
                await sock.sendMessage(sender, { text: '⚠️ Belum ada data laporan yang tersimpan untuk di-export ke Excel.' });
                return true;
            }

            let outPath = null;
            try {
                await sock.sendMessage(sender, { text: '⏳ Sedang meng-generate file Excel rekapitulasi performa toko...' });
                const cfg = loadConfig();
                const storeInfo = { nama_toko: cfg.nama_toko, kode_toko: cfg.kode_toko, cabang: cfg.cabang };

                const fileContent = fs.readFileSync(rekapFile, 'utf8');
                const dataList = JSON.parse(fileContent);

                const optionsDate = { month: 'long', year: 'numeric' };
                const monthClean = new Date().toLocaleDateString('id-ID', optionsDate).replace(/[\s\/]/g, '_');
                outPath = `Rekap_Bulanan_${Date.now()}.xlsx`;

                generateRekapExcel(dataList, outPath, cfg.target_spd, storeInfo);

                await sock.sendMessage(sender, {
                    document: fs.readFileSync(outPath),
                    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    fileName: `Rekap_Bulanan_${monthClean}.xlsx`,
                    caption: `📊 *File Rekapitulasi Penjualan Harian & Bulanan*\n${cfg.nama_toko} (${cfg.kode_toko})`
                });
            } catch (err) {
                await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan: ${err.message}` });
            } finally {
                if (outPath) {
                    try {
                        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
                    } catch (_) {}
                }
            }
            return true;
        }

        // 2.6 REKAP TEXT SUMMARY (!rekap / rekap)
        if (lowerText === '!rekap' || lowerText === 'rekap') {
            const rekapFile = options?.rekapFilePath || 'rekap_data.json';
            if (!fs.existsSync(rekapFile) || fs.readFileSync(rekapFile, 'utf8') === '[]') {
                await sock.sendMessage(sender, { text: '⚠️ Belum ada data laporan yang tersimpan untuk direkap bulan ini.' });
                return true;
            }

            const cfg = loadConfig();
            const storeInfo = { nama_toko: cfg.nama_toko, kode_toko: cfg.kode_toko, cabang: cfg.cabang };

            const fileContent = fs.readFileSync(rekapFile, 'utf8');
            const dataList = JSON.parse(fileContent);
            const pesanRekap = getStructuredTextRekap(dataList, cfg.target_spd, storeInfo);
            await sock.sendMessage(sender, { text: pesanRekap });
            return true;
        }

        // 2.7 HAPUS DATA LAPORAN HARI INI (!hapusdata)
        if (lowerText === '!hapusdata') {
            const rekapFile = options?.rekapFilePath || 'rekap_data.json';
            if (!fs.existsSync(rekapFile)) {
                await sock.sendMessage(sender, { text: '⚠️ Belum ada file data rekap.' });
                return true;
            }

            const optionsDate = { day: 'numeric', month: 'long', year: 'numeric' };
            const today = new Date().toLocaleDateString('id-ID', optionsDate);

            const fileContent = fs.readFileSync(rekapFile, 'utf8');
            let dataList = fileContent ? JSON.parse(fileContent) : [];

            const panjangAwal = dataList.length;
            dataList = dataList.filter(item => item.tanggal !== today);

            if (dataList.length < panjangAwal) {
                fs.writeFileSync(rekapFile, JSON.stringify(dataList, null, 2));
                await sock.sendMessage(sender, { text: `✅ Data laporan tanggal *${today}* berhasil dihapus. Silakan kirim ulang!` });
            } else {
                await sock.sendMessage(sender, { text: `ℹ️ Tidak ada data laporan tanggal *${today}* yang tersimpan.` });
            }
            return true;
        }

        // 2.8 SUBMIT LAPORAN PERFORMA HARIAN (!kirimlaporan)
        if (cleanText.includes('!kirimlaporan')) {
            const extractValue = (key) => {
                const escaped = escapeRegex(key);
                const regex = new RegExp(`(^|\\n)\\s*${escaped}\\s*:\\s*([^\\n]*)`, 'i');
                const match = cleanText.match(regex);
                return match && match[2] ? match[2].trim().replace(/%/g, '').trim() : '';
            };

            const spd = extractValue('SPD');
            if (!spd) return true;

            const cfg = loadConfig();

            const std = extractValue('STD');
            const apc = extractValue('APC');
            const mgrp = extractValue('MGRP');
            const mg = extractValue('MG%') || extractValue('MG');
            const lpp = extractValue('LPP');
            const avgSpd = extractValue('Avg SPD');
            const avgStd = extractValue('Avg STD');
            const avgApc = extractValue('Avg APC');
            const avgMgrp = extractValue('Avg MGRP');
            const avgMg = extractValue('Avg MG%') || extractValue('Avg MG');
            const yccg = extractValue('YCCG');
            const sosisOri = extractValue('Sosis Ori');
            const sosisKeju = extractValue('Sosis Keju');
            const mpp = extractValue('MPP');
            const nbh = extractValue('NBH');
            const totalMpp = extractValue('Total MPP');
            const totalNbh = extractValue('Total NBH');

            // --- VALIDASI ANGKA SPD SECARA DINAMIS DARI CONFIG ---
            const numSpd = parseNominal(spd);
            const minSpd = cfg.validasi_spd_min || 1000000;
            const maxSpd = cfg.validasi_spd_max || 20000000;

            if (numSpd < minSpd || numSpd > maxSpd) {
                await sock.sendMessage(sender, {
                    text: `⚠️ *Peringatan Anomali Data!*\n\nNilai SPD yang Anda masukkan (*${spd}*) terlihat tidak wajar atau salah ketik.\nBatas wajar sistem saat ini: *Rp ${formatRp(minSpd)}* s/d *Rp ${formatRp(maxSpd)}*.\nMohon periksa dan kirim ulang laporan Anda!`
                });
                return true;
            }

            const numStd = parseNominal(std);
            const numApc = parseNominal(apc);
            const numMgrp = parseNominal(mgrp);
            const numLpp = parseNominal(lpp);
            const numAvgSpd = parseNominal(avgSpd);
            const numAvgStd = parseNominal(avgStd);
            const numAvgApc = parseNominal(avgApc);
            const numAvgMgrp = parseNominal(avgMgrp);

            const numYccg = parseNominal(yccg);
            const numSosisOri = parseNominal(sosisOri);
            const numSosisKeju = parseNominal(sosisKeju);
            const totalRte = numSosisOri + numSosisKeju;

            const numMpp = parseNominal(mpp);
            const numNbh = parseNominal(nbh);
            const numTotalMpp = parseNominal(totalMpp) || numMpp;
            const numTotalNbh = parseNominal(totalNbh) || numNbh;

            // Tanggal Otomatis Hari Ini
            const optionsDate = { day: 'numeric', month: 'long', year: 'numeric' };
            const today = new Date().toLocaleDateString('id-ID', optionsDate);

            // Perhitungan Persentase ACH Harian & MTD menggunakan calculateAch dari ./formatters.js
            const targetSpd = cfg.target_spd || 4725000;
            const achHarian = calculateAch(numSpd, targetSpd);
            const achMtd = numAvgSpd > 0
                ? calculateAch(numAvgSpd, targetSpd)
                : calculateAch(numSpd, targetSpd);

            // --- SIMPAN / TIMPA DATA KE FILE REKAP OTOMATIS ---
            const dataBaru = {
                tanggal: today,
                spd: numSpd,
                std: numStd,
                apc: numApc,
                mgrp: numMgrp,
                mg: mg || '',
                lpp: numLpp,
                avg_spd: numAvgSpd,
                avg_std: numAvgStd,
                avg_apc: numAvgApc,
                avg_mgrp: numAvgMgrp,
                avg_mg: avgMg || '',
                yccg: numYccg,
                sosis_ori: numSosisOri,
                sosis_keju: numSosisKeju,
                total_rte: totalRte,
                mpp: numMpp,
                nbh: numNbh,
                total_mpp: numTotalMpp,
                total_nbh: numTotalNbh
            };

            const rekapFile = options?.rekapFilePath || 'rekap_data.json';
            let semuaData = [];
            if (fs.existsSync(rekapFile)) {
                try {
                    const fileContent = fs.readFileSync(rekapFile, 'utf8');
                    semuaData = fileContent ? JSON.parse(fileContent) : [];
                    if (!Array.isArray(semuaData)) semuaData = [];
                } catch (_) {
                    semuaData = [];
                }
            }
            semuaData = semuaData.filter(item => item.tanggal !== today);
            semuaData.push(dataBaru);
            fs.writeFileSync(rekapFile, JSON.stringify(semuaData, null, 2));

            // Format Pesan Balasan Resmi Berdasarkan Konfigurasi Dinamis Toko
            const laporanTeks = `LAPORAN PERFORMANCE GO    \n\n` +
                `TGL Grand OPENING   : ${cfg.tgl_grand_opening}\n` +
                `Type Harga : ${cfg.type_harga}\n\n` +
                `NAMA TOKO : ${cfg.nama_toko}\n` +
                `KODE TOKO  : ${cfg.kode_toko}\n` +
                `CABANG         : ${cfg.cabang}\n\n` +
                `================================\n\n` +
                `TARGET RAB     \n\n` +
                `SPD : ${formatRp(cfg.target_spd)}\n` +
                `STD : ${cfg.target_std}\n` +
                `APC : ${formatRp(cfg.target_apc)}\n` +
                `GM : ${cfg.target_gm}\n\n` +
                `================================\n` +
                `Sales Tanggal  : ${today}\n\n` +
                `SPD : ${formatRp(numSpd)}\n` +
                `ACH HARIAN : ${achHarian}%\n` +
                `STD  : ${std || numStd}\n` +
                `APC  : ${formatRp(numApc)}\n` +
                `MGRP : ${formatRp(numMgrp)}\n` +
                `MG% :  ${mg}%\n` +
                `LPP OMI: ${formatRp(numLpp)}\n\n` +
                `AVG Sales Tgl   : 01- ${today}\n` +
                `SPD : ${formatRp(numAvgSpd)}\n` +
                `ACH MTD : ${achMtd}%\n` +
                `STD : ${avgStd || numAvgStd}\n` +
                `APC : ${formatRp(numAvgApc)}\n` +
                `MGRP : ${formatRp(numAvgMgrp)}\n` +
                `MG%: ${avgMg}%\n` +
                `============================ \n` +
                `Penjualan yccg\n` +
                `Total keluar : ${numYccg} cup\n\n` +
                `Penjualan rte\n` +
                `Sosis ori: ${numSosisOri}\n` +
                `Sosis keju: ${numSosisKeju}\n` +
                `Total:${totalRte}\n\n\n` +
                `LAPORAN STOCK OPNAME :\n` +
                `SO Tanggal ${today}\n` +
                `MPP : ${mpp || 0}\n` +
                `NBH : ${nbh || 0}\n\n` +
                `Total SO 01-${today}\n` +
                `MPP : ${totalMpp || mpp || 0}\n` +
                `NBH : ${totalNbh || nbh || 0}\n\n` +
                `Terima kasih 🙏`;

            await sock.sendMessage(sender, { text: laporanTeks });
            return true;
        }
    }

    return false;
}
