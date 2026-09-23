import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import qrcode from 'qrcode-terminal'; // Menggunakan modul qrcode-terminal agar QR code rapi

async function startBot() {
    console.log('⏳ Memulai program bot...');

    const { state, saveCreds } = await useMultiFileAuthState('sesi_bot');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Kita handle manual lewat event qrcode di bawah
        browser: ['Chrome (Linux)', 'Chrome', '10.0.0'],
        logger: pino({ level: "silent" }) 
    });

    sock.ev.on('creds.update', saveCreds);

    // MENGATUR MUNCULNYA QR CODE DAN KONEKSI
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Jika ada QR code baru dari WhatsApp, cetak langsung ke terminal
        if (qr) {
            console.log('\n📱 Scan QR code di bawah ini menggunakan WhatsApp:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Koneksi terputus, menyambung ulang...', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('\n✅ BOT BERHASIL TERHUBUNG!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;

        const text = m.message.conversation || 
                     m.message.extendedTextMessage?.text || 
                     m.message.imageMessage?.caption || '';
                     
        const sender = m.key.remoteJid;
        const cleanText = text.trim();
        const lowerText = cleanText.toLowerCase();

        // 1. CEK PERINTAH REKAP
        if (lowerText === '!rekap' || lowerText === 'rekap') {
            if (!fs.existsSync('rekap_data.json') || fs.readFileSync('rekap_data.json', 'utf8') === '[]') {
                await sock.sendMessage(sender, { text: "⚠️ Belum ada data laporan yang tersimpan untuk direkap bulan ini." });
                return;
            }

            const fileContent = fs.readFileSync('rekap_data.json', 'utf8');
            const dataList = JSON.parse(fileContent);

            let totalSpd = 0;
            let totalMpp = 0;
            let totalNbh = 0;
            let jumlahHari = dataList.length;

            dataList.forEach(item => {
                totalSpd += item.spd;
                totalMpp += item.mpp;
                totalNbh += item.nbh;
            });

            let rataSpd = Math.round(totalSpd / jumlahHari);
            let targetBulanan = 4725000;
            let achMtd = ((rataSpd / targetBulanan) * 100).toFixed(2);

            const formatRp = (angka) => new Intl.NumberFormat('id-ID').format(angka || 0);

            const pesanRekap = `📊 *REKAP OTOMATIS BULAN INI*
----------------------------------------
Total Hari Masuk: ${jumlahHari} Hari

💰 *Akumulasi Performa:*
- Rata-rata SPD Bulanan  : ${formatRp(rataSpd)}
- Pencapaian MTD (ACH)   : ${achMtd}%

📦 *Akumulasi Temuan:*
- Total MPP (Expired/Rusak) : ${totalMpp} Item
- Total NBH (Barang Hilang)  : ${totalNbh} Item
----------------------------------------
✨ *Data diambil otomatis dari arsip bot.*`;

            await sock.sendMessage(sender, { text: pesanRekap });
            return;
        }

        // 2. FITUR KOREKSI: HAPUS DATA HARI INI (!hapusdata)
        if (lowerText === '!hapusdata') {
            if (!fs.existsSync('rekap_data.json')) {
                await sock.sendMessage(sender, { text: "⚠️ Belum ada file data rekap." });
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

        // 3. CEK PERINTAH MENU / LAPOR
        if (lowerText === 'lapor' || lowerText === 'menu' || lowerText === '!menu') {
            const templatePesan = `Halo! Silakan salin dan isi data di bawah ini, lalu kirim kembali:\n\n!kirimlaporan\nSPD: \nSTD: \nAPC: \nMGRP: \nMG%: \nLPP: \nAvg SPD: \nAvg STD: \nAvg APC: \nAvg MGRP: \nAvg MG%: \nMPP: \nNBH: \nTotal MPP: \nTotal NBH: `;
            await sock.sendMessage(sender, { text: templatePesan });
            return;
        }

        // 4. OLAH DATA LAPORAN & OTOMATIS TIMPA (EDIT)
        if (cleanText.includes('!kirimlaporan')) {
            const extractValue = (key) => {
                const regex = new RegExp(`(^|\\n)\\s*\\b${key}\\b\\s*:\\s*([^\\n]*)`, 'i');
                const match = cleanText.match(regex);
                return match && match[2] ? match[2].trim() : "";
            };

            const spd = extractValue('SPD');

            if (!spd || spd === "" || spd.match(/^\s*$/)) {
                return;
            }

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
            const mpp = extractValue('MPP');
            const nbh = extractValue('NBH');
            const totalMpp = extractValue('Total MPP');
            const totalNbh = extractValue('Total NBH');

            // --- VALIDASI ANGKA SPD ---
            const angkaSpd = parseFloat(spd.replace(/[^0-9]/g, ''));
            if (isNaN(angkaSpd) || angkaSpd < 2000000 || angkaSpd > 10000000) {
                await sock.sendMessage(sender, { 
                    text: `⚠️ *Peringatan Anomali Data!*\n\nNilai SPD yang kamu masukkan (*${spd}*) terlihat tidak wajar atau salah ketik. Pastikan memasukkan nominal angka rupiah harian dengan benar (kisaran wajar 2 juta - 10 juta). Mohon kirim ulang!` 
                });
                return; 
            }

            // Tanggal Otomatis Hari Ini
            const options = { day: 'numeric', month: 'long', year: 'numeric' };
            const today = new Date().toLocaleDateString('id-ID', options);

            const targetSPD = 4725000; 

            const achHarian = ((parseFloat(spd) / targetSPD) * 100).toFixed(2);
            const achMtd = ((parseFloat(avgSpd) / targetSPD) * 100).toFixed(2);

            const formatRp = (angka) => new Intl.NumberFormat('id-ID').format(angka || 0);

            // --- SIMPAN / TIMPA DATA KE FILE REKAP OTOMATIS ---
            const dataBaru = {
                tanggal: today,
                spd: parseFloat(angkaSpd),
                mpp: parseInt(mpp) || 0,
                nbh: parseInt(nbh) || 0
            };

            let semuaData = [];
            if (fs.existsSync('rekap_data.json')) {
                const fileContent = fs.readFileSync('rekap_data.json', 'utf8');
                semuaData = fileContent ? JSON.parse(fileContent) : [];
            }
            semuaData = semuaData.filter(item => item.tanggal !== today);
            semuaData.push(dataBaru);
            fs.writeFileSync('rekap_data.json', JSON.stringify(semuaData, null, 2));

            const laporanTeks = `LAPORAN PERFORMANCE GO    

TGL Grand OPENING   : 26 FEBRUARI 2026
Type Harga : 7

NAMA TOKO : OMI TITAN EKSEKUTIF MART
KODE TOKO  : O8BM
CABANG        : BEKASI

================================

TARGET RAB     

SPD : 4.725.000
STD : 135
APC : 35.000
GM : 21.00

================================
Sales Tanggal  : ${today}

SPD : ${formatRp(spd)}
ACH HARIAN : ${achHarian}%
STD  : ${std}
APC  : ${formatRp(apc)}
MGRP : ${formatRp(mgrp)}
MG% :  ${mg}%
LPP OMI: ${formatRp(lpp)}

AVG Sales Tgl   : 01- ${today}
SPD : ${formatRp(avgSpd)}
ACH MTD : ${achMtd}%
STD : ${avgStd}
APC : ${formatRp(avgApc)}
MGRP : ${formatRp(avgMgrp)}
MG%: ${avgMg}%
============================ 

LAPORAN STOCK OPNAME :
SO Tanggal ${today}
MPP : ${mpp}
NBH : ${nbh}

Total SO 01-${today}
MPP : ${totalMpp}
NBH : ${totalNbh}

Terima kasih 🙏`;

            await sock.sendMessage(sender, { text: laporanTeks });
        }
    });
}

startBot();