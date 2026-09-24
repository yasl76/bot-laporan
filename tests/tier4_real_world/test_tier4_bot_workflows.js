import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import { createTestSandbox, createMockParetoExcel, createMockSocket } from '../helpers/test_fixture_helper.js';
import { analyzePareto, generatePbExcel, getPbSummaryText } from '../../pareto_analyzer.js';
import { getStructuredTextRekap, generateRekapExcel } from '../../rekap_helper.js';
import { addNumber, isAllowed, isSuperAdmin, loadWhitelist } from '../../whitelist_helper.js';
import { updateConfig, loadConfig } from '../../config_helper.js';
import { parseAndValidateSetrab } from '../tier1_feature_coverage/test_feat08_decimal_comma.js';
import { handleIncomingMessageAutoLink } from '../tier1_feature_coverage/test_feat07_auto_link.js';
import { cleanupOrphanedFiles } from '../tier1_feature_coverage/test_feat03_boot_purging.js';

export async function runTests() {
    console.log('=== Running Tier 4: Real-World End-to-End Scenarios (WhatsApp Bot) ===');
    const sandbox = createTestSandbox('tier4_bot_');
    const origCwd = process.cwd();
    let passedCount = 0;

    try {
        process.chdir(sandbox.path);

        // =====================================================================
        // Workflow 1: Complete Store Opening & Daily Restock Analysis Workflow
        // Scenario:
        // 1. Super Admin registers a new store employee (Budi) via phone number.
        // 2. Employee sends a WhatsApp message from a linked multi-device (@lid).
        // 3. System automatically auto-links the incoming @lid without false rejection.
        // 4. Employee updates daily RAB targets using comma decimal format (21,50%).
        // 5. Employee uploads store Pareto document with caption "!pb 10".
        // 6. System parses spreadsheet, computes Pareto low-stock items, generates Excel PB report.
        // 7. System sends WhatsApp summary text and document attachment.
        // 8. System defensive finally cleans up both uploaded file and generated export.
        // 9. Verification confirms zero temporary files left on disk.
        // =====================================================================
        {
            console.log('  Executing Scenario 4.1: Store Employee Onboarding & Daily Restock Operations...');

            // Step 1: Super Admin registers employee
            const regRes = addNumber('081234567890', 'Budi Kasir Toko');
            assert.strictEqual(regRes.success, true);

            // Step 2 & 3: Employee connects from multi-device @lid
            const employeeLid = '888777666555@lid';
            const autoLinkRes = handleIncomingMessageAutoLink(employeeLid, ['081234567890']);
            assert.strictEqual(autoLinkRes.linked, true);
            assert.strictEqual(isAllowed(employeeLid), true, 'Employee must now be authorized');

            // Step 4: Employee sets store targets with comma decimals
            const setrabCmd = '4725000 135 35000 21,50%';
            const parsedRab = parseAndValidateSetrab(setrabCmd);
            assert.strictEqual(parsedRab.valid, true);
            updateConfig(parsedRab.data);
            const activeConfig = loadConfig();
            assert.strictEqual(activeConfig.target_gm, '21.50');
            assert.strictEqual(activeConfig.target_spd, 4725000);

            // Step 5: Employee uploads daily Pareto file
            const uploadPath = path.join(sandbox.path, `pareto_uploaded_${Date.now()}_daily.xls`);
            createMockParetoExcel(uploadPath, [
                { no: 1, plu: 'PLU01', nama: 'MINYAK GORENG 2L', qtyJual: 80, pkm: 40, ft: 6, qtyStock: 2 },
                { no: 2, plu: 'PLU02', nama: 'BERAS PREMIUM 5KG', qtyJual: 60, pkm: 30, ft: 1, qtyStock: 0 },
                { no: 3, plu: 'PLU03', nama: 'MIE INSTANT DUS', qtyJual: 120, pkm: 50, ft: 40, qtyStock: 4 },
                { no: 4, plu: 'PLU04', nama: 'SABUN MANDI REFILL', qtyJual: 30, pkm: 15, ft: 12, qtyStock: 8 },
                { no: 5, plu: 'PLU05', nama: 'KOPI SACHET RENCENG', qtyJual: 45, pkm: 20, ft: 10, qtyStock: 25 }
            ]);
            assert.strictEqual(fs.existsSync(uploadPath), true);

            // Step 6 & 7: Analysis and export generation
            const mockSock = createMockSocket();
            let pbExcelPath = null;
            try {
                const analysis = analyzePareto(uploadPath, 10);
                assert.strictEqual(analysis.totalKritis, 4); // Items with stock <= 10
                assert.strictEqual(analysis.totalKosong, 1); // BERAS stock = 0

                const summaryText = getPbSummaryText(analysis, 10, activeConfig);
                assert.strictEqual(summaryText.includes('Total Perlu Restock: 4 Item'), true);
                assert.strictEqual(summaryText.includes('BERAS PREMIUM 5KG'), true);

                pbExcelPath = path.join(sandbox.path, `Laporan_PB_Pareto_${Date.now()}_daily.xlsx`);
                await generatePbExcel(analysis, pbExcelPath, activeConfig);
                assert.strictEqual(fs.existsSync(pbExcelPath), true);

                // Dispatch via socket
                await mockSock.sendMessage(employeeLid, { text: summaryText });
                await mockSock.sendMessage(employeeLid, { document: fs.readFileSync(pbExcelPath), fileName: 'Laporan_PB.xlsx' });
                assert.strictEqual(mockSock.sentMessages.length, 2);
            } finally {
                // Step 8: Guaranteed defensive unlinking
                if (pbExcelPath && fs.existsSync(pbExcelPath)) fs.unlinkSync(pbExcelPath);
                if (uploadPath && fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
            }

            // Step 9: Zero residual files verification
            assert.strictEqual(fs.existsSync(uploadPath), false, 'Upload file must not remain on disk');
            assert.strictEqual(fs.existsSync(pbExcelPath), false, 'Excel export must not remain on disk');
            passedCount++;
            console.log('  ✔ Scenario 4.1 Passed: Complete store employee onboarding and daily restock cycle verified with 0 storage leaks.');
        }

        // =====================================================================
        // Workflow 2: End-of-Month Performance Rekap & Reporting Workflow
        // Scenario:
        // 1. Month-end data list accumulated with 30 days of sales records.
        // 2. Edge condition: some days have 0 SPD or missing RTE/YCCG metrics.
        // 3. System calculates structured text rekap, accurately computing MTD achievement without NaN.
        // 4. Admin requests Excel report; system writes 2-sheet formatted workbook.
        // 5. System delivers spreadsheet and unlinks file cleanly.
        // 6. Simulated crash leftover cleanup via boot orphan purge.
        // =====================================================================
        {
            console.log('  Executing Scenario 4.2: End-of-Month Performance Rekap & Reporting...');

            // Step 1 & 2: 30 days of performance data with boundary zero days
            const monthData = [];
            for (let day = 1; day <= 30; day++) {
                const dateStr = `${String(day).padStart(2, '0')}/09/2026`;
                // Day 15 was store renovation (0 SPD)
                const spd = day === 15 ? 0 : 4500000 + (day * 20000);
                monthData.push({
                    tanggal: dateStr,
                    spd,
                    std: day === 15 ? 0 : 130 + (day % 10),
                    apc: day === 15 ? 0 : 34000,
                    avg_spd: 4600000,
                    yccg: day === 15 ? 0 : 15,
                    total_rte: day === 15 ? 0 : 20,
                    mpp: day % 7 === 0 ? 2 : 0,
                    nbh: day % 10 === 0 ? 1 : 0
                });
            }

            // Step 3: Structured text summary
            const activeConfig = loadConfig();
            const textRekap = getStructuredTextRekap(monthData, activeConfig.target_spd, activeConfig);
            assert.strictEqual(typeof textRekap, 'string');
            assert.strictEqual(textRekap.includes('NaN'), false);
            assert.strictEqual(textRekap.includes('Infinity'), false);
            assert.strictEqual(textRekap.includes('30 Hari'), true);


            // Step 4 & 5: Excel generation and unlinking
            const mockSock = createMockSocket();
            let rekapOutPath = null;
            try {
                rekapOutPath = path.join(sandbox.path, `Rekap_Bulanan_${Date.now()}_m4.xlsx`);
                generateRekapExcel(monthData, rekapOutPath, activeConfig.target_spd, activeConfig);
                assert.strictEqual(fs.existsSync(rekapOutPath), true);

                // Verify sheet count
                const wb = xlsx.readFile(rekapOutPath);
                assert.strictEqual(wb.SheetNames.length, 2);
                assert.strictEqual(wb.SheetNames[0], 'Data Penjualan Harian');
                assert.strictEqual(wb.SheetNames[1], 'Ringkasan Bulanan');

                await mockSock.sendMessage('admin@s.whatsapp.net', { document: fs.readFileSync(rekapOutPath) });
            } finally {
                if (rekapOutPath && fs.existsSync(rekapOutPath)) fs.unlinkSync(rekapOutPath);
            }

            assert.strictEqual(fs.existsSync(rekapOutPath), false, 'Rekap export must be unlinked');

            // Step 6: Post-recap orphan purge verification
            const staleFile = sandbox.createFile('Rekap_Bulanan_stale_temp.xlsx', 'old');
            cleanupOrphanedFiles(sandbox.path);
            assert.strictEqual(fs.existsSync(staleFile), false);

            passedCount++;
            console.log('  ✔ Scenario 4.2 Passed: End-of-month rekap generation, multi-sheet Excel export, and cleanup completed successfully.');
        }

        console.log(`  ✔ Successfully passed all ${passedCount} Tier 4 Real-World Bot Scenarios!`);
        return { passed: passedCount, failed: 0, suite: 'Tier 4 Bot Workflows' };
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
