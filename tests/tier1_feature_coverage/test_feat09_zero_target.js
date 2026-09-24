import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import { createTestSandbox } from '../helpers/test_fixture_helper.js';
import { getStructuredTextRekap, generateRekapExcel } from '../../rekap_helper.js';

export async function runTests() {
    console.log('--- Running Tier 1: Feature 9 (R3.2 Zero Target Division Guard) ---');
    const sandbox = createTestSandbox('feat09_zero_tgt_');

    try {
        const sampleData = [
            { tanggal: '01/09/2026', spd: 4500000, std: 130, apc: 34000, avg_spd: 4500000, yccg: 10, total_rte: 5 },
            { tanggal: '02/09/2026', spd: 5000000, std: 140, apc: 35000, avg_spd: 4750000, yccg: 12, total_rte: 8 }
        ];

        // Test 9.1: getStructuredTextRekap with targetSPD = 0
        {
            const text = getStructuredTextRekap(sampleData, 0);
            assert.strictEqual(typeof text, 'string');
            assert.strictEqual(text.includes('NaN'), false, 'Case 9.1: Must not contain NaN');
            assert.strictEqual(text.includes('Infinity'), false, 'Case 9.1: Must not contain Infinity');
            console.log('  ✔ Case 9.1: getStructuredTextRekap with targetSPD = 0 eliminates NaN and Infinity');
        }

        // Test 9.2: getStructuredTextRekap with targetSPD = null or undefined
        {
            const textNull = getStructuredTextRekap(sampleData, null);
            const textUndef = getStructuredTextRekap(sampleData, undefined);
            assert.strictEqual(textNull.includes('NaN'), false);
            assert.strictEqual(textUndef.includes('NaN'), false);
            assert.strictEqual(textNull.includes('4.725.000'), true, 'Should use safe default 4,725,000');
            console.log('  ✔ Case 9.2: getStructuredTextRekap safely defaults null/undefined targetSPD to standard RAB');
        }

        // Test 9.3: generateRekapExcel with targetSPD = 0
        {
            const outPath = path.join(sandbox.path, 'rekap_zero_target.xlsx');
            generateRekapExcel(sampleData, outPath, 0);
            assert.strictEqual(fs.existsSync(outPath), true);

            // Read workbook and inspect numeric cells
            const wb = xlsx.readFile(outPath);
            const wsHarian = wb.Sheets['Data Penjualan Harian'];
            const jsonHarian = xlsx.utils.sheet_to_json(wsHarian, { header: 1 });
            
            for (let r = 5; r < jsonHarian.length; r++) {
                const row = jsonHarian[r];
                if (!row || row.length === 0) continue;
                for (const cell of row) {
                    assert.notStrictEqual(cell, 'Infinity', 'Cell must not be Infinity string');
                    assert.notStrictEqual(cell, 'NaN', 'Cell must not be NaN string');
                }
            }
            console.log('  ✔ Case 9.3: generateRekapExcel with targetSPD = 0 writes valid numeric cells without NaN/Infinity');
        }

        // Test 9.4: getStructuredTextRekap on empty dataList
        {
            const emptyText = getStructuredTextRekap([]);
            assert.strictEqual(typeof emptyText, 'string');
            assert.strictEqual(emptyText.includes('Belum ada data laporan'), true);
            console.log('  ✔ Case 9.4: getStructuredTextRekap cleanly handles empty data list');
        }

        // Test 9.5: Zero spd entries in dataList
        {
            const zeroSpdData = [
                { tanggal: '01/09/2026', spd: 0, std: 0, apc: 0, avg_spd: 0, yccg: 0, total_rte: 0 }
            ];
            const text = getStructuredTextRekap(zeroSpdData, 4725000);
            assert.strictEqual(text.includes('NaN'), false);
            assert.strictEqual(text.includes('0.00%'), true);

            const outPathZero = path.join(sandbox.path, 'rekap_zero_spd.xlsx');
            assert.doesNotThrow(() => {
                generateRekapExcel(zeroSpdData, outPathZero, 4725000);
            });
            console.log('  ✔ Case 9.5: Zero daily sales values handled safely without calculation errors');
        }

        return { passed: 5, failed: 0, feature: 'Feature 9 (R3.2 Zero Target Division Guard)' };
    } finally {
        sandbox.cleanup();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 9 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
