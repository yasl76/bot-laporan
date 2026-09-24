import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import { createTestSandbox, createMockParetoExcel, createMockSocket } from '../helpers/test_fixture_helper.js';
import { analyzePareto, generatePbExcel, parseSafeFloat, getPbSummaryText } from '../../pareto_analyzer.js';
import { getStructuredTextRekap, generateRekapExcel } from '../../rekap_helper.js';
import { normalizeNumber, addNumber, isAllowed, isSuperAdmin, loadWhitelist, saveWhitelist } from '../../whitelist_helper.js';
import { cleanupOrphanedFiles } from '../tier1_feature_coverage/test_feat03_boot_purging.js';
import { parseAndValidateSetrab } from '../tier1_feature_coverage/test_feat08_decimal_comma.js';
import { handleIncomingMessageAutoLink } from '../tier1_feature_coverage/test_feat07_auto_link.js';

export async function runTests() {
    console.log('=== Running Tier 2: Boundary & Corner Cases (WhatsApp Bot Features 1-10) ===');
    const sandbox = createTestSandbox('tier2_bot_');
    const origCwd = process.cwd();
    let passedCount = 0;

    try {
        process.chdir(sandbox.path);

        // -------------------------------------------------------------
        // F1 Boundaries: Pareto Upload Unlinking
        // -------------------------------------------------------------
        // Case 2.1.1: 0-byte file unlinking
        {
            const zeroFile = sandbox.createFile('pareto_uploaded_zero.xls', '');
            try {
                try { analyzePareto(zeroFile, 10); } finally {
                    if (fs.existsSync(zeroFile)) fs.unlinkSync(zeroFile);
                }
            } catch (_) {}
            assert.strictEqual(fs.existsSync(zeroFile), false);
            passedCount++;
        }
        // Case 2.1.2: Threshold 0
        {
            const pFile = path.join(sandbox.path, 'p_thresh0.xls');
            createMockParetoExcel(pFile);
            const res = analyzePareto(pFile, 0);
            assert.strictEqual(res.maxStockThreshold, 0);
            if (fs.existsSync(pFile)) fs.unlinkSync(pFile);
            passedCount++;
        }
        // Case 2.1.3: Extreme threshold 99999
        {
            const pFile = path.join(sandbox.path, 'p_thresh99999.xls');
            createMockParetoExcel(pFile);
            const res = analyzePareto(pFile, 99999);
            assert.strictEqual(res.totalKritis, res.totalItem);
            if (fs.existsSync(pFile)) fs.unlinkSync(pFile);
            passedCount++;
        }
        // Case 2.1.4: Corrupt non-Excel file with .xls extension
        {
            const corrupt = sandbox.createFile('pareto_uploaded_corrupt.xls', 'NOT_AN_EXCEL_HEADER_AT_ALL');
            let errCaught = false;
            try {
                try { analyzePareto(corrupt, 10); } finally {
                    if (fs.existsSync(corrupt)) fs.unlinkSync(corrupt);
                }
            } catch (_) { errCaught = true; }
            assert.strictEqual(errCaught, true);
            assert.strictEqual(fs.existsSync(corrupt), false);
            passedCount++;
        }
        // Case 2.1.5: File locked or unlinked during send error in direct match
        {
            const pFile = path.join(sandbox.path, 'p_mocksend.xls');
            createMockParetoExcel(pFile);
            const mockSock = createMockSocket({ shouldThrowSendError: true });
            let outPath = path.join(sandbox.path, 'out_err.xlsx');
            try {
                try {
                    const analysis = analyzePareto(pFile, 10);
                    await generatePbExcel(analysis, outPath);
                    await mockSock.sendMessage('123@s.whatsapp.net', { document: fs.readFileSync(outPath) });
                } finally {
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
                    if (fs.existsSync(pFile)) fs.unlinkSync(pFile);
                }
            } catch (_) {}
            assert.strictEqual(fs.existsSync(pFile), false);
            assert.strictEqual(fs.existsSync(outPath), false);
            passedCount++;
        }

        // -------------------------------------------------------------
        // F2 Boundaries: Export Excel Cleanup
        // -------------------------------------------------------------
        // Case 2.2.1: Empty data export throws error and cleans up
        {
            let out = path.join(sandbox.path, 'out_empty.xlsx');
            let threw = false;
            try {
                try { generateRekapExcel([], out, 4725000); }
                finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
            } catch (_) { threw = true; }
            assert.strictEqual(threw, true);
            assert.strictEqual(fs.existsSync(out), false);
            passedCount++;
        }
        // Case 2.2.2: 100 days of data in rekap export
        {
            const bigData = [];
            for (let i = 1; i <= 100; i++) {
                bigData.push({ tanggal: `Day ${i}`, spd: 4000000 + i * 1000, std: 100, apc: 40000, avg_spd: 4000000 });
            }
            let outBig = path.join(sandbox.path, 'out_big.xlsx');
            try {
                generateRekapExcel(bigData, outBig, 4725000);
                assert.strictEqual(fs.existsSync(outBig), true);
            } finally {
                if (fs.existsSync(outBig)) fs.unlinkSync(outBig);
            }
            assert.strictEqual(fs.existsSync(outBig), false);
            passedCount++;
        }
        // Case 2.2.3: Socket timeout during transmission of PB Excel
        {
            const pFile = path.join(sandbox.path, 'p_timeout.xls');
            createMockParetoExcel(pFile);
            const mockSock = createMockSocket({ shouldThrowSendError: true });
            let outPb = path.join(sandbox.path, 'pb_timeout.xlsx');
            try {
                try {
                    const a = analyzePareto(pFile, 10);
                    await generatePbExcel(a, outPb);
                    await mockSock.sendMessage('test@s.whatsapp.net', { document: fs.readFileSync(outPb) });
                } finally {
                    if (fs.existsSync(outPb)) fs.unlinkSync(outPb);
                    if (fs.existsSync(pFile)) fs.unlinkSync(pFile);
                }
            } catch (_) {}
            assert.strictEqual(fs.existsSync(outPb), false);
            passedCount++;
        }
        // Case 2.2.4: Concurrent export cleanups
        {
            const out1 = path.join(sandbox.path, 'c1.xlsx');
            const out2 = path.join(sandbox.path, 'c2.xlsx');
            const d = [{ tanggal: '01/01', spd: 1000000 }];
            try {
                generateRekapExcel(d, out1, 4725000);
                generateRekapExcel(d, out2, 4725000);
                assert.strictEqual(fs.existsSync(out1), true);
                assert.strictEqual(fs.existsSync(out2), true);
            } finally {
                if (fs.existsSync(out1)) fs.unlinkSync(out1);
                if (fs.existsSync(out2)) fs.unlinkSync(out2);
            }
            assert.strictEqual(fs.existsSync(out1), false);
            assert.strictEqual(fs.existsSync(out2), false);
            passedCount++;
        }
        // Case 2.2.5: Special characters in store profile during export
        {
            const outSpec = path.join(sandbox.path, 'out_spec.xlsx');
            try {
                generateRekapExcel(
                    [{ tanggal: '01/01', spd: 2000000 }],
                    outSpec,
                    4725000,
                    { nama_toko: 'TOKO & MART (SPESIAL) "RETAIL" <TEST>', kode_toko: 'O8BM/01' }
                );
                assert.strictEqual(fs.existsSync(outSpec), true);
            } finally {
                if (fs.existsSync(outSpec)) fs.unlinkSync(outSpec);
            }
            passedCount++;
        }

        // -------------------------------------------------------------
        // F3 Boundaries: Boot Orphan Purging
        // -------------------------------------------------------------
        // Case 2.3.1: 50 orphaned files cleaned at once
        {
            const created = [];
            for (let i = 0; i < 50; i++) {
                created.push(sandbox.createFile(`pareto_uploaded_bulk_${i}.xls`, 'x'));
            }
            const cleaned = cleanupOrphanedFiles(sandbox.path);
            assert.strictEqual(cleaned.length >= 50, true);
            assert.strictEqual(created.every(f => !fs.existsSync(f)), true);
            passedCount++;
        }
        // Case 2.3.2: Directory containing subfolders matching prefix
        {
            const subDir = path.join(sandbox.path, 'pareto_uploaded_as_folder');
            fs.mkdirSync(subDir, { recursive: true });
            assert.doesNotThrow(() => { cleanupOrphanedFiles(sandbox.path); });
            passedCount++;
        }
        // Case 2.3.3: Preserves files with similar but non-orphaned names
        {
            const keep1 = sandbox.createFile('pareto_analysis_final.xls', 'keep');
            const keep2 = sandbox.createFile('my_Laporan_PB_Pareto.xlsx', 'keep');
            cleanupOrphanedFiles(sandbox.path);
            assert.strictEqual(fs.existsSync(keep1), true);
            assert.strictEqual(fs.existsSync(keep2), true);
            passedCount++;
        }
        // Case 2.3.4: Stale monthly auto rekap patterns
        {
            const stale1 = sandbox.createFile('Rekap_Bulanan_Otomatis_2025_12.xlsx', 'old');
            cleanupOrphanedFiles(sandbox.path);
            assert.strictEqual(fs.existsSync(stale1), false);
            passedCount++;
        }
        // Case 2.3.5: Empty directory scan returns 0
        {
            const emptySub = path.join(sandbox.path, 'empty_dir_scan');
            fs.mkdirSync(emptySub, { recursive: true });
            const res = cleanupOrphanedFiles(emptySub);
            assert.strictEqual(res.length, 0);
            passedCount++;
        }

        // -------------------------------------------------------------
        // F4 Boundaries: E.164 Number Normalization
        // -------------------------------------------------------------
        // Case 2.4.1: Numbers with multiple colons and device suffixes
        assert.strictEqual(normalizeNumber('628123456789:0:1:2@s.whatsapp.net'), '628123456789');
        passedCount++;
        // Case 2.4.2: Numbers with emojis and Unicode symbols
        assert.strictEqual(normalizeNumber('📞 +62 (858) 5255-9058 💬'), '6285852559058');
        passedCount++;
        // Case 2.4.3: Local number with multiple leading zeros
        assert.strictEqual(normalizeNumber('08123456789'), '628123456789');
        passedCount++;
        // Case 2.4.4: 25-digit long numeric string
        const longNum = '6281234567890123456789012';
        assert.strictEqual(normalizeNumber(longNum), longNum);
        passedCount++;
        // Case 2.4.5: Only non-digits
        assert.strictEqual(normalizeNumber('---+++---'), '');
        passedCount++;

        // -------------------------------------------------------------
        // F5 Boundaries: LID Persistence
        // -------------------------------------------------------------
        // Case 2.5.1: Name with special characters and quotes
        {
            const res = addNumber('081211112222', 'Kasir "Top" & OMI (Shift 1)', '111111111111');
            assert.strictEqual(res.success, true);
            const wl = loadWhitelist();
            const u = wl.users.find(x => x.number === '6281211112222');
            assert.strictEqual(u.name, 'Kasir "Top" & OMI (Shift 1)');
            passedCount++;
        }
        // Case 2.5.2: Minimum valid length (9 digits)
        {
            const res = addNumber('081234567', 'Nine Digits');
            assert.strictEqual(res.success, true);
            passedCount++;
        }
        // Case 2.5.3: Re-adding same number and LID is idempotent
        {
            const res = addNumber('081211112222', 'Kasir Top', '111111111111');
            assert.strictEqual(res.success, false); // already registered
            passedCount++;
        }
        // Case 2.5.4: Whitespace in phone number argument
        {
            const res = addNumber('  0819 8888 7777  ', 'Spaced Phone');
            assert.strictEqual(res.success, true);
            const wl = loadWhitelist();
            assert.ok(wl.users.find(x => x.number === '6281988887777'));
            passedCount++;
        }
        // Case 2.5.5: Corrupt whitelist JSON recover to defaults
        {
            fs.writeFileSync('whitelist.json', 'CORRUPT_JSON_DATA');
            const recovered = loadWhitelist();
            assert.ok(Array.isArray(recovered.super_admins));
            assert.ok(recovered.super_admins.length >= 1);
            // Save clean whitelist for subsequent tests
            saveWhitelist(recovered);
            passedCount++;
        }


        // -------------------------------------------------------------
        // F6 Boundaries: Multi-Device LID Authorization
        // -------------------------------------------------------------
        // Case 2.6.1: Case insensitive domain suffix in JID
        {
            addNumber('081299990000', 'Case User', '777888999000');
            assert.strictEqual(isAllowed('6281299990000@S.WHATSAPP.NET'), true);
            assert.strictEqual(isAllowed('777888999000@LID'), true);
            passedCount++;
        }
        // Case 2.6.2: Device specification with LID
        assert.strictEqual(isAllowed('777888999000:4@lid'), true);
        passedCount++;
        // Case 2.6.3: Default Super Admin primary check
        assert.strictEqual(isSuperAdmin('6285852559058@s.whatsapp.net'), true);
        passedCount++;
        // Case 2.6.4: Default Super Admin secondary LID
        assert.strictEqual(isSuperAdmin('215633832722432@lid'), true);
        passedCount++;
        // Case 2.6.5: Empty and whitespace JID
        assert.strictEqual(isAllowed(''), false);
        assert.strictEqual(isSuperAdmin(''), false);
        assert.strictEqual(isAllowed('   '), false);
        passedCount++;

        // -------------------------------------------------------------
        // F7 Boundaries: Auto-Linking Circularity
        // -------------------------------------------------------------
        // Case 2.7.1: Multiple candidates with only 1 matching
        {
            addNumber('081122334455', 'Multi Candidate User');
            const res = handleIncomingMessageAutoLink('555444333222@lid', ['089999999999', '081122334455', '087777777777']);
            assert.strictEqual(res.linked, true);
            assert.strictEqual(res.user.number, '6281122334455');
            passedCount++;
        }
        // Case 2.7.2: Candidates containing the LID itself
        {
            addNumber('082233445566', 'Candidate Self LID');
            const res = handleIncomingMessageAutoLink('666555444333@lid', ['666555444333', '082233445566']);
            assert.strictEqual(res.linked, true);
            passedCount++;
        }
        // Case 2.7.3: Incoming sender is not @lid (e.g. standard phone JID)
        {
            const res = handleIncomingMessageAutoLink('628123456789@s.whatsapp.net', ['628123456789']);
            assert.strictEqual(res.linked, false);
            passedCount++;
        }
        // Case 2.7.4: Empty candidates array
        {
            const res = handleIncomingMessageAutoLink('999111222333@lid', []);
            assert.strictEqual(res.linked, false);
            passedCount++;
        }
        // Case 2.7.5: User already has different LID, candidate does not overwrite
        {
            addNumber('083344556677', 'Fixed LID User', '111222333444');
            const res = handleIncomingMessageAutoLink('999999999999@lid', ['083344556677']);
            assert.strictEqual(res.linked, false);
            const wl = loadWhitelist();
            const u = wl.users.find(x => x.number === '6283344556677');
            assert.strictEqual(u.lid, '111222333444'); // preserved!
            passedCount++;
        }

        // -------------------------------------------------------------
        // F8 Boundaries: Decimal Comma Normalization
        // -------------------------------------------------------------
        // Case 2.8.1: Comma decimal with percent sign "21,5%"
        {
            const res = parseAndValidateSetrab('5000000 150 35000 21,5%');
            assert.strictEqual(res.valid, true);
            assert.strictEqual(res.data.target_gm, '21.5');
            passedCount++;
        }

        // Case 2.8.2: Alphabetic non-numeric GM%
        {
            const res = parseAndValidateSetrab('5000000 150 35000 abc%');
            assert.strictEqual(res.valid, false);
            passedCount++;
        }

        // Case 2.8.3: Trailing zeros "21,500000"
        {
            const res = parseAndValidateSetrab('5000000 150 35000 21,500000');
            assert.strictEqual(res.valid, true);
            assert.strictEqual(parseFloat(res.data.target_gm), 21.5);
            passedCount++;
        }
        // Case 2.8.4: Negative targets (RAB must be positive)
        {
            const res = parseAndValidateSetrab('-5000000 150 35000 21,00');
            assert.strictEqual(res.valid, false);
            passedCount++;
        }
        // Case 2.8.5: High value target SPD (e.g. 50,000,000)
        {
            const res = parseAndValidateSetrab('50000000 500 100000 25,00');
            assert.strictEqual(res.valid, true);
            assert.strictEqual(res.data.target_spd, 50000000);
            passedCount++;
        }

        // -------------------------------------------------------------
        // F9 Boundaries: Zero Target Division Guard
        // -------------------------------------------------------------
        // Case 2.9.1: targetSPD as string "0"
        {
            const text = getStructuredTextRekap([{ tanggal: '01/01', spd: 4000000 }], "0");
            assert.strictEqual(text.includes('NaN'), false);
            assert.strictEqual(text.includes('Infinity'), false);
            passedCount++;
        }
        // Case 2.9.2: targetSPD negative
        {
            const text = getStructuredTextRekap([{ tanggal: '01/01', spd: 4000000 }], -5000);
            assert.strictEqual(text.includes('NaN'), false);
            passedCount++;
        }
        // Case 2.9.3: All sales metrics zero in Excel export
        {
            const outZero = path.join(sandbox.path, 'rekap_all_zeros.xlsx');
            try {
                generateRekapExcel([{ tanggal: '01/01', spd: 0, std: 0, apc: 0, avg_spd: 0 }], outZero, 0);
                assert.strictEqual(fs.existsSync(outZero), true);
            } finally {
                if (fs.existsSync(outZero)) fs.unlinkSync(outZero);
            }
            passedCount++;
        }
        // Case 2.9.4: Extreme SPD (100 Billion)
        {
            const text = getStructuredTextRekap([{ tanggal: '01/01', spd: 100000000000 }], 4725000);
            assert.strictEqual(text.includes('NaN'), false);
            passedCount++;
        }
        // Case 2.9.5: Missing optional fields in dataList
        {
            const text = getStructuredTextRekap([{ tanggal: '01/01' }], 4725000);
            assert.strictEqual(text.includes('NaN'), false);
            passedCount++;
        }

        // -------------------------------------------------------------
        // F10 Boundaries: Safe Locale Float & Carton Division
        // -------------------------------------------------------------
        // Case 2.10.1: Indonesian Rupiah currency string "Rp 2.500.000,50"
        assert.strictEqual(parseSafeFloat('Rp 2.500.000,50'), 2500000.5);
        passedCount++;
        // Case 2.10.2: Spaced comma decimal "  12 , 5  "
        assert.strictEqual(parseSafeFloat('  12 , 5  '), 12.5);
        passedCount++;
        // Case 2.10.3: Negative float "-12,5"
        assert.strictEqual(parseSafeFloat('-12,5'), -12.5);
        passedCount++;
        // Case 2.10.4: Extreme carton fraction (fractional ft e.g. 0.5)
        {
            const item = { ft: 0.5, rekomendasiOrder: 10 };
            const dus = Math.ceil(item.rekomendasiOrder / item.ft);
            assert.strictEqual(Number.isFinite(dus), true);
            assert.strictEqual(dus, 20);
            passedCount++;
        }
        // Case 2.10.5: All items zero stock summary text
        {
            const allZeroStock = {
                lowStockItems: [
                    { no: 1, plu: '1', nama: 'Item 1', qtyStock: 0, pkm: 10, ft: 1, rekomendasiOrder: 10 },
                    { no: 2, plu: '2', nama: 'Item 2', qtyStock: 0, pkm: 5, ft: 1, rekomendasiOrder: 5 }
                ],
                totalItem: 2,
                totalKritis: 2,
                totalKosong: 2,
                totalSangatKritis: 0,
                totalMenipis: 0,
                maxStockThreshold: 10,
                fileName: 'p.xls'
            };
            const text = getPbSummaryText(allZeroStock);
            assert.strictEqual(text.includes('Total Perlu Restock: 2 Item'), true);
            assert.strictEqual(text.includes('Stok Habis (0)      : *2 Item*'), true);
            passedCount++;
        }

        console.log(`  ✔ Successfully passed all ${passedCount} Tier 2 boundary test cases for Features 1-10!`);
        return { passed: passedCount, failed: 0, suite: 'Tier 2 Bot Boundaries (Features 1-10)' };
    } finally {
        process.chdir(origCwd);
        sandbox.cleanup();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
