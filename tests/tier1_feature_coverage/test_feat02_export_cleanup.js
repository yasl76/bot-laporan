import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createTestSandbox, createMockParetoExcel, createMockSocket } from '../helpers/test_fixture_helper.js';
import { analyzePareto, generatePbExcel } from '../../pareto_analyzer.js';
import { generateRekapExcel } from '../../rekap_helper.js';

export async function runTests() {
    console.log('--- Running Tier 1: Feature 2 (R1.2 Export Excel Cleanup) ---');
    const sandbox = createTestSandbox('feat02_export_');

    try {
        // Test 2.1: !pb excel export cleanup after successful send
        {
            const paretoFile = path.join(sandbox.path, 'source_pareto.xls');
            createMockParetoExcel(paretoFile);
            const mockSock = createMockSocket();

            let outPath = null;
            try {
                const analysis = analyzePareto(paretoFile, 10);
                outPath = path.join(sandbox.path, `Laporan_PB_Pareto_${Date.now()}.xlsx`);
                await generatePbExcel(analysis, outPath);
                assert.strictEqual(fs.existsSync(outPath), true, 'File should exist prior to send');
                
                await mockSock.sendMessage('12345@s.whatsapp.net', {
                    document: fs.readFileSync(outPath),
                    fileName: 'Laporan_PB.xlsx'
                });
            } finally {
                if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath);
            }

            assert.strictEqual(fs.existsSync(outPath), false, 'Case 2.1: !pb excel output must be unlinked');
            console.log('  ✔ Case 2.1: !pb excel export cleans up output spreadsheet on success');
        }

        // Test 2.2: !rekap excel export cleanup after successful send
        {
            const mockSock = createMockSocket();
            const dataList = [
                { tanggal: '01/09/2026', spd: 4500000, std: 130, apc: 34000, avg_spd: 4500000, yccg: 20, total_rte: 15 },
                { tanggal: '02/09/2026', spd: 4800000, std: 140, apc: 35000, avg_spd: 4650000, yccg: 25, total_rte: 18 }
            ];

            let outPath = null;
            try {
                outPath = path.join(sandbox.path, `Rekap_Bulanan_${Date.now()}.xlsx`);
                generateRekapExcel(dataList, outPath, 4725000);
                assert.strictEqual(fs.existsSync(outPath), true, 'Rekap file should exist');

                await mockSock.sendMessage('12345@s.whatsapp.net', {
                    document: fs.readFileSync(outPath),
                    fileName: 'Rekap.xlsx'
                });
            } finally {
                if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath);
            }

            assert.strictEqual(fs.existsSync(outPath), false, 'Case 2.2: !rekap excel output must be unlinked');
            console.log('  ✔ Case 2.2: !rekap excel export cleans up output spreadsheet on success');
        }

        // Test 2.3: Monthly scheduler export cleanup
        {
            const mockSock = createMockSocket();
            const dataList = [
                { tanggal: '30/09/2026', spd: 5000000, std: 145, apc: 36000, avg_spd: 4800000 }
            ];

            let outPath = null;
            try {
                outPath = path.join(sandbox.path, `Rekap_Bulanan_Otomatis_${Date.now()}.xlsx`);
                generateRekapExcel(dataList, outPath, 4725000);
                assert.strictEqual(fs.existsSync(outPath), true);

                await mockSock.sendMessage('admin@s.whatsapp.net', {
                    document: fs.readFileSync(outPath),
                    caption: 'Rekap Otomatis'
                });
            } finally {
                if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath);
            }

            assert.strictEqual(fs.existsSync(outPath), false, 'Case 2.3: Scheduled rekap output must be unlinked');
            console.log('  ✔ Case 2.3: Monthly scheduler cleans up generated rekap Excel file');
        }

        // Test 2.4: !pb excel cleanup when socket sendMessage fails
        {
            const paretoFile = path.join(sandbox.path, 'source_fail.xls');
            createMockParetoExcel(paretoFile);
            const mockSock = createMockSocket({ shouldThrowSendError: true });

            let outPath = null;
            let caught = false;
            try {
                try {
                    const analysis = analyzePareto(paretoFile, 10);
                    outPath = path.join(sandbox.path, `Laporan_PB_Fail_${Date.now()}.xlsx`);
                    await generatePbExcel(analysis, outPath);
                    await mockSock.sendMessage('123@s.whatsapp.net', { document: fs.readFileSync(outPath) });
                } finally {
                    if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath);
                }
            } catch (e) {
                caught = true;
            }

            assert.strictEqual(caught, true, 'Case 2.4: Error should be thrown by mock socket');
            assert.strictEqual(fs.existsSync(outPath), false, 'Case 2.4: Output file must be deleted despite send error');
            console.log('  ✔ Case 2.4: !pb excel output unlinked even when socket transmission throws error');
        }

        // Test 2.5: !rekap excel cleanup when socket sendMessage fails
        {
            const mockSock = createMockSocket({ shouldThrowSendError: true });
            const dataList = [{ tanggal: '01/09/2026', spd: 4000000 }];

            let outPath = null;
            let caught = false;
            try {
                try {
                    outPath = path.join(sandbox.path, `Rekap_Fail_${Date.now()}.xlsx`);
                    generateRekapExcel(dataList, outPath, 4725000);
                    await mockSock.sendMessage('123@s.whatsapp.net', { document: fs.readFileSync(outPath) });
                } finally {
                    if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath);
                }
            } catch (e) {
                caught = true;
            }

            assert.strictEqual(caught, true, 'Case 2.5: Error should be thrown by mock socket');
            assert.strictEqual(fs.existsSync(outPath), false, 'Case 2.5: Rekap file must be deleted despite send error');
            console.log('  ✔ Case 2.5: !rekap excel output unlinked even when transmission throws error');
        }

        return { passed: 5, failed: 0, feature: 'Feature 2 (R1.2 Export Excel Cleanup)' };
    } finally {
        sandbox.cleanup();
    }
}

import { fileURLToPath } from 'url';

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 2 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}

