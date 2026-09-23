import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';

import { isAllowed, isAdmin, addNumber, removeNumber, listNumbers, normalizeNumber, loadWhitelist } from './whitelist_helper.js';
import { getLatestParetoFile, analyzePareto, generatePbExcel, getPbSummaryText } from './pareto_analyzer.js';
import { getStructuredTextRekap, generateRekapExcel } from './rekap_helper.js';

const TARGET_SPD = 4725000;

function parseNominal(val) {
    if (val === undefined || val === null) return 0;
    const clean = String(val).replace(/[^0-9]/g, '');
    return clean ? parseFloat(clean) : 0;
}

const formatRp = (angka) => new Intl.NumberFormat('id-ID').format(Math.round(angka) || 0);

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
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Koneksi terputus, menyambung ulang...', shouldReconnect);
            if (shouldReconnect) {
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

        // Cegah bot memproses pesan yang dikirim oleh nomor bot sendiri
        if (m.key.fromMe) return;

        const sender = m.key.remoteJid;
        // Dapatkan nomor pengirim asli (berlaku untuk personal chat maupun grup)
        const senderNumber = m.key.participant || sender;

        const text = m.message.conversation ||
                     m.message.extendedTextMessage?.text ||
                     m.message.imageMessage?.caption ||
                     m.message.documentMessage?.caption || '';

        const cleanText = text.trim();
        const lowerText = cleanText.toLowerCase();

        // ============================================================
        // 1. PENANGANAN UPLOAD DOKUMEN EXCEL PARETO
        // ============================================================
        if (m.message.documentMessage) {
            const doc = m.message.documentMessage;
            const fileName = (doc.fileName || '').toLowerCase();

            if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
                if (!isAllowed(senderNumber)) {
                    const wl = loadWhitelist();
                    await sock.sendMessage(sender, {
                        text: `⚠️ Maaf, nomor Anda (*${normalizeNumber(senderNumber)}*) belum terdaftar untuk mengupload data ke bot.\nSilakan hubungi Admin (${wl.admin}).`
                    });
                    return;
                }

                await sock.sendMessage(sender, { text: `⏳ Mengunduh dan menganalisa dokumen pareto baru (*${doc.fileName}*)...` });

                try {
                    const buffer = await downloadMediaMessage(m, 'buffer', {});
                    const ext = path.extname(doc.fileName) || '.xls';
                    const savedPath = `pareto_uploaded_${Date.now()}${ext}`;
                    fs.writeFileSync(savedPath, buffer);

                    const analysis = analyzePareto(savedPath);
                    const summaryText = getPbSummaryText(analysis);
                    const excelOutput = `Laporan_PB_Pareto_${Date.now()}.xlsx`;
                    generatePbExcel(analysis, excelOutput);

                    await sock.sendMessage(sender, { text: summaryText });
                    await sock.sendMessage(sender, {
                        document: fs.readFileSync(excelOutput),
                        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        fileName: `Laporan_PB_Pareto_${new Date().toLocaleDateString('id-ID').replace(/[\/\s]/g, '-')}.xlsx`,
                        caption: `📊 *Hasil Analisa Dokumen Pareto Baru*\nFile Excel rekomendasi restock ${analysis.totalKritis} item kritis siap kirim ke supplier.`
                    });

                    // Hapus file sementara setelah dikirim
                    try { fs.unlinkSync(excelOutput); } catch (_) {}
                    return;
                } catch (err) {
                    console.error('Error memproses dokumen pareto:', err);
                    await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan saat membaca file pareto: ${err.message}` });
                    return;
                }
            }
        }

        // ============================================================
        // 2. PERINTAH MANAJEMEN WHITELIST (KHUSUS ADMIN)
        // ============================================================
        if (lowerText.startsWith('!tambahnomor')) {
            if (!isAdmin(senderNumber)) {
                await sock.sendMessage(sender, { text: '⚠️ Perintah ini hanya dapat dijalankan oleh Admin Utama.' });
                return;
            }

            const parts = cleanText.split(/\s+/);
            const targetNumber = parts[1];
            const targetName = parts.slice(2).join(' ') || 'Karyawan Toko';

            if (!targetNumber) {
                await sock.sendMessage(sender, { text: '⚠️ Format salah. Contoh penggunaan:\n*!tambahnomor 08123456789 Budi*' });
                return;
            }

            const res = addNumber(targetNumber, targetName);
            await sock.sendMessage(sender, { text: res.message });
            return;
        }

        if (lowerText.startsWith('!hapusnomor')) {
            if (!isAdmin(senderNumber)) {
                await sock.sendMessage(sender, { text: '⚠️ Perintah ini hanya dapat dijalankan oleh Admin Utama.' });
                return;
            }

            const parts = cleanText.split(/\s+/);
            const targetNumber = parts[1];

            if (!targetNumber) {
                await sock.sendMessage(sender, { text: '⚠️ Format salah. Contoh penggunaan:\n*!hapusnomor 08123456789*' });
                return;
            }

            const res = removeNumber(targetNumber);
            await sock.sendMessage(sender, { text: res.message });
            return;
        }

        if (lowerText === '!listnomor' || lowerText === '!whitelist') {
            if (!isAdmin(senderNumber)) {
                await sock.sendMessage(sender, { text: '⚠️ Perintah ini hanya dapat dilihat oleh Admin Utama.' });
                return;
            }

            await sock.sendMessage(sender, { text: listNumbers() });
            return;
        }

        // ============================================================
        // 3. PEMERIKSAAN HAK AKSES WHITELIST UNTUK FITUR UTAMA
        // ============================================================
        const botCommands = ['menu', 'lapor', '!menu', '!kirimlaporan', '!rekap', 'rekap', '!pb', '!hapusdata'];
        const isBotCommand = botCommands.some(cmd => lowerText.startsWith(cmd));

        if (isBotCommand && !isAllowed(senderNumber)) {
            const wl = loadWhitelist();
            await sock.sendMessage(sender, {
                text: `⚠️ Maaf, nomor Anda (*${normalizeNumber(senderNumber)}*) belum terdaftar untuk menggunakan bot ini.\nSilakan hubungi Admin (${wl.admin}) untuk pendaftaran akses.`
            });
            return;
        }

        // ============================================================
        // 4. MENU & FORMAT LAPORAN
        // ============================================================
        if (lowerText === 'lapor' || lowerText === 'menu' || lowerText === '!menu') {
            const templatePesan = `Halo! Silakan salin dan isi data laporan di bawah ini, lalu kirim kembali:\n\n!kirimlaporan
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

💡 *Perintah Tersedia:*
- *!rekap* : Ringkasan performa penjualan & SO bulan ini
- *!rekap excel* : Unduh file Excel rekapitulasi harian lengkap
- *!pb* : Analisa ringkasan stok pareto kritis (stok <= 10)
- *!pb excel* : Unduh file Excel rekomendasi restock suplier`;
            await sock.sendMessage(sender, { text: templatePesan });
            return;
        }

        // ============================================================
        // 5. FITUR PB (PERMINTAAN BARANG) & ANALISA PARETO
        // ============================================================
        if (lowerText === '!pb' || lowerText === 'pb') {
            const latestFile = getLatestParetoFile('.');
            if (!latestFile) {
                await sock.sendMessage(sender, {
                    text: '⚠️ File laporan Pareto (.xls / .xlsx) belum ditemukan di server.\nSilakan kirimkan file Excel Pareto Anda ke chat bot ini.'
                });
                return;
            }

            try {
                await sock.sendMessage(sender, { text: '⏳ Sedang menganalisa stok pareto toko...' });
                const analysis = analyzePareto(latestFile);
                const summary = getPbSummaryText(analysis);
                await sock.sendMessage(sender, { text: summary });
            } catch (err) {
                await sock.sendMessage(sender, { text: `❌ Terjadi kesalahan saat membaca file pareto: ${err.message}` });
            }
            return;
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
                await sock.sendMessage(sender, { text: '⏳ Sedang meng-generate file Excel rekomendasi PB...' });
                const analysis = analyzePareto(latestFile);
                const options = { day: 'numeric', month: 'long', year: 'numeric' };
                const todayClean = new Date().toLocaleDateString('id-ID', options).replace(/[\s]/g, '_');
                const outPath = `Laporan_PB_Pareto_${Date.now()}.xlsx`;
                generatePbExcel(analysis, outPath);

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
                const fileContent = fs.readFileSync('rekap_data.json', 'utf8');
                const dataList = JSON.parse(fileContent);

                const options = { month: 'long', year: 'numeric' };
                const monthClean = new Date().toLocaleDateString('id-ID', options).replace(/[\s]/g, '_');
                const outPath = `Rekap_Bulanan_${Date.now()}.xlsx`;

                generateRekapExcel(dataList, outPath, TARGET_SPD);

                await sock.sendMessage(sender, {
                    document: fs.readFileSync(outPath),
                    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    fileName: `Rekap_Bulanan_${monthClean}.xlsx`,
                    caption: `📊 *File Rekapitulasi Penjualan Harian & Bulanan*\nOMI TITAN EKSEKUTIF MART (O8BM)`
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

            const fileContent = fs.readFileSync('rekap_data.json', 'utf8');
            const dataList = JSON.parse(fileContent);
            const pesanRekap = getStructuredTextRekap(dataList, TARGET_SPD);
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
            const extractValue = (key) => {
                const regex = new RegExp(`(^|\\n)\\s*\\b${key}\\b\\s*:\\s*([^\\n]*)`, 'i');
                const match = cleanText.match(regex);
                return match && match[2] ? match[2].trim() : '';
            };

            const spd = extractValue('SPD');
            if (!spd) return;

            const std = extractValue('STD');
            const apc = extractValue('APC');
            const mgrp = extractValue('MGRP');
            const mg = extractValue('MG%');
            const lpp = extractValue('LPP');
            const avgSpd = extractValue('Avg SPD');
            const avgStd = extractValue('Avg STD');
            const avgApc = extractValue('Avg APC');
            const avgMgrp = extractValue('Avg MGRP');
            const avgMg = extractValue('Avg MG%');
            const yccg = extractValue('YCCG');
            const sosisOri = extractValue('Sosis Ori');
            const sosisKeju = extractValue('Sosis Keju');
            const mpp = extractValue('MPP');
            const nbh = extractValue('NBH');
            const totalMpp = extractValue('Total MPP');
            const totalNbh = extractValue('Total NBH');

            // --- VALIDASI ANGKA SPD SECARA PRESISI ---
            const numSpd = parseNominal(spd);
            if (numSpd < 1000000 || numSpd > 20000000) {
                await sock.sendMessage(sender, {
                    text: `⚠️ *Peringatan Anomali Data!*\n\nNilai SPD yang kamu masukkan (*${spd}*) terlihat tidak wajar atau salah ketik. Pastikan memasukkan nominal angka rupiah harian dengan benar (kisaran wajar 1 juta - 20 juta). Mohon kirim ulang!`
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

            // Perhitungan Persentase ACH Harian & MTD yang akurat
            const achHarian = ((numSpd / TARGET_SPD) * 100).toFixed(2);
            const achMtd = numAvgSpd > 0
                ? ((numAvgSpd / TARGET_SPD) * 100).toFixed(2)
                : ((numSpd / TARGET_SPD) * 100).toFixed(2);

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

            // Format Pesan Balasan Resmi
            const laporanTeks = `LAPORAN PERFORMANCE GO    

TGL Grand OPENING   : 26 FEBRUARI 2026
Type Harga : 7

NAMA TOKO : OMI TITAN EKSEKUTIF MART
KODE TOKO  : O8BM
CABANG         : BEKASI

================================

TARGET RAB     

SPD : 4.725.000
STD : 135
APC : 35.000
GM : 21.00

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
 * Scheduler Pengiriman Otomatis Rekap Bulanan Setiap Akhir Bulan Pukul 23:00
 */
function setupScheduler(sock) {
    let lastSentMonth = '';

    setInterval(async () => {
        try {
            const now = new Date();
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();

            // Cek apakah hari ini adalah hari terakhir dalam bulan ini
            const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            const isLastDayOfMonth = tomorrow.getDate() === 1;

            const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

            // Pukul 23:00 - 23:15 pada hari terakhir bulan
            if (isLastDayOfMonth && currentHour === 23 && currentMinute < 15 && lastSentMonth !== monthKey) {
                if (fs.existsSync('rekap_data.json')) {
                    const content = fs.readFileSync('rekap_data.json', 'utf8');
                    const list = JSON.parse(content);

                    if (list.length > 0) {
                        const wl = loadWhitelist();
                        const adminJid = `${wl.admin}@s.whatsapp.net`;

                        const options = { month: 'long', year: 'numeric' };
                        const monthName = now.toLocaleDateString('id-ID', options);
                        const outPath = `Rekap_Bulanan_Otomatis_${monthKey}.xlsx`;

                        generateRekapExcel(list, outPath, TARGET_SPD);

                        await sock.sendMessage(adminJid, {
                            document: fs.readFileSync(outPath),
                            mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            fileName: `Rekap_Bulanan_${monthName.replace(/\s+/g, '_')}.xlsx`,
                            caption: `📢 *REKAP OTOMATIS AKHIR BULAN TELAH SIAP!*\n\nBerikut rekapitulasi data penjualan toko OMI TITAN EKSEKUTIF MART periode *${monthName}*.\nTerima kasih atas kerja keras seluruh tim bulan ini! 🙏`
                        });

                        try { fs.unlinkSync(outPath); } catch (_) {}
                        lastSentMonth = monthKey;
                        console.log(`✅ Rekap akhir bulan otomatis ${monthKey} berhasil dikirim ke Admin.`);
                    }
                }
            }
        } catch (e) {
            console.error('Error pada scheduler rekap otomatis:', e);
        }
    }, 5 * 60 * 1000); // Evaluasi tiap 5 menit
}

startBot();