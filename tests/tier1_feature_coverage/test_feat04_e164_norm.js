import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeNumber } from '../../whitelist_helper.js';

export async function runTests() {
    console.log('--- Running Tier 1: Feature 4 (R2.1 E.164 Number Normalization) ---');

    // Test 4.1: Convert local format 08xxx to 628xxx
    {
        const input = '08123456789';
        const expected = '628123456789';
        const actual = normalizeNumber(input);
        assert.strictEqual(actual, expected, `Case 4.1 Failed: expected ${expected}, got ${actual}`);
        console.log('  ✔ Case 4.1: Converts local format 08xxx to 628xxx');
    }

    // Test 4.2: Strips spaces, dashes, plus signs, brackets
    {
        const input = '+62 (812) 3456-7890';
        const expected = '6281234567890';
        const actual = normalizeNumber(input);
        assert.strictEqual(actual, expected, `Case 4.2 Failed: expected ${expected}, got ${actual}`);
        console.log('  ✔ Case 4.2: Strips non-digit characters and formatting punctuation');
    }

    // Test 4.3: Strips WhatsApp JID suffixes (@s.whatsapp.net, @lid, :device)
    {
        const jidUser = '628123456789:2@s.whatsapp.net';
        const jidLid = '215633832722432:0@lid';
        assert.strictEqual(normalizeNumber(jidUser), '628123456789');
        assert.strictEqual(normalizeNumber(jidLid), '215633832722432');
        console.log('  ✔ Case 4.3: Strips WhatsApp @s.whatsapp.net, @lid, and device identifiers');
    }

    // Test 4.4: Idempotent on already normalized international number
    {
        const input = '6285852559058';
        const actual = normalizeNumber(input);
        assert.strictEqual(actual, input, `Case 4.4 Failed: expected ${input}, got ${actual}`);
        console.log('  ✔ Case 4.4: Normalization is idempotent on existing E.164 numbers');
    }

    // Test 4.5: Falsy and empty input guardrails
    {
        assert.strictEqual(normalizeNumber(null), '', 'null should return empty string');
        assert.strictEqual(normalizeNumber(undefined), '', 'undefined should return empty string');
        assert.strictEqual(normalizeNumber(''), '', 'empty string should return empty string');
        console.log('  ✔ Case 4.5: Falsy and empty inputs safely return empty string without error');
    }

    return { passed: 5, failed: 0, feature: 'Feature 4 (R2.1 E.164 Number Normalization)' };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    runTests().then(res => console.log('Feature 4 result:', res)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
