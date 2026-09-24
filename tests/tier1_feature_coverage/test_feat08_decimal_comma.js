import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTestSandbox } from '../helpers/test_fixture_helper.js';
import { loadConfig, updateConfig } from '../../config_helper.js';

/**
 * Standard parser for !setrab arguments adhering to PROJECT.md R3.1 specification
 */
export function parseAndValidateSetrab(commandArgs) {
    // Expected format: !setrab [target_spd] [target_std] [target_apc] [target_gm]
    const parts = commandArgs.trim().split(/\s+/);
    if (parts.length < 4) {
        return { valid: false, error: 'Argumen tidak lengkap' };
    }

    const spd = parseFloat(parts[0].replace(/[^0-9.-]/g, ''));
    const std = parseInt(parts[1].replace(/[^0-9.-]/g, ''));
    const apc = parseFloat(parts[2].replace(/[^0-9.-]/g, ''));

    
    // Normalization for GM%: handles '21,00' -> '21.00', '21.5%' -> '21.5'
    const rawGm = parts[3].replace(/%/g, '').replace(/,/g, '.').trim();
    const gmNum = parseFloat(rawGm);

    if (!spd || spd <= 0 || !std || std <= 0 || !apc || apc <= 0 || isNaN(gmNum) || gmNum <= 0) {
        return { valid: false, error: 'Nilai angka target RAB tidak valid' };
    }

    return {
        valid: true,
        data: {
            target_spd: spd,
            target_std: std,
            target_apc: apc,
            target_gm: rawGm
        }
    };
}

export async function runTests() {
    console.log('--- Running Tier 1: Feature 8 (R3.1 Decimal Comma Normalization) ---');
    const sandbox = createTestSandbox('feat08_comma_');
    const origCwd = process.cwd();

    try {
        process.chdir(sandbox.path);

        // Test 8.1: Dot decimal notation
        {
            const parsed = parseAndValidateSetrab('4725000 135 35000 21.00');
            assert.strictEqual(parsed.valid, true);
            assert.strictEqual(parsed.data.target_gm, '21.00');
            const cfg = updateConfig(parsed.data);
            assert.strictEqual(cfg.target_gm, '21.00');
            console.log('  ✔ Case 8.1: Correctly parses and stores standard dot decimal (21.00)');
        }

        // Test 8.2: Comma decimal notation (Indonesian locale)
        {
            const parsed = parseAndValidateSetrab('4725000 135 35000 21,00');
            assert.strictEqual(parsed.valid, true);
            assert.strictEqual(parsed.data.target_gm, '21.00');
            const cfg = updateConfig(parsed.data);
            assert.strictEqual(cfg.target_gm, '21.00');
            console.log('  ✔ Case 8.2: Correctly normalizes comma decimal representation (21,00 -> 21.00)');
        }

        // Test 8.3: Percentage symbol with comma decimal notation
        {
            const parsed = parseAndValidateSetrab('5000000 140 36000 22,75%');
            assert.strictEqual(parsed.valid, true);
            assert.strictEqual(parsed.data.target_gm, '22.75');
            console.log('  ✔ Case 8.3: Normalizes decimal comma with attached percentage sign (22,75% -> 22.75)');
        }

        // Test 8.4: Rejects non-numeric GM% input
        {
            const parsed = parseAndValidateSetrab('4725000 135 35000 abc');
            assert.strictEqual(parsed.valid, false);
            console.log('  ✔ Case 8.4: Rejects non-numeric alphabetic inputs');
        }

        // Test 8.5: Rejects zero and negative GM% input
        {
            const parsedZero = parseAndValidateSetrab('4725000 135 35000 0');
            const parsedNeg = parseAndValidateSetrab('4725000 135 35000 -5');
            assert.strictEqual(parsedZero.valid, false);
            assert.strictEqual(parsedNeg.valid, false);
            console.log('  ✔ Case 8.5: Rejects non-positive (zero or negative) target percentages');
        }

        return { passed: 5, failed: 0, feature: 'Feature 8 (R3.1 Decimal Comma Normalization)' };
    } finally {
        process.chdir(origCwd);
        sandbox.cleanup();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 8 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
