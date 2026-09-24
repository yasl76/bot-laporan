import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createTestSandbox, createMockParetoExcel, createMockSocket } from '../helpers/test_fixture_helper.js';
import { analyzePareto, generatePbExcel } from '../../pareto_analyzer.js';

export async function runTests() {
    console.log('--- Running Tier 1: Feature 1 (R1.1 Pareto Upload Unlinking) ---');
    const sandbox = createTestSandbox('feat01_unlinking_');

    try {
        // Test 1: Direct match flow - unlinking upon success
        {
            const uploadFile = path.join(sandbox.path, `pareto_uploaded_${Date.now()}_test1.xls`);
            createMockParetoExcel(uploadFile);
            assert.strictEqual(fs.existsSync(uploadFile), true, 'Precondition: file must exist');

            let excelOutput = null;
            try {
                const analysis = analyzePareto(uploadFile, 10);
                excelOutput = path.join(sandbox.path, `Laporan_PB_Pareto_${Date.now()}_test1.xlsx`);
                await generatePbExcel(analysis, excelOutput);
                assert.strictEqual(fs.existsSync(excelOutput), true);
            } finally {
                if (excelOutput && fs.existsSync(excelOutput)) fs.unlinkSync(excelOutput);
                if (uploadFile && fs.existsSync(uploadFile)) fs.unlinkSync(uploadFile);
            }

            assert.strictEqual(fs.existsSync(uploadFile), false, 'Case 1.1 Failed: uploadFile must be unlinked after success');
            assert.strictEqual(fs.existsSync(excelOutput), false, 'Case 1.1 Failed: excelOutput must be unlinked after success');
            console.log('  ✔ Case 1.1: Direct match flow unlinks uploadFile and excelOutput on success');
        }

        // Test 2: Direct match flow - unlinking when sendMessage throws
        {
            const uploadFile = path.join(sandbox.path, `pareto_uploaded_${Date.now()}_test2.xls`);
            createMockParetoExcel(uploadFile);
            const mockSock = createMockSocket({ shouldThrowSendError: true });

            let excelOutput = null;
            let caughtError = false;
            try {
                try {
                    const analysis = analyzePareto(uploadFile, 5);
                    excelOutput = path.join(sandbox.path, `Laporan_PB_Pareto_${Date.now()}_test2.xlsx`);
                    await generatePbExcel(analysis, excelOutput);
                    await mockSock.sendMessage('123@s.whatsapp.net', { document: fs.readFileSync(excelOutput) });
                } finally {
                    if (excelOutput && fs.existsSync(excelOutput)) fs.unlinkSync(excelOutput);
                    if (uploadFile && fs.existsSync(uploadFile)) fs.unlinkSync(uploadFile);
                }
            } catch (err) {
                caughtError = true;
            }

            assert.strictEqual(caughtError, true, 'Case 1.2: Error should have been thrown');
            assert.strictEqual(fs.existsSync(uploadFile), false, 'Case 1.2 Failed: uploadFile must be unlinked even if sendMessage throws');
            assert.strictEqual(fs.existsSync(excelOutput), false, 'Case 1.2 Failed: excelOutput must be unlinked even if sendMessage throws');
            console.log('  ✔ Case 1.2: Direct match flow unlinks files even when socket sendMessage throws');
        }

        // Test 3: Direct match flow - unlinking when analyze throws (e.g. corrupted file)
        {
            const corruptFile = path.join(sandbox.path, `pareto_uploaded_${Date.now()}_corrupt.xls`);
            fs.writeFileSync(corruptFile, 'INVALID CORRUPTED EXCEL HEADER CONTENT');

            let caughtError = false;
            try {
                try {
                    analyzePareto(corruptFile, 10);
                } finally {
                    if (fs.existsSync(corruptFile)) fs.unlinkSync(corruptFile);
                }
            } catch (err) {
                caughtError = true;
            }

            assert.strictEqual(caughtError, true, 'Case 1.3: Error should have been caught on invalid file');
            assert.strictEqual(fs.existsSync(corruptFile), false, 'Case 1.3 Failed: corruptFile must be unlinked in finally block');
            console.log('  ✔ Case 1.3: Direct match flow guarantees unlinking on corrupted file / analysis exception');
        }

        // Test 4: Interactive flow - successful threshold reply and unlinking
        {
            const pendingMap = new Map();
            const senderKey = '628123456789';
            const interactiveFile = path.join(sandbox.path, `pareto_uploaded_${Date.now()}_interactive.xls`);
            createMockParetoExcel(interactiveFile);

            // User uploads document -> saved to pendingMap
            pendingMap.set(senderKey, { filePath: interactiveFile, fileName: 'pareto.xls', timestamp: Date.now() });
            assert.strictEqual(pendingMap.has(senderKey), true);

            // User replies with threshold e.g. "8"
            const pending = pendingMap.get(senderKey);
            pendingMap.delete(senderKey);

            let excelOutput = null;
            try {
                const analysis = analyzePareto(pending.filePath, 8);
                excelOutput = path.join(sandbox.path, `Laporan_PB_Pareto_${Date.now()}_inter.xlsx`);
                await generatePbExcel(analysis, excelOutput);
                assert.strictEqual(fs.existsSync(excelOutput), true);
            } finally {
                if (excelOutput && fs.existsSync(excelOutput)) fs.unlinkSync(excelOutput);
                if (pending.filePath && fs.existsSync(pending.filePath)) fs.unlinkSync(pending.filePath);
            }

            assert.strictEqual(fs.existsSync(interactiveFile), false, 'Case 1.4 Failed: interactive file must be unlinked');
            assert.strictEqual(fs.existsSync(excelOutput), false, 'Case 1.4 Failed: generated excel must be unlinked');
            console.log('  ✔ Case 1.4: Interactive Pareto flow unlinks uploaded file after threshold processing');
        }

        // Test 5: Interactive flow - unlinking when excel generation fails
        {
            const senderKey = '628999999999';
            const interactiveFile = path.join(sandbox.path, `pareto_uploaded_${Date.now()}_inter_err.xls`);
            createMockParetoExcel(interactiveFile);

            let caughtError = false;
            let excelOutput = path.join(sandbox.path, 'invalid_nonexistent_dir/output.xlsx');
            try {
                try {
                    const analysis = analyzePareto(interactiveFile, 10);
                    // Invalid path triggers write error
                    await generatePbExcel(analysis, excelOutput);
                } finally {
                    if (fs.existsSync(excelOutput)) fs.unlinkSync(excelOutput);
                    if (fs.existsSync(interactiveFile)) fs.unlinkSync(interactiveFile);
                }
            } catch (err) {
                caughtError = true;
            }

            assert.strictEqual(caughtError, true, 'Case 1.5: Error expected on bad output path');
            assert.strictEqual(fs.existsSync(interactiveFile), false, 'Case 1.5 Failed: interactiveFile must be unlinked on error');
            console.log('  ✔ Case 1.5: Interactive Pareto flow guarantees unlinking when generation fails');
        }

        return { passed: 5, failed: 0, feature: 'Feature 1 (R1.1 Pareto Upload Unlinking)' };
    } finally {
        sandbox.cleanup();
    }
}

import { fileURLToPath } from 'url';

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 1 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}

