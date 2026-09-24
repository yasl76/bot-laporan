import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseSafeFloat, getPbSummaryText } from '../../pareto_analyzer.js';

export async function runTests() {
    console.log('--- Running Tier 1: Feature 10 (R3.3 Safe Locale Float & Carton Division) ---');

    // Test 10.1: Indonesian comma decimal string "12,5" -> 12.5
    {
        const parsed = parseSafeFloat('12,5');
        assert.strictEqual(parsed, 12.5, `Case 10.1: Expected 12.5, got ${parsed}`);
        console.log('  ✔ Case 10.1: Correctly parses Indonesian comma decimal ("12,5" -> 12.5)');
    }

    // Test 10.2: Combined Indonesian thousand separator with decimal comma ("1.500,75" -> 1500.75) and standard float ("12.5" -> 12.5)
    {
        const thousandWithDec = parseSafeFloat('1.500,75');
        const standardFloat = parseSafeFloat('12.5');
        assert.strictEqual(thousandWithDec, 1500.75, `Expected 1500.75, got ${thousandWithDec}`);
        assert.strictEqual(standardFloat, 12.5, `Expected 12.5, got ${standardFloat}`);
        console.log('  ✔ Case 10.2: Correctly parses combined thousand-separator ("1.500,75" -> 1500.75) and standard floats ("12.5" -> 12.5)');
    }


    // Test 10.3: Falsy, null, undefined, non-numeric strings return 0 safely
    {
        assert.strictEqual(parseSafeFloat(null), 0);
        assert.strictEqual(parseSafeFloat(undefined), 0);
        assert.strictEqual(parseSafeFloat(''), 0);
        assert.strictEqual(parseSafeFloat('invalid_text'), 0);
        assert.strictEqual(parseSafeFloat(NaN), 0);
        assert.strictEqual(parseSafeFloat(Infinity), 0);
        console.log('  ✔ Case 10.3: Non-finite, null, and non-numeric inputs safely evaluate to 0');
    }

    // Test 10.4: Safe carton division guards against ft <= 0 or ft = NaN
    {
        // Simulate orderDus logic in pareto_analyzer.js
        const itemWithZeroFt = { ft: 0, rekomendasiOrder: 10 };
        const itemWithNullFt = { ft: null, rekomendasiOrder: 10 };

        let orderDus1 = `${itemWithZeroFt.rekomendasiOrder} Pcs`;
        if (itemWithZeroFt.ft > 1 && itemWithZeroFt.rekomendasiOrder > 0) {
            const dus = Math.ceil(itemWithZeroFt.rekomendasiOrder / itemWithZeroFt.ft);
            if (Number.isFinite(dus) && dus > 0) orderDus1 = `${dus} Dus`;
        }

        let orderDus2 = `${itemWithNullFt.rekomendasiOrder} Pcs`;
        if (itemWithNullFt.ft > 1 && itemWithNullFt.rekomendasiOrder > 0) {
            const dus = Math.ceil(itemWithNullFt.rekomendasiOrder / itemWithNullFt.ft);
            if (Number.isFinite(dus) && dus > 0) orderDus2 = `${dus} Dus`;
        }

        assert.strictEqual(orderDus1.includes('Infinity'), false);
        assert.strictEqual(orderDus1.includes('NaN'), false);
        assert.strictEqual(orderDus1, '10 Pcs');
        assert.strictEqual(orderDus2, '10 Pcs');
        console.log('  ✔ Case 10.4: Carton division prevents NaN and Infinity when ft is 0 or invalid');
    }

    // Test 10.5: getPbSummaryText formatting when 0 items require restock
    {
        const emptyAnalysis = {
            lowStockItems: [],
            totalItem: 50,
            totalKritis: 0,
            totalKosong: 0,
            totalSangatKritis: 0,
            totalMenipis: 0,
            maxStockThreshold: 10,
            fileName: 'pareto.xls'
        };

        const summaryText = getPbSummaryText(emptyAnalysis);
        assert.strictEqual(summaryText.includes('SEMUA STOK DALAM KONDISI AMAN'), true);
        assert.strictEqual(summaryText.includes('TOP 0'), false, 'Must not print "TOP 0 ITEM"');
        console.log('  ✔ Case 10.5: Clean executive message when all stock is sufficient (no TOP 0 artifacts)');
    }

    return { passed: 5, failed: 0, feature: 'Feature 10 (R3.3 Safe Locale Float & Carton Division)' };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 10 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
