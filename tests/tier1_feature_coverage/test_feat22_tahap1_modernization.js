import assert from 'assert';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import xlsx from 'xlsx';
import { createTestSandbox, createMockSocket } from '../helpers/test_fixture_helper.js';
import { generateRekapExcel, getStructuredTextRekap } from '../../rekap_helper.js';
import { parseYcgOrSosisExcel, isYcgOrSosisFile } from '../../ycg_parser.js';
import { handleCommand } from '../../src/command_handler.js';
import {
    handleDocumentUpload,
    handleInteractiveResponse,
    setPendingLaporSession,
    clearUserSession,
    getUserSession,
    hasPendingSession
} from '../../src/upload_handler.js';
import { loadWhitelist, saveWhitelist, DEFAULT_SUPER_ADMINS } from '../../whitelist_helper.js';

export async function runTests() {
    console.log('--- Running Tier 1: Feature 22 (Tahap 1 Bot Modernization: Rekap ExcelJS, !menu/!lapor Separation, YCG/Sosis Parser & Session Protection) ---');

    const sandbox = createTestSandbox('feat22_test_');
    const superAdminJid = `${DEFAULT_SUPER_ADMINS[0]}@s.whatsapp.net`;
    const superAdminNorm = DEFAULT_SUPER_ADMINS[0];
    const kasirJid = '6281234567890@s.whatsapp.net';
    const kasirNorm = '6281234567890';
    const origWlContent = fs.existsSync('whitelist.json') ? fs.readFileSync('whitelist.json', 'utf8') : null;

    try {
        // Setup whitelist with super admin and kasir
        const initialWl = loadWhitelist();
        if (!initialWl.users.some(u => u.number === kasirNorm)) {
            initialWl.users.push({ number: kasirNorm, name: 'Kasir Test', role: 'admin_biasa' });
            saveWhitelist(initialWl);
        }

        // =====================================================================
        // TEST 1: Modul 1 - Excel Rekapitulasi Eksekutif Modern (ExcelJS)
        // =====================================================================
        {
            const sampleData = [
                { tanggal: '01/10/2026', spd: 5000000, std: 140, apc: 35714, mgrp: 1050000, mg: '21%', lpp: 4000000, avg_spd: 5000000, yccg: 27, sosis_ori: 10, sosis_keju: 5, total_rte: 15, mpp: 0, nbh: 0 },
                { tanggal: '02/10/2026', spd: 4800000, std: 135, apc: 35555, mgrp: 1008000, mg: '21%', lpp: 3800000, avg_spd: 4900000, yccg: 49, sosis_ori: 12, sosis_keju: 7, total_rte: 19, mpp: 2, nbh: 1 },
                { tanggal: '03/10/2026', spd: 5200000, std: 145, apc: 35862, mgrp: 1092000, mg: '21%', lpp: 4100000, avg_spd: 5000000, yccg: 15, sosis_ori: 8, sosis_keju: 4, total_rte: 12, mpp: 0, nbh: 0 }
            ];

            const outPath = path.join(sandbox.path, 'Rekap_Eksekutif_Modern.xlsx');
            generateRekapExcel(sampleData, outPath, 4725000, { nama_toko: 'OMI TITAN EKSEKUTIF MART', kode_toko: 'O8BM' });
            assert.strictEqual(fs.existsSync(outPath), true, 'Excel file must exist');

            // Baca dengan ExcelJS untuk verifikasi struktur, styling, dan metadata
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.readFile(outPath);

            assert.strictEqual(wb.worksheets.length, 2, 'Workbook must have 2 worksheets');
            const wsHarian = wb.getWorksheet('Data Penjualan Harian');
            const wsRingkasan = wb.getWorksheet('Ringkasan Bulanan');

            assert.ok(wsHarian, 'Sheet Data Penjualan Harian must exist');
            assert.ok(wsRingkasan, 'Sheet Ringkasan Bulanan must exist');

            // Verifikasi Header Baris 8 bernuansa Navy Blue (#1B365D) dengan teks putih
            const headerCell = wsHarian.getCell('A8');
            assert.strictEqual(headerCell.value, 'No.');
            assert.strictEqual(headerCell.fill?.fgColor?.argb, 'FF1B365D', 'Header fill must be Navy Blue (FF1B365D)');
            assert.strictEqual(headerCell.font?.color?.argb, 'FFFFFFFF', 'Header font must be bold white');
            assert.strictEqual(headerCell.font?.bold, true, 'Header font must be bold');

            // Verifikasi 4 KPI Summary Cards di baris 5-6
            const card1Title = wsHarian.getCell('B5').value;
            const card2Title = wsHarian.getCell('F5').value;
            const card3Title = wsHarian.getCell('J5').value;
            const card4Title = wsHarian.getCell('N5').value;

            assert.strictEqual(card1Title, 'TOTAL SPD (MTD)', 'Card 1 must be Total SPD');
            assert.strictEqual(card2Title, 'TARGET RAB HARIAN', 'Card 2 must be Target RAB');
            assert.strictEqual(card3Title, 'PENCAPAIAN MTD (ACH %)', 'Card 3 must be MTD ACH %');
            assert.strictEqual(card4Title, 'RATA-RATA APC', 'Card 4 must be Rata-rata APC');

            // Format angka Rupiah dan persentase
            const cellTotalSpd = wsHarian.getCell('B6');
            assert.strictEqual(cellTotalSpd.value, 15000000);
            assert.strictEqual(cellTotalSpd.numFmt, 'Rp #,##0');

            const cellAchMtd = wsHarian.getCell('J6');
            assert.strictEqual(cellAchMtd.numFmt, '0.00%');

            // Verifikasi Freeze Pane di baris 8
            assert.ok(wsHarian.views && wsHarian.views.length > 0, 'Views must be defined');
            assert.strictEqual(wsHarian.views[0].state, 'frozen', 'Freeze pane state must be frozen');
            assert.strictEqual(wsHarian.views[0].ySplit, 8, 'Freeze pane must freeze top 8 rows');

            // Verifikasi Sheet 2 Ringkasan Bulanan
            const s2Title = wsRingkasan.getCell('A1').value;
            assert.ok(s2Title.includes('RINGKASAN AKUMULASI PERFORMA BULANAN'));

            // Verifikasi bahwa error dilempar jika dataList kosong
            let threwEmpty = false;
            try {
                generateRekapExcel([], path.join(sandbox.path, 'empty.xlsx'));
            } catch (_) {
                threwEmpty = true;
            }
            assert.strictEqual(threwEmpty, true, 'Empty data list must throw error');

            console.log('  ✔ Case 22.1: Modul 1 generateRekapExcel (ExcelJS Navy Blue styling, 4 KPI cards, Rupiah/Percent format, freeze panes) verified!');
        }

        // =====================================================================
        // TEST 2: Modul 2 - Pemisahan Bersih Menu (!menu) dan Template Lapor (!lapor)
        // =====================================================================
        {
            const mockSock = createMockSocket();

            // 2.1 Test !menu / menu: TIDAK memuat template closing, HANYA navigasi
            const ctxKasir = { sender: kasirJid, normSender: kasirNorm, isSenderAllowed: true, isSenderSuperAdmin: false, cleanText: '!menu', lowerText: '!menu' };
            await handleCommand(mockSock, { key: { remoteJid: kasirJid } }, ctxKasir);

            assert.strictEqual(mockSock.sentMessages.length, 1);
            const menuReply = mockSock.sentMessages[0].content.text;
            assert.strictEqual(menuReply.includes('!kirimlaporan'), false, 'Menu must NOT contain !kirimlaporan template');
            assert.strictEqual(menuReply.includes('SPD:'), false, 'Menu must NOT contain SPD template field');
            assert.strictEqual(menuReply.includes('!lapor'), true, 'Menu must guide user to !lapor');
            assert.strictEqual(menuReply.includes('!auditkas'), true, 'Menu must include operational commands');
            assert.strictEqual(menuReply.includes('Menu Khusus Super Admin'), false, 'Kasir must not see Super Admin menu');

            // 2.2 Test !menu sebagai Super Admin: menampilkan menu Super Admin termasuk !broadcastmenu
            mockSock.sentMessages.length = 0;
            const ctxSuper = { sender: superAdminJid, normSender: superAdminNorm, isSenderAllowed: true, isSenderSuperAdmin: true, cleanText: 'menu', lowerText: 'menu' };
            await handleCommand(mockSock, { key: { remoteJid: superAdminJid } }, ctxSuper);

            const superMenuReply = mockSock.sentMessages[0].content.text;
            assert.strictEqual(superMenuReply.includes('!kirimlaporan'), false);
            assert.strictEqual(superMenuReply.includes('Menu Khusus Super Admin'), true);
            assert.strictEqual(superMenuReply.includes('!broadcastmenu'), true, 'Super Admin menu must include !broadcastmenu');

            // 2.3 Test !lapor: menampilkan template closing dan mengaktifkan sesi pelaporan
            mockSock.sentMessages.length = 0;
            clearUserSession(kasirNorm);
            assert.strictEqual(hasPendingSession(kasirNorm), false);

            const ctxLapor = { sender: kasirJid, normSender: kasirNorm, isSenderAllowed: true, isSenderSuperAdmin: false, cleanText: '!lapor', lowerText: '!lapor' };
            await handleCommand(mockSock, { key: { remoteJid: kasirJid } }, ctxLapor);

            assert.strictEqual(mockSock.sentMessages.length, 1);
            const laporReply = mockSock.sentMessages[0].content.text;
            assert.strictEqual(laporReply.includes('!kirimlaporan'), true, '!lapor must include !kirimlaporan template');
            assert.strictEqual(laporReply.includes('SPD:'), true, '!lapor must include SPD field');
            assert.strictEqual(laporReply.includes('YCCG:'), true, '!lapor must include YCCG field');
            assert.strictEqual(laporReply.includes('Sosis Ori:'), true, '!lapor must include Sosis Ori field');

            // Sesi pelaporan aktif terverifikasi
            const activeSession = getUserSession(kasirNorm);
            assert.ok(activeSession, 'User must have an active session');
            assert.strictEqual(activeSession.type, 'LAPOR', 'Session type must be LAPOR');

            // 2.4 Test !broadcastmenu: Ditolak jika bukan Super Admin
            mockSock.sentMessages.length = 0;
            const ctxBroadcastKasir = { sender: kasirJid, normSender: kasirNorm, isSenderAllowed: true, isSenderSuperAdmin: false, cleanText: '!broadcastmenu', lowerText: '!broadcastmenu' };
            await handleCommand(mockSock, { key: { remoteJid: kasirJid } }, ctxBroadcastKasir);
            assert.strictEqual(mockSock.sentMessages[0].content.text.includes('Super Admin'), true, 'Unauthorized broadcast must be rejected');

            // 2.5 Test !broadcastmenu: Berhasil jika dikirim Super Admin
            mockSock.sentMessages.length = 0;
            const ctxBroadcastSuper = { sender: superAdminJid, normSender: superAdminNorm, isSenderAllowed: true, isSenderSuperAdmin: true, cleanText: '!broadcastmenu', lowerText: '!broadcastmenu' };
            await handleCommand(mockSock, { key: { remoteJid: superAdminJid } }, ctxBroadcastSuper);

            // Verifikasi bahwa pesan pengumuman terkirim ke anggota whitelist
            assert.ok(mockSock.sentMessages.length >= 2, 'Broadcast must send announcement to recipients and confirmation to sender');
            const confirmationMsg = mockSock.sentMessages[mockSock.sentMessages.length - 1].content.text;
            assert.ok(confirmationMsg.includes('Broadcast Menu Berhasil Dikirim'));

            console.log('  ✔ Case 22.2: Modul 2 Clean separation of !menu and !lapor, reporting session activation, and Super Admin !broadcastmenu verified!');
        }

        // =====================================================================
        // TEST 3: Modul 3 - Parser Excel Yummy Coffee (YCCG) & Sosis RTE + Sesi
        // =====================================================================
        {
            const realYcgPath = path.resolve('ycg report/Y COFFEE 03-10-2026.xls');
            assert.strictEqual(fs.existsSync(realYcgPath), true, 'Sampel file YCG asli harus ada');

            // 3.1 Verifikasi parser terhadap file asli YCG
            assert.strictEqual(isYcgOrSosisFile(realYcgPath), true, 'File YCG harus terdeteksi');

            // Auto-detect tanggal dari nama file "03-10-2026"
            const parseAuto = parseYcgOrSosisExcel(realYcgPath);
            assert.strictEqual(parseAuto.targetDay, 3, 'Tanggal otomatis harus 3');
            assert.strictEqual(parseAuto.detectedDateStr, '03-10-2026');
            assert.strictEqual(parseAuto.isYcg, true);
            assert.strictEqual(parseAuto.yccg, 15, 'Penjualan tanggal 3 harus 15 cup');

            // Cek targetDay 2 dan targetDay 1
            const parseDay2 = parseYcgOrSosisExcel(realYcgPath, { targetDay: 2 });
            assert.strictEqual(parseDay2.yccg, 49, 'Penjualan tanggal 2 harus 49 cup');

            const parseDay1 = parseYcgOrSosisExcel(realYcgPath, { targetDay: 1 });
            assert.strictEqual(parseDay1.yccg, 27, 'Penjualan tanggal 1 harus 27 cup');

            // 3.2 Verifikasi parser terhadap mock file Sosis RTE
            const sosisMockFile = path.join(sandbox.path, 'SOSIS_RTE_03-10-2026.xlsx');
            {
                const wb = xlsx.utils.book_new();
                const rows = [];
                for (let i = 0; i < 14; i++) rows.push([]);
                rows.push(['No', 'PLU', '', '', '', '', '', 'DESKRIPSI']);
                rows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '1', '', '', '2', '', '', '3']);
                rows.push([]);
                rows.push([]);
                rows.push([1, '', '3001', '', '', '', '', '', 'SOSIS BAKAR ORIGINAL RTE', '', '', '', 10, '', '', 12, '', '', 8]);
                rows.push([]);
                rows.push([]);
                rows.push([2, '', '3002', '', '', '', '', '', 'SOSIS BAKAR KEJU RTE', '', '', '', 5, '', '', 7, '', '', 4]);
                const ws = xlsx.utils.aoa_to_sheet(rows);
                ws['!merges'] = [
                    { s: { c: 12, r: 18 }, e: { c: 14, r: 18 } },
                    { s: { c: 15, r: 18 }, e: { c: 17, r: 18 } },
                    { s: { c: 18, r: 18 }, e: { c: 20, r: 18 } },
                    { s: { c: 12, r: 21 }, e: { c: 14, r: 21 } },
                    { s: { c: 15, r: 21 }, e: { c: 17, r: 21 } },
                    { s: { c: 18, r: 21 }, e: { c: 20, r: 21 } }
                ];
                xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
                xlsx.writeFile(wb, sosisMockFile);
            }

            assert.strictEqual(isYcgOrSosisFile(sosisMockFile), true);
            const parseSosis = parseYcgOrSosisExcel(sosisMockFile, { fileName: 'SOSIS_RTE_03-10-2026.xlsx' });
            assert.strictEqual(parseSosis.isSosis, true);
            assert.strictEqual(parseSosis.targetDay, 3);
            assert.strictEqual(parseSosis.sosisOri, 8, 'Sosis Ori tanggal 3 harus 8 pcs');
            assert.strictEqual(parseSosis.sosisKeju, 4, 'Sosis Keju tanggal 3 harus 4 pcs');
            assert.strictEqual(parseSosis.totalRte, 12, 'Total RTE tanggal 3 harus 12 pcs');

            // 3.3 Enforce Session Protection: Upload di LUAR sesi !lapor harus DITOLAK
            clearUserSession(kasirNorm);
            const mockSock = createMockSocket();
            const ycgBuffer = fs.readFileSync(realYcgPath);

            const docMsgYcg = {
                key: { remoteJid: kasirJid },
                message: {
                    documentMessage: {
                        fileName: 'Y COFFEE 03-10-2026.xls',
                        mimetype: 'application/vnd.ms-excel'
                    }
                },
                _mockBuffer: ycgBuffer
            };

            const ctxKasirUpload = { sender: kasirJid, normSender: kasirNorm, isSenderAllowed: true };
            const handledOutside = await handleDocumentUpload(mockSock, docMsgYcg, ctxKasirUpload);

            assert.strictEqual(handledOutside, true);
            assert.strictEqual(mockSock.sentMessages.length, 1);
            const rejectMsg = mockSock.sentMessages[0].content.text;
            assert.ok(rejectMsg.includes('hanya dapat diunggah saat sesi pelaporan aktif'), 'Upload outside session must be rejected with notice');
            assert.ok(rejectMsg.includes('!lapor'), 'Rejection must instruct to run !lapor');

            // 3.4 Upload di DALAM sesi !lapor: DITERIMA dan menghasilkan draf laporan terisi otomatis
            mockSock.sentMessages.length = 0;
            // Aktifkan sesi pelaporan kasir
            setPendingLaporSession(kasirNorm);
            assert.strictEqual(getUserSession(kasirNorm)?.type, 'LAPOR');

            const handledInside = await handleDocumentUpload(mockSock, docMsgYcg, ctxKasirUpload);
            assert.strictEqual(handledInside, true);
            assert.strictEqual(mockSock.sentMessages.length, 1);
            const acceptMsg = mockSock.sentMessages[0].content.text;

            assert.ok(acceptMsg.includes('DATA EXCEL BERHASIL DIBACA'));
            assert.ok(acceptMsg.includes('Penjualan YCCG: *15 Cup*'));
            assert.ok(acceptMsg.includes('YCCG: 15'), 'Draft template must have YCCG: 15 auto-filled');

            // 3.5 Unggah file Sosis di sesi yang sama: nilai YCCG dan Sosis digabungkan
            mockSock.sentMessages.length = 0;
            const sosisBuffer = fs.readFileSync(sosisMockFile);
            const docMsgSosis = {
                key: { remoteJid: kasirJid },
                message: {
                    documentMessage: {
                        fileName: 'SOSIS_RTE_03-10-2026.xlsx',
                        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    }
                },
                _mockBuffer: sosisBuffer
            };

            const handledSosisInside = await handleDocumentUpload(mockSock, docMsgSosis, ctxKasirUpload);
            assert.strictEqual(handledSosisInside, true);
            const sosisAcceptMsg = mockSock.sentMessages[0].content.text;

            assert.ok(sosisAcceptMsg.includes('DATA EXCEL BERHASIL DIBACA'));
            assert.ok(sosisAcceptMsg.includes('Sosis Original: *8 Pcs*'));
            assert.ok(sosisAcceptMsg.includes('Sosis Keju    : *4 Pcs*'));
            assert.ok(sosisAcceptMsg.includes('YCCG: 15'), 'Preserved YCCG value from prior upload');
            assert.ok(sosisAcceptMsg.includes('Sosis Ori: 8'), 'Auto-filled Sosis Ori: 8');
            assert.ok(sosisAcceptMsg.includes('Sosis Keju: 4'), 'Auto-filled Sosis Keju: 4');

            // 3.6 Pembatalan sesi pelaporan dengan mengetik 'batal'
            mockSock.sentMessages.length = 0;
            const handledBatal = await handleInteractiveResponse(mockSock, { key: { remoteJid: kasirJid } }, {
                sender: kasirJid,
                normSender: kasirNorm,
                cleanText: 'batal',
                lowerText: 'batal'
            });
            assert.strictEqual(handledBatal, true);
            assert.ok(mockSock.sentMessages[0].content.text.includes('Sesi pelaporan closing telah dibatalkan'));
            assert.strictEqual(hasPendingSession(kasirNorm), false, 'Session must be cleared on batal');

            console.log('  ✔ Case 22.3: Modul 3 YCG & Sosis Excel parsing, date detection, session protection, and auto-filled draft reporting verified!');
        }

        return { passed: 3, failed: 0, feature: 'Feature 22 (Tahap 1 Bot Modernization: Rekap ExcelJS, !menu/!lapor Separation, YCG/Sosis Parser)' };
    } finally {
        if (origWlContent !== null) {
            fs.writeFileSync('whitelist.json', origWlContent, 'utf8');
        }
        sandbox.cleanup();
    }
}

import { fileURLToPath } from 'url';

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 22 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
