import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';

import { isAllowed, isSuperAdmin, isAdmin, addNumber, removeNumber, listNumbers, normalizeNumber, loadWhitelist } from './whitelist_helper.js';
import { getLatestParetoFile, analyzePareto, generatePbExcel, getPbSummaryText } from './pareto_analyzer.js';
import { getStructuredTextRekap, generateRekapExcel } from './rekap_helper.js';
import { loadConfig, updateConfig, getConfigSummary } from './config_helper.js';

function parseNominal(val) {
    if (val === undefined || val === null) return 0;
    const clean = String(val).replace(/[^0-9]/g, '');
    return clean ? parseFloat(clean) : 0;
}

const formatRp = (angka) => new Intl.NumberFormat('id-ID').format(Math.round(angka) || 0);

// Map untuk alur konfirmasi interaktif upload file Pareto:
// Key: normalized sender number
// Value: { filePath, fileName, timestamp }
const pendingParetoUploads = new Map();

async function startBot() {
    console.log('⏳ Memulai program bot laporan & analisa pareto toko...');

    const { state, saveCreds } = await useMultiFileAuthState('sesi_bot');

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
            console.log(`🔄 Koneksi terputus (Kode: ${statusCode || 'unknown'}), menyambung ulang...`, !isLoggedOut);

            if (isLoggedOut) {
                console.log('⚠️ Sesi WhatsApp telah logout atau tidak valid. Mereset sesi_bot agar QR code baru dapat dibuat...');
                try {
                    fs.rmSync('sesi_bot', { recursive: true, force: true });
                } catch (e) {
                    console.error('Error saat mereset sesi:', e);
                }
                setTimeout(startBot, 3000);
            } else {
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('\n✅ BOT BERHASIL TERHUBUNG & SIAP DIGUNAKAN!');
            setupScheduler(sock);
        }
    });

    // PENGOLAHAN PESAN MASUK
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m || !m.message) return;

        const sender = m.key.remoteJid;
        const senderNumber = m.key.participant || sender;
        const senderPn = m.key.senderPn || m.key.participantPn || '';
        const senderLid = m.key.senderLid || m.key.participantLid || '';

        const candidates = [
            normalizeNumber(senderNumber),
            normalizeNumber(sender),
            normalizeNumber(senderPn),
            normalizeNumber(senderLid)
        ].filter(Boolean);

        const normSender = candidates[0] || normalizeNumber(senderNumber);
        const isSenderSuperAdmin = candidates.some(c => isSuperAdmin(c));
        const isSenderAllowed = candidates.some(c => isAllowed(c));

        // Auto-link LID WhatsApp ke pengguna terdaftar jika belum tersimpan
        if (sender.endsWith('@lid') && isSenderAllowed) {
            const currentLid = normalizeNumber(sender);
            const wl = loadWhitelist();
            const matchedUser = wl.users.find(u => candidates.includes(normalizeNumber(u.number)));
            if (matchedUser && !matchedUser.lid) {
                matchedUser.lid = currentLid;
                saveWhitelist(wl);
                console.log(`🔗 Auto-link LID WhatsApp ${currentLid} ke ${matchedUser.name} (${matchedUser.number})`);
            }
        }

        const text = m.message.conversation ||
                     m.message.extendedTextMessage?.text ||
                     m.message.imageMessage?.caption ||
                     m.message.documentMessage?.caption || '';

        const cleanText = text.trim();
        const lowerText = cleanText.toLowerCase();

        // Izinkan pesan dari diri sendiri (Message Yourself) HANYA jika berupa perintah bot eksplisit atau angka konfirmasi
        const isBotCommandKeyword = lowerText.startsWith('!') ||
                                    ['menu', 'lapor', 'rekap', 'pb', 'batal'].includes(lowerText) ||
                                    /^\d+$/.test(lowerText);
        const botUserNumber = sock.user?.id ? normalizeNumber(sock.user.id) : '';
        const isSelfChat = m.key.fromMe && (normalizeNumber(sender) === botUserNumber || sender.endsWith('@lid'));

        // Jika pesan dari bot sendiri dan bukan perintah di self-chat, abaikan agar tidak looping
        if (m.key.fromMe && !(isSelfChat && isBotCommandKeyword)) {
            return;
        }

        // ============================================================
        // 1. PENANGANAN UPLOAD DOKUMEN EXCEL PARETO
        // ============================================================
        if (m.message.documentMessage) {
            const doc = m.message.documentMessage;
            const fileName = (doc.fileName || '').toLowerCase();

            if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
                if (!isSenderAllowed) {
                    const wl = loadWhitelist();
                    await sock.sendMessage(sender, {
                        text: `⚠️ Maaf, nomor Anda (*${normSender}*) belum terdaftar untuk mengupload data ke bot.\nSilakan hubungi Super Admin (${wl.super_admins?.[0] || wl.admin}).`
                    });
                    return;
                }

                try {
                    const buffer = await downloadMediaMessage(m, 'buffer', {});
                    const ext = path.extname(doc.fileName) || '.xls';
                    const savedPath = `pareto_uploaded_${Date.now()}${ext}`;
                    fs.writeFileSync(savedPath, buffer);

                    const cfg = loadConfig();
                    const storeInfo = { nama_toko: cfg.nama_toko, kode_toko: cfg.kode_toko, cabang: cfg.cabang };

                    // Cek apakah user langsung menentukan angka ambang batas pada caption, cth: "!pb 5" atau "!pb 15"
                    const directMatch = cleanText.match(/^!pb\s+(\d+)$/i);
                    if (directMatch) {
                        const directThreshold = parseInt(directMatch[1]);
                        await sock.sendMessage(sender, {
                            text: `⏳ Mengunduh dan menganalisa dokumen pareto *${doc.fileName}* (Ambang Batas Stok <= *${directThreshold} pcs*)...`
                        });

                        const analysis = analyzePareto(savedPath, directThreshold);
                        const summaryText = getPbSummaryText(analysis, 10, storeInfo);
                        const excelOutput = `Laporan_PB_Pareto_${Date.now()}.xlsx`;
                        await generatePbExcel(analysis, excelOutput, storeInfo);

                        await sock.sendMessage(sender, { text: summaryText });
                        await sock.sendMessage(sender, {
                            document: fs.readFileSync(excelOutput),
                            mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            fileName: `Laporan_PB_Pareto_${new Date().toLocaleDateString('id-ID').replace(/[\/\s]/g, '-')}.xlsx`,
                            caption: `📊 *Hasil Analisa Dokumen Pareto (Batas: <= ${directThreshold} pcs)*\nFile Excel rekomendasi restock ${analysis.totalKritis} item kritis siap kirim ke supplier.`
                        });

                        try { fs.unlinkSync(excelOutput); } catch (_) {}
                        return;
                    }

                    // ALUR KONFIRMASI INTERAKTIF:
                    // Simpan file sementara dan minta user menentukan ambang batas stok
                    if (pendingParetoUploads.has(normSender)) {
                        const old = pendingParetoUploads.get(normSender);
                        try { fs.unlinkSync(old.filePath); } catch (_) {}
                    }

                    pendingParetoUploads.set(normSender, {
                        filePath: savedPath,
                        fileName: doc.fileName || 'Dokumen Pareto',
                        timestamp: Date.now()
                    });

                    const defaultStok = cfg.ambang_stok_pb || 10;
                    const promptText = `📥 *DOKUMEN PARETO DITERIMA!*\n` +
                        `• File: *${doc.fileName}*\n\n` +
                        `Silakan ketik angka ambang batas sisa stok yang ingin dianalisa:\n` +
                        `1️⃣ Ketik *${defaultStok}* : Analisa item kritis (Stok <= ${defaultStok} pcs) [Standar]\n` +
                        `2️⃣ Ketik *5*  : Analisa item sangat kritis (Stok <= 5 pcs) [Urgent]\n` +
                        `3️⃣ Ketik *angka lain* (misal: *15*, *20*) sesuai kebutuhan analisa toko\n` +
                        `4️⃣ Ketik *batal* : Batalkan analisa dokumen ini\n\n` +
                        `⏳ _Kirimkan angka ambang batas stok untuk melanjutkan analisa..._`;

                    await sock.sendMessage(sender, { text: promptText });
                    return;
                } catch (err) {
                    console.error('Error memproses dokumen pareto:', err);
                    await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan saat memproses file pareto: ${err.message}` });
                    return;
                }
            }
        }

        // ============================================================
        // 1.1 RESPONS ALUR KONFIRMASI INTERAKTIF PARETO
        // ============================================================
        if (pendingParetoUploads.has(normSender)) {
            const pending = pendingParetoUploads.get(normSender);

            // Timeout 10 menit
            if (Date.now() - pending.timestamp > 10 * 60 * 1000) {
                try { fs.unlinkSync(pending.filePath); } catch (_) {}
                pendingParetoUploads.delete(normSender);
            } else if (lowerText === 'batal') {
                try { fs.unlinkSync(pending.filePath); } catch (_) {}
                pendingParetoUploads.delete(normSender);
                await sock.sendMessage(sender, { text: `❌ Analisa dokumen pareto *${pending.fileName}* telah dibatalkan.` });
                return;
            } else if (/^\d+$/.test(lowerText)) {
                const chosenThreshold = parseInt(lowerText);
                if (chosenThreshold <= 0 || chosenThreshold > 500) {
                    await sock.sendMessage(sender, { text: `⚠️ Harap masukkan angka ambang batas stok yang wajar (1 - 500) atau ketik *batal*.` });
                    return;
                }

                pendingParetoUploads.delete(normSender);
                await sock.sendMessage(sender, {
                    text: `⏳ Sedang menganalisa dokumen *${pending.fileName}* dengan ambang batas stok <= *${chosenThreshold} pcs*...`
                });

                try {
                    const cfg = loadConfig();
                    const storeInfo = { nama_toko: cfg.nama_toko, kode_toko: cfg.kode_toko, cabang: cfg.cabang };
                    const analysis = analyzePareto(pending.filePath, chosenThreshold);
                    const summaryText = getPbSummaryText(analysis, 10, storeInfo);
                    const excelOutput = `Laporan_PB_Pareto_${Date.now()}.xlsx`;
                    await generatePbExcel(analysis, excelOutput, storeInfo);

                    await sock.sendMessage(sender, { text: summaryText });
                    await sock.sendMessage(sender, {
                        document: fs.readFileSync(excelOutput),
                        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        fileName: `Laporan_PB_Pareto_${new Date().toLocaleDateString('id-ID').replace(/[\/\s]/g, '-')}.xlsx`,
                        caption: `📊 *Hasil Analisa Dokumen Pareto (Batas: <= ${chosenThreshold} pcs)*\nFile Excel rekomendasi restock ${analysis.totalKritis} item kritis siap kirim ke supplier.`
                    });

                    try { fs.unlinkSync(excelOutput); } catch (_) {}
                    return;
                } catch (err) {
                    console.error('Error saat analisa interaktif:', err);
                    await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan analisa pareto: ${err.message}` });
                    return;
                }
            } else {
                // Jika user mengetik perintah bot lain, bersihkan pending upload agar tidak tersangkut
                if (lowerText.startsWith('!') || ['menu', 'lapor', 'rekap', 'pb'].includes(lowerText)) {
                    try { fs.unlinkSync(pending.filePath); } catch (_) {}
                    pendingParetoUploads.delete(normSender);
                } else {
                    await sock.sendMessage(sender, {
                        text: `⚠️ Mohon ketik angka ambang batas stok (misal: *10*, *5*, *15*), atau ketik *batal* untuk membatalkan analisa file *${pending.fileName}*.`
                    });
                    return;
                }
            }
        }

        // ============================================================
        // 2. PERINTAH KHUSUS SUPER ADMIN
        // ============================================================

        // 2.1 PENGATURAN TOKO & KONFIGURASI (!setting / !pengaturan)
        if (lowerText === '!setting' || lowerText === '!pengaturan' || lowerText === '!config') {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }
            await sock.sendMessage(sender, { text: getConfigSummary() });
            return;
        }

        // 2.2 UBAH TARGET SPD (!settarget [nominal])
        if (lowerText.startsWith('!settarget')) {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }
            const parts = cleanText.split(/\s+/);
            const targetVal = parseNominal(parts[1]);
            if (!targetVal || targetVal < 100000) {
                await sock.sendMessage(sender, { text: '⚠️ Format salah. Contoh: *!settarget 5000000* atau *!settarget 4.725.000*' });
                return;
            }
            updateConfig({ target_spd: targetVal });
            await sock.sendMessage(sender, { text: `✅ Target SPD harian toko berhasil diubah menjadi: *Rp ${formatRp(targetVal)}*` });
            return;
        }

        // 2.3 UBAH TARGET RAB LENGKAP (!setrab [spd] [std] [apc] [gm])
        if (lowerText.startsWith('!setrab')) {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }
            const parts = cleanText.split(/\s+/);
            if (parts.length < 5) {
                await sock.sendMessage(sender, {
                    text: `⚠️ Format salah. Gunakan format:\n*!setrab [SPD] [STD] [APC] [GM%]*\nContoh: *!setrab 4725000 135 35000 21.00*`
                });
                return;
            }
            const spd = parseNominal(parts[1]);
            const std = parseNominal(parts[2]);
            const apc = parseNominal(parts[3]);
            const gm = parts[4].replace(/%/g, '').trim();

            if (!spd || !std || !apc || !gm) {
                await sock.sendMessage(sender, { text: '⚠️ Nilai angka target RAB tidak valid. Mohon periksa kembali!' });
                return;
            }

            updateConfig({ target_spd: spd, target_std: std, target_apc: apc, target_gm: gm });
            await sock.sendMessage(sender, {
                text: `✅ *Target RAB Berhasil Diperbarui!*\n\n• Target SPD : Rp ${formatRp(spd)}\n• Target STD : ${std}\n• Target APC : Rp ${formatRp(apc)}\n• Target GM% : ${gm}%`
            });
            return;
        }

        // 2.4 UBAH PROFIL TOKO (!settoko [Nama] | [Kode] | [Cabang])
        if (lowerText.startsWith('!settoko')) {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }
            const payload = cleanText.slice('!settoko'.length).trim();
            const parts = payload.split('|').map(s => s.trim());
            if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
                await sock.sendMessage(sender, {
                    text: '⚠️ Format salah. Pisahkan dengan tanda |\nContoh: *!settoko OMI TITAN EKSEKUTIF MART | O8BM | BEKASI*'
                });
                return;
            }
            updateConfig({ nama_toko: parts[0], kode_toko: parts[1], cabang: parts[2] });
            await sock.sendMessage(sender, {
                text: `✅ *Profil Toko Berhasil Diperbarui!*\n\n• Nama Toko : *${parts[0]}*\n• Kode Toko : *${parts[1]}*\n• Cabang    : *${parts[2]}*`
            });
            return;
        }

        // 2.5 UBAH DEFAULT AMBANG BATAS STOK PARETO (!setstok [angka])
        if (lowerText.startsWith('!setstok')) {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }
            const parts = cleanText.split(/\s+/);
            const stok = parseInt(parts[1]);
            if (!stok || stok <= 0 || stok > 500) {
                await sock.sendMessage(sender, { text: '⚠️ Format salah. Masukkan angka wajar (1 - 500).\nContoh: *!setstok 10* atau *!setstok 5*' });
                return;
            }
            updateConfig({ ambang_stok_pb: stok });
            await sock.sendMessage(sender, { text: `✅ Default ambang batas stok kritis PB berhasil diubah menjadi: *<= ${stok} pcs*` });
            return;
        }

        // 2.6 ATUR PENGINGAT CLOSING (!setreminder [jam:menit / off / on])
        if (lowerText.startsWith('!setreminder')) {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }
            const parts = cleanText.split(/\s+/);
            const arg = (parts[1] || '').toLowerCase();

            if (arg === 'off') {
                updateConfig({ reminder_closing_enabled: false });
                await sock.sendMessage(sender, { text: '✅ Pengingat closing harian telah *DINONAKTIFKAN*.' });
                return;
            }

            if (arg === 'on') {
                updateConfig({ reminder_closing_enabled: true });
                const cfg = loadConfig();
                await sock.sendMessage(sender, {
                    text: `✅ Pengingat closing harian telah *DIAKTIFKAN* (Pukul ${String(cfg.reminder_closing_jam).padStart(2, '0')}:${String(cfg.reminder_closing_menit).padStart(2, '0')} WIB).`
                });
                return;
            }

            const timeMatch = arg.match(/^(\d{1,2})[:.](\d{1,2})$/);
            if (timeMatch) {
                const jam = parseInt(timeMatch[1]);
                const menit = parseInt(timeMatch[2]);
                if (jam >= 0 && jam <= 23 && menit >= 0 && menit <= 59) {
                    updateConfig({ reminder_closing_enabled: true, reminder_closing_jam: jam, reminder_closing_menit: menit });
                    await sock.sendMessage(sender, {
                        text: `✅ Pengingat closing harian diatur ke pukul *${String(jam).padStart(2, '0')}:${String(menit).padStart(2, '0')} WIB* (Status: Aktif).`
                    });
                    return;
                }
            }

            await sock.sendMessage(sender, {
                text: '⚠️ Format salah. Contoh penggunaan:\n• *!setreminder 21:45*\n• *!setreminder off*\n• *!setreminder on*'
            });
            return;
        }

        // 2.7 ATUR JAM REKAP BULANAN OTOMATIS (!setjam [jam:menit])
        if (lowerText.startsWith('!setjam')) {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }
            const parts = cleanText.split(/\s+/);
            const arg = parts[1] || '';
            const timeMatch = arg.match(/^(\d{1,2})[:.](\d{1,2})$/);
            if (timeMatch) {
                const jam = parseInt(timeMatch[1]);
                const menit = parseInt(timeMatch[2]);
                if (jam >= 0 && jam <= 23 && menit >= 0 && menit <= 59) {
                    updateConfig({ jam_rekap_otomatis: jam, menit_rekap_otomatis: menit });
                    await sock.sendMessage(sender, {
                        text: `✅ Jadwal pengiriman rekap bulanan otomatis diatur ke pukul *${String(jam).padStart(2, '0')}:${String(menit).padStart(2, '0')} WIB*.`
                    });
                    return;
                }
            }
            await sock.sendMessage(sender, { text: '⚠️ Format salah. Contoh: *!setjam 23:00*' });
            return;
        }

        // 2.8 ATUR VALIDASI RENTANG SPD (!setvalidasi [min] [max])
        if (lowerText.startsWith('!setvalidasi')) {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }
            const parts = cleanText.split(/\s+/);
            const min = parseNominal(parts[1]);
            const max = parseNominal(parts[2]);
            if (!min || !max || min >= max) {
                await sock.sendMessage(sender, { text: '⚠️ Format salah. Contoh: *!setvalidasi 1000000 20000000*' });
                return;
            }
            updateConfig({ validasi_spd_min: min, validasi_spd_max: max });
            await sock.sendMessage(sender, {
                text: `✅ Rentang validasi SPD wajar diperbarui: *Rp ${formatRp(min)}* s/d *Rp ${formatRp(max)}*`
            });
            return;
        }

        // 2.9 RESET DATA BULANAN (!resetdata)
        if (lowerText === '!resetdata') {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }
            if (fs.existsSync('rekap_data.json')) {
                const oldContent = fs.readFileSync('rekap_data.json', 'utf8');
                const backupName = `rekap_data_backup_${Date.now()}.json`;
                fs.writeFileSync(backupName, oldContent);
                fs.writeFileSync('rekap_data.json', '[]');
                await sock.sendMessage(sender, {
                    text: `✅ Seluruh data rekap bulanan berhasil direset ke 0.\n📁 File cadangan disimpan otomatis: *${backupName}*.\nSistem siap mencatat periode baru!`
                });
            } else {
                fs.writeFileSync('rekap_data.json', '[]');
                await sock.sendMessage(sender, { text: '✅ Database rekap telah disiapkan kosong.' });
            }
            return;
        }

        // 2.10 MANAJEMEN WHITELIST (TAMBAH / HAPUS / LIST)
        if (lowerText.startsWith('!tambahnomor')) {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }

            const cleanParams = cleanText.slice('!tambahnomor'.length).trim();
            let targetNumber = '';
            let targetName = 'Karyawan Toko';

            // Mendukung baik format kurung siku [08xxx] [nama] maupun biasa 08xxx nama
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
                return;
            }

            // Lookup otomatis LID WhatsApp untuk nomor HP tersebut
            let resolvedLid = '';
            try {
                const waLookup = await sock.onWhatsApp(targetNumber);
                if (waLookup && waLookup.length > 0 && waLookup[0].lid) {
                    resolvedLid = normalizeNumber(waLookup[0].lid);
                }
            } catch (e) {
                console.log('Tidak dapat lookup LID onWhatsApp:', e.message);
            }

            const res = addNumber(targetNumber, targetName, resolvedLid);
            await sock.sendMessage(sender, { text: res.message });
            return;
        }

        if (lowerText.startsWith('!hapusnomor')) {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }

            const parts = cleanText.split(/\s+/);
            const targetNumber = parts[1];

            if (!targetNumber) {
                await sock.sendMessage(sender, { text: '⚠️ Format salah. Contoh:\n*!hapusnomor 08123456789*' });
                return;
            }

            const res = removeNumber(targetNumber);
            await sock.sendMessage(sender, { text: res.message });
            return;
        }

        if (lowerText === '!listnomor' || lowerText === '!whitelist') {
            if (!isSenderSuperAdmin) {
                await sock.sendMessage(sender, { text: '⛔ Perintah ini hanya dapat diakses oleh *Super Admin*.' });
                return;
            }

            await sock.sendMessage(sender, { text: listNumbers() });
            return;
        }

        // ============================================================
        // 3. PEMERIKSAAN HAK AKSES WHITELIST UNTUK FITUR OPERASIONAL
        // ============================================================
        const botCommands = ['menu', 'lapor', '!menu', '!kirimlaporan', '!rekap', 'rekap', '!pb', 'pb', '!hapusdata'];
        const isBotCommand = botCommands.some(cmd => lowerText.startsWith(cmd));

        if (isBotCommand && !isSenderAllowed) {
            const wl = loadWhitelist();
            await sock.sendMessage(sender, {
                text: `⚠️ Maaf, nomor Anda (*${normSender}*) belum terdaftar untuk menggunakan bot ini.\nSilakan hubungi Super Admin (${wl.super_admins?.[0] || wl.admin}) untuk pendaftaran akses.`
            });
            return;
        }

        // ============================================================
        // 4. MENU & FORMAT LAPORAN
        // ============================================================
        if (lowerText === 'lapor' || lowerText === 'menu' || lowerText === '!menu') {
            const isSuper = isSenderSuperAdmin;
            const cfg = loadConfig();

            let templatePesan = `Halo! Silakan salin dan isi data laporan di bawah ini, lalu kirim kembali:\n\n!kirimlaporan
SPD: 
STD: 
APC: 
MGRP: 
MG%: 
LPP: 
Avg SPD: 
Avg STD: 
Avg APC: 
Avg MGRP: 
Avg MG%: 
YCCG: 
Sosis Ori: 
Sosis Keju: 
MPP: 
NBH: 
Total MPP: 
Total NBH: 

💡 *Fitur & Perintah Operasional:*
- *!rekap* : Ringkasan performa penjualan & SO bulan ini
- *!rekap excel* : Unduh file Excel rekapitulasi harian lengkap
- *!pb* : Analisa ringkasan stok pareto kritis (default <= ${cfg.ambang_stok_pb} pcs)
- *!pb [angka]* : Analisa pareto dengan batas stok kustom (cth: *!pb 5*)
- *!pb excel* : Unduh file Excel rekomendasi restock suplier
- *Upload Dokumen (.xls/.xlsx)* : Analisa interaktif dengan pilihan batas stok
- *!hapusdata* : Koreksi/hapus laporan hari ini jika ada salah ketik`;

            if (isSuper) {
                templatePesan += `\n\n👑 *Menu Khusus Super Admin:*
- *!setting* : Lihat & kelola pengaturan profil toko & target
- *!settarget [nominal]* : Ubah target SPD harian
- *!setrab [spd] [std] [apc] [gm]* : Ubah 4 target RAB toko
- *!settoko [Nama] | [Kode] | [Cabang]* : Ubah profil toko
- *!setstok [angka]* : Ubah default batas stok kritis PB
- *!setreminder [jam:menit / off]* : Atur jadwal pengingat closing
- *!listnomor* : Kelola nomor akses Super Admin & Admin Biasa
- *!tambahnomor [no] [nama]* : Daftarkan Admin Biasa baru
- *!hapusnomor [no]* : Hapus nomor admin
- *!resetdata* : Reset data rekap bulanan baru`;
            }

            await sock.sendMessage(sender, { text: templatePesan });
            return;
        }

        // ============================================================
        // 5. FITUR PB (PERMINTAAN BARANG) & ANALISA PARETO
        // ============================================================
        if (lowerText === '!pb' || lowerText === 'pb' || lowerText.startsWith('!pb ')) {
            // Hindari overlap dengan !pb excel
            if (lowerText.startsWith('!pb excel')) {
                // Biarkan lanjut ke handler !pb excel di bawah
            } else {
                const latestFile = getLatestParetoFile('.');
                if (!latestFile) {
                    await sock.sendMessage(sender, {
                        text: '⚠️ File laporan Pareto (.xls / .xlsx) belum ditemukan di server.\nSilakan kirimkan file Excel Pareto Anda ke chat bot ini.'
                    });
                    return;
                }

                try {
                    const cfg = loadConfig();
                    const storeInfo = { nama_toko: cfg.nama_toko, kode_toko: cfg.kode_toko, cabang: cfg.cabang };

                    // Cek jika user menyertakan angka batas stok kustom, cth: "!pb 5"
                    const parts = cleanText.split(/\s+/);
                    let threshold = cfg.ambang_stok_pb || 10;
                    if (parts.length > 1 && /^\d+$/.test(parts[1])) {
                        threshold = parseInt(parts[1]);
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
                return;
            }
        }

        if (lowerText.startsWith('!pb excel')) {
            const latestFile = getLatestParetoFile('.');
            if (!latestFile) {
                await sock.sendMessage(sender, {
                    text: '⚠️ File laporan Pareto (.xls / .xlsx) belum ditemukan di server.\nSilakan kirimkan file Excel Pareto Anda ke chat bot ini.'
                });
                return;
            }

            try {
                const cfg = loadConfig();
                const storeInfo = { nama_toko: cfg.nama_toko, kode_toko: cfg.kode_toko, cabang: cfg.cabang };

                // Cek kustom threshold jika ada, cth: "!pb excel 5"
                const parts = cleanText.split(/\s+/);
                let threshold = cfg.ambang_stok_pb || 10;
                if (parts.length > 2 && /^\d+$/.test(parts[2])) {
                    threshold = parseInt(parts[2]);
                }

                await sock.sendMessage(sender, {
                    text: `⏳ Sedang meng-generate file Excel rekomendasi PB (Batas stok <= *${threshold} pcs*)...`
                });

                const analysis = analyzePareto(latestFile, threshold);
                const options = { day: 'numeric', month: 'long', year: 'numeric' };
                const todayClean = new Date().toLocaleDateString('id-ID', options).replace(/[\s]/g, '_');
                const outPath = `Laporan_PB_Pareto_${Date.now()}.xlsx`;
                await generatePbExcel(analysis, outPath, storeInfo);

                await sock.sendMessage(sender, {
                    document: fs.readFileSync(outPath),
                    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    fileName: `Laporan_PB_Pareto_${todayClean}.xlsx`,
                    caption: `📊 *Laporan Rekomendasi PB (Pareto Toko)*\nTotal: ${analysis.totalKritis} item kritis yang perlu di-restock oleh suplier.`
                });

                try { fs.unlinkSync(outPath); } catch (_) {}
            } catch (err) {
                await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan: ${err.message}` });
            }
            return;
        }

        // ============================================================
        // 6. FITUR REKAP PENJUALAN & EXPORT EXCEL
        // ============================================================
        if (lowerText === '!rekap excel') {
            if (!fs.existsSync('rekap_data.json') || fs.readFileSync('rekap_data.json', 'utf8') === '[]') {
                await sock.sendMessage(sender, { text: '⚠️ Belum ada data laporan yang tersimpan untuk di-export ke Excel.' });
                return;
            }

            try {
                await sock.sendMessage(sender, { text: '⏳ Sedang meng-generate file Excel rekapitulasi performa toko...' });
                const cfg = loadConfig();
                const storeInfo = { nama_toko: cfg.nama_toko, kode_toko: cfg.kode_toko, cabang: cfg.cabang };

                const fileContent = fs.readFileSync('rekap_data.json', 'utf8');
                const dataList = JSON.parse(fileContent);

                const options = { month: 'long', year: 'numeric' };
                const monthClean = new Date().toLocaleDateString('id-ID', options).replace(/[\s]/g, '_');
                const outPath = `Rekap_Bulanan_${Date.now()}.xlsx`;

                generateRekapExcel(dataList, outPath, cfg.target_spd, storeInfo);

                await sock.sendMessage(sender, {
                    document: fs.readFileSync(outPath),
                    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    fileName: `Rekap_Bulanan_${monthClean}.xlsx`,
                    caption: `📊 *File Rekapitulasi Penjualan Harian & Bulanan*\n${cfg.nama_toko} (${cfg.kode_toko})`
                });

                try { fs.unlinkSync(outPath); } catch (_) {}
            } catch (err) {
                await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan: ${err.message}` });
            }
            return;
        }

        if (lowerText === '!rekap' || lowerText === 'rekap') {
            if (!fs.existsSync('rekap_data.json') || fs.readFileSync('rekap_data.json', 'utf8') === '[]') {
                await sock.sendMessage(sender, { text: '⚠️ Belum ada data laporan yang tersimpan untuk direkap bulan ini.' });
                return;
            }

            const cfg = loadConfig();
            const storeInfo = { nama_toko: cfg.nama_toko, kode_toko: cfg.kode_toko, cabang: cfg.cabang };

            const fileContent = fs.readFileSync('rekap_data.json', 'utf8');
            const dataList = JSON.parse(fileContent);
            const pesanRekap = getStructuredTextRekap(dataList, cfg.target_spd, storeInfo);
            await sock.sendMessage(sender, { text: pesanRekap });
            return;
        }

        // ============================================================
        // 7. FITUR KOREKSI / HAPUS DATA HARI INI
        // ============================================================
        if (lowerText === '!hapusdata') {
            if (!fs.existsSync('rekap_data.json')) {
                await sock.sendMessage(sender, { text: '⚠️ Belum ada file data rekap.' });
                return;
            }

            const options = { day: 'numeric', month: 'long', year: 'numeric' };
            const today = new Date().toLocaleDateString('id-ID', options);

            const fileContent = fs.readFileSync('rekap_data.json', 'utf8');
            let dataList = fileContent ? JSON.parse(fileContent) : [];

            const panjangAwal = dataList.length;
            dataList = dataList.filter(item => item.tanggal !== today);

            if (dataList.length < panjangAwal) {
                fs.writeFileSync('rekap_data.json', JSON.stringify(dataList, null, 2));
                await sock.sendMessage(sender, { text: `✅ Data laporan tanggal *${today}* berhasil dihapus. Silakan kirim ulang!` });
            } else {
                await sock.sendMessage(sender, { text: `ℹ️ Tidak ada data laporan tanggal *${today}* yang tersimpan.` });
            }
            return;
        }

        // ============================================================
        // 8. OLAH DATA LAPORAN BARU (!kirimlaporan)
        // ============================================================
        if (cleanText.includes('!kirimlaporan')) {
            function escapeRegex(str) {
                return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }

            const extractValue = (key) => {
                const escaped = escapeRegex(key);
                const regex = new RegExp(`(^|\\n)\\s*${escaped}\\s*:\\s*([^\\n]*)`, 'i');
                const match = cleanText.match(regex);
                return match && match[2] ? match[2].trim().replace(/%/g, '').trim() : '';
            };

            const spd = extractValue('SPD');
            if (!spd) return;

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
                return;
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
            const options = { day: 'numeric', month: 'long', year: 'numeric' };
            const today = new Date().toLocaleDateString('id-ID', options);

            // Perhitungan Persentase ACH Harian & MTD yang akurat berdasarkan config
            const targetSpd = cfg.target_spd || 4725000;
            const achHarian = ((numSpd / targetSpd) * 100).toFixed(2);
            const achMtd = numAvgSpd > 0
                ? ((numAvgSpd / targetSpd) * 100).toFixed(2)
                : ((numSpd / targetSpd) * 100).toFixed(2);

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

            let semuaData = [];
            if (fs.existsSync('rekap_data.json')) {
                const fileContent = fs.readFileSync('rekap_data.json', 'utf8');
                semuaData = fileContent ? JSON.parse(fileContent) : [];
            }
            semuaData = semuaData.filter(item => item.tanggal !== today);
            semuaData.push(dataBaru);
            fs.writeFileSync('rekap_data.json', JSON.stringify(semuaData, null, 2));

            // Format Pesan Balasan Resmi Berdasarkan Konfigurasi Dinamis Toko
            const laporanTeks = `LAPORAN PERFORMANCE GO    

TGL Grand OPENING   : ${cfg.tgl_grand_opening}
Type Harga : ${cfg.type_harga}

NAMA TOKO : ${cfg.nama_toko}
KODE TOKO  : ${cfg.kode_toko}
CABANG         : ${cfg.cabang}

================================

TARGET RAB     

SPD : ${formatRp(cfg.target_spd)}
STD : ${cfg.target_std}
APC : ${formatRp(cfg.target_apc)}
GM : ${cfg.target_gm}

================================
Sales Tanggal  : ${today}

SPD : ${formatRp(numSpd)}
ACH HARIAN : ${achHarian}%
STD  : ${std || numStd}
APC  : ${formatRp(numApc)}
MGRP : ${formatRp(numMgrp)}
MG% :  ${mg}%
LPP OMI: ${formatRp(numLpp)}

AVG Sales Tgl   : 01- ${today}
SPD : ${formatRp(numAvgSpd)}
ACH MTD : ${achMtd}%
STD : ${avgStd || numAvgStd}
APC : ${formatRp(numAvgApc)}
MGRP : ${formatRp(numAvgMgrp)}
MG%: ${avgMg}%
============================ 
Penjualan yccg
Total keluar : ${numYccg} cup

Penjualan rte
Sosis ori: ${numSosisOri}
Sosis keju: ${numSosisKeju}
Total:${totalRte}


LAPORAN STOCK OPNAME :
SO Tanggal ${today}
MPP : ${mpp || 0}
NBH : ${nbh || 0}

Total SO 01-${today}
MPP : ${totalMpp || mpp || 0}
NBH : ${totalNbh || nbh || 0}

Terima kasih 🙏`;

            await sock.sendMessage(sender, { text: laporanTeks });
        }
    });
}

/**
 * Scheduler:
 * 1. Pengingat Closing Harian ke Admin/Karyawan (Pukul yang diatur di config, default 21:45 WIB)
 * 2. Pengiriman Otomatis Rekap Bulanan Setiap Akhir Bulan ke Super Admin
 */
function setupScheduler(sock) {
    let lastSentMonth = '';
    let lastReminderDate = '';

    setInterval(async () => {
        try {
            const now = new Date();
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            const todayDateStr = now.toDateString();
            const cfg = loadConfig();

            // 1. PENGINGAT CLOSING HARIAN
            if (cfg.reminder_closing_enabled &&
                currentHour === cfg.reminder_closing_jam &&
                Math.abs(currentMinute - cfg.reminder_closing_menit) <= 2 &&
                lastReminderDate !== todayDateStr) {

                lastReminderDate = todayDateStr;
                const wl = loadWhitelist();
                const reminderText = `🔔 *PENGINGAT CLOSING TOKO (${String(cfg.reminder_closing_jam).padStart(2, '0')}:${String(cfg.reminder_closing_menit).padStart(2, '0')} WIB)* 🔔\n\n` +
                    `Kepada seluruh rekan tim operasional & kasir *${cfg.nama_toko}*:\n` +
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

                for (const jid of recipients) {
                    try {
                        await sock.sendMessage(jid, { text: reminderText });
                    } catch (e) {
                        console.error('Gagal mengirim reminder closing ke:', jid, e.message);
                    }
                }
                console.log(`📢 Reminder closing harian (${todayDateStr}) terkirim ke ${recipients.size} pengguna.`);
            }

            // 2. REKAP BULANAN OTOMATIS AKHIR BULAN
            const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            const isLastDayOfMonth = tomorrow.getDate() === 1;
            const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

            const targetHour = cfg.jam_rekap_otomatis !== undefined ? cfg.jam_rekap_otomatis : 23;
            const targetMin = cfg.menit_rekap_otomatis !== undefined ? cfg.menit_rekap_otomatis : 0;

            if (isLastDayOfMonth && currentHour === targetHour && Math.abs(currentMinute - targetMin) <= 4 && lastSentMonth !== monthKey) {
                if (fs.existsSync('rekap_data.json')) {
                    const content = fs.readFileSync('rekap_data.json', 'utf8');
                    const list = JSON.parse(content);

                    if (list.length > 0) {
                        const wl = loadWhitelist();
                        const options = { month: 'long', year: 'numeric' };
                        const monthName = now.toLocaleDateString('id-ID', options);
                        const outPath = `Rekap_Bulanan_Otomatis_${monthKey}.xlsx`;
                        const storeInfo = { nama_toko: cfg.nama_toko, kode_toko: cfg.kode_toko, cabang: cfg.cabang };

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

                        for (const adminJid of superAdminRecipients) {
                            try {
                                await sock.sendMessage(adminJid, {
                                    document: fs.readFileSync(outPath),
                                    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                    fileName: `Rekap_Bulanan_${monthName.replace(/\s+/g, '_')}.xlsx`,
                                    caption: `📢 *REKAP OTOMATIS AKHIR BULAN TELAH SIAP!*\n\nBerikut rekapitulasi data penjualan toko ${cfg.nama_toko} periode *${monthName}*.\nTerima kasih atas kerja keras seluruh tim bulan ini! 🙏`
                                });
                            } catch (e) {
                                console.error('Gagal mengirim rekap bulanan ke super admin:', adminJid, e.message);
                            }
                        }

                        try { fs.unlinkSync(outPath); } catch (_) {}
                        lastSentMonth = monthKey;
                        console.log(`✅ Rekap akhir bulan otomatis ${monthKey} berhasil dikirim ke Super Admin.`);
                    }
                }
            }
        } catch (e) {
            console.error('Error pada scheduler bot:', e);
        }
    }, 60 * 1000); // Evaluasi tiap 1 menit
}

startBot();