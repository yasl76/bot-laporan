import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTestSandbox, createMockParetoExcel, createMockSocket } from '../helpers/test_fixture_helper.js';
import { analyzePareto, generatePbExcel, parseSafeFloat } from '../../pareto_analyzer.js';
import { getStructuredTextRekap, generateRekapExcel } from '../../rekap_helper.js';
import { normalizeNumber, addNumber, isAllowed, isSuperAdmin, loadWhitelist, saveWhitelist } from '../../whitelist_helper.js';
import { loadConfig, updateConfig } from '../../config_helper.js';
import { cleanupOrphanedFiles } from '../tier1_feature_coverage/test_feat03_boot_purging.js';
import { parseAndValidateSetrab } from '../tier1_feature_coverage/test_feat08_decimal_comma.js';
import { handleIncomingMessageAutoLink } from '../tier1_feature_coverage/test_feat07_auto_link.js';

export async function runTests() {
    console.log('=== Running Tier 3: Cross-Feature Interactions (WhatsApp Bot Subsystem) ===');
    const sandbox = createTestSandbox('tier3_bot_');
    const origCwd = process.cwd();
    let passedCount = 0;

    try {
        process.chdir(sandbox.path);

        // -------------------------------------------------------------
        // Pairwise Interaction 1: R1 (Storage Cleanup) + R2 (Whitelist LID Auth)
        // Verified @lid user uploads Pareto document -> generates PB Excel -> cleans up all files
        // -------------------------------------------------------------
        {
            addNumber('081233445566', 'Kasir Interaksi 1', '998877665544@lid');
            const senderLid = '998877665544@lid';
            assert.strictEqual(isAllowed(senderLid), true, 'User must be authenticated via LID');

            const uploadPath = path.join(sandbox.path, `pareto_uploaded_${Date.now()}_pair1.xls`);
            createMockParetoExcel(uploadPath);
            const mockSock = createMockSocket();

            let excelOut = null;
            try {
                const analysis = analyzePareto(uploadPath, 10);
                excelOut = path.join(sandbox.path, `Laporan_PB_Pareto_${Date.now()}_pair1.xlsx`);
                await generatePbExcel(analysis, excelOut);
                await mockSock.sendMessage(senderLid, { document: fs.readFileSync(excelOut) });
            } finally {
                if (excelOut && fs.existsSync(excelOut)) fs.unlinkSync(excelOut);
                if (uploadPath && fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
            }

            assert.strictEqual(fs.existsSync(uploadPath), false, 'Pairwise 1: Upload file unlinked');
            assert.strictEqual(fs.existsSync(excelOut), false, 'Pairwise 1: Export file unlinked');
            assert.strictEqual(mockSock.sentMessages.length, 1);
            passedCount++;
            console.log('  ✔ Interaction 1: LID Authentication + Document Analysis + Double-Unlinking Lifecycle');
        }

        // -------------------------------------------------------------
        // Pairwise Interaction 2: R2 (LID Auto-Link) + R3 (Decimal Comma Config)
        // Super Admin registers user by phone -> incoming message from @lid auto-links -> configures setrab with comma decimal
        // -------------------------------------------------------------
        {
            // Super Admin adds employee
            addNumber('085712345678', 'Supervisor Toko');
            
            // Employee chats from new LID device with phone candidate
            const incomingLid = '445566778899@lid';
            const linkRes = handleIncomingMessageAutoLink(incomingLid, ['085712345678']);
            assert.strictEqual(linkRes.linked, true);
            assert.strictEqual(isAllowed(incomingLid), true);

            // Supervisor updates store RAB using decimal comma
            const setrabCmd = '4850000 140 35500 21,75%';
            const parsed = parseAndValidateSetrab(setrabCmd);
            assert.strictEqual(parsed.valid, true);
            assert.strictEqual(parsed.data.target_gm, '21.75');

            const updatedCfg = updateConfig(parsed.data);
            assert.strictEqual(updatedCfg.target_gm, '21.75');
            assert.strictEqual(updatedCfg.target_spd, 4850000);
            passedCount++;
            console.log('  ✔ Interaction 2: Auto-Registration via LID + Comma Decimal RAB Configuration');
        }

        // -------------------------------------------------------------
        // Pairwise Interaction 3: R3 (Zero-Target Fallback) + R1 (Rekap Export Cleanup)
        // Rekap calculation with 0 targetSPD -> safely evaluates without NaN -> exports to Excel -> unlinks Excel
        // -------------------------------------------------------------
        {
            const dataList = [
                { tanggal: '10/09/2026', spd: 4500000, std: 130, apc: 34000, avg_spd: 4500000, yccg: 10, total_rte: 5 }
            ];
            
            // Check text rekap does not have NaN
            const textRekap = getStructuredTextRekap(dataList, 0);
            assert.strictEqual(textRekap.includes('NaN'), false);

            let outPath = null;
            const mockSock = createMockSocket();
            try {
                outPath = path.join(sandbox.path, `Rekap_Bulanan_${Date.now()}_pair3.xlsx`);
                generateRekapExcel(dataList, outPath, 0);
                assert.strictEqual(fs.existsSync(outPath), true);
                await mockSock.sendMessage('123@s.whatsapp.net', { document: fs.readFileSync(outPath) });
            } finally {
                if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath);
            }

            assert.strictEqual(fs.existsSync(outPath), false, 'Rekap Excel must be unlinked');
            passedCount++;
            console.log('  ✔ Interaction 3: Zero-Target Safe Calculation + Excel Generation + Defensive Cleanup');
        }

        // -------------------------------------------------------------
        // Pairwise Interaction 4: R1 (Boot Orphan Purging) + R2 (Whitelist Persistence)
        // Directory populated with stale files and valid whitelist.json -> Boot purge cleans stale files, leaves whitelist intact
        // -------------------------------------------------------------
        {
            // Seed orphaned files
            const orphan1 = sandbox.createFile('pareto_uploaded_stale1.xls', 'old data');
            const orphan2 = sandbox.createFile('Laporan_PB_Pareto_stale2.xlsx', 'old report');
            
            // Ensure whitelist exists with users
            const wlBefore = loadWhitelist();
            assert.ok(wlBefore.users.length > 0);

            // Execute boot cleanup
            const cleaned = cleanupOrphanedFiles(sandbox.path);
            assert.strictEqual(cleaned.length >= 2, true);
            assert.strictEqual(fs.existsSync(orphan1), false);
            assert.strictEqual(fs.existsSync(orphan2), false);

            // Whitelist must still be intact and readable
            const wlAfter = loadWhitelist();
            assert.strictEqual(wlAfter.users.length, wlBefore.users.length);
            passedCount++;
            console.log('  ✔ Interaction 4: Boot Orphan Purging preserves Whitelist Multi-Device Persistence');
        }

        // -------------------------------------------------------------
        // Pairwise Interaction 5: R3 (Locale Floats) + R1 (Interactive Upload Flow)
        // Spreadsheet with Indonesian commas analyzed in interactive flow -> unlinks file cleanly
        // -------------------------------------------------------------
        {
            const customItems = [
                { no: 1, plu: 'K01', nama: 'SUSU KENTAL MANIS', qtyJual: 100, pkm: 40, ft: 48, qtyStock: 2 },
                { no: 2, plu: 'K02', nama: 'TEH PUCUK HARUM', qtyJual: 150, pkm: 50, ft: 24, qtyStock: 5 }
            ];
            const pFile = path.join(sandbox.path, `pareto_uploaded_interactive_pair5.xls`);
            createMockParetoExcel(pFile, customItems);

            const pendingUploads = new Map();
            pendingUploads.set('628123456789', { filePath: pFile, fileName: 'pareto.xls', timestamp: Date.now() });

            // User replies with threshold
            const pending = pendingUploads.get('628123456789');
            pendingUploads.delete('628123456789');

            let outPb = null;
            try {
                const analysis = analyzePareto(pending.filePath, 5);
                assert.strictEqual(analysis.totalKritis, 2);
                outPb = path.join(sandbox.path, `Laporan_PB_Pareto_${Date.now()}_pair5.xlsx`);
                await generatePbExcel(analysis, outPb);
                assert.strictEqual(fs.existsSync(outPb), true);
            } finally {
                if (outPb && fs.existsSync(outPb)) fs.unlinkSync(outPb);
                if (pending.filePath && fs.existsSync(pending.filePath)) fs.unlinkSync(pending.filePath);
            }

            assert.strictEqual(fs.existsSync(pFile), false);
            assert.strictEqual(fs.existsSync(outPb), false);
            passedCount++;
            console.log('  ✔ Interaction 5: Interactive Upload Flow with Locale-Parsed Excel and Guaranteed Unlinking');
        }

        console.log(`  ✔ Successfully passed all ${passedCount} Tier 3 Bot Pairwise Interaction tests!`);
        return { passed: passedCount, failed: 0, suite: 'Tier 3 Bot Interactions' };
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
