import assert from 'assert';
import path from 'path';
import { parsePosJournal, getActiveOrLatestShift, calculateVariance, formatVarianceMessage, parseNominal } from '../../struk_parser.js';

console.log('🧪 Running Test Feat 20: Cashier Drawer Cash Variance & Pre-Closing Audit...');

// Test 1: parseNominal with various cashier inputs
assert.strictEqual(parseNominal('1550000'), 1550000, 'Direct number string');
assert.strictEqual(parseNominal('1.550.000'), 1550000, 'Indonesian thousand separator string');
assert.strictEqual(parseNominal('Rp 1.550.000'), 1550000, 'Currency prefix string');
assert.strictEqual(parseNominal('Rp. 1.550.000,-'), 1550000, 'Complex currency format string');
console.log('  ✅ Nominal formatting parser handles all realistic cashier inputs!');

// Test 2: Calculate Variance logic (Lebih, Kurang, Pas)
const target = 1540000;

// Skenario 1: Kas Lebih (Surplus)
const varLebih = calculateVariance(target, 1550000);
assert.strictEqual(varLebih.selisih, 10000, 'Selisih harus +10.000');
assert.strictEqual(varLebih.status, 'LEBIH', 'Status harus LEBIH');
assert.ok(varLebih.formattedVariance.includes('+Rp 10.000 (Lebih)'), 'Format string lebih');

// Skenario 2: Kas Kurang (Minus / Tekor)
const varKurang = calculateVariance(target, 1530000);
assert.strictEqual(varKurang.selisih, -10000, 'Selisih harus -10.000');
assert.strictEqual(varKurang.status, 'KURANG', 'Status harus KURANG');
assert.ok(varKurang.formattedVariance.includes('-Rp 10.000 (Kurang)'), 'Format string kurang');

// Skenario 3: Kas Pas / Klop
const varPas = calculateVariance(target, 1540000);
assert.strictEqual(varPas.selisih, 0, 'Selisih harus 0');
assert.strictEqual(varPas.status, 'PAS', 'Status harus PAS');
assert.ok(varPas.formattedVariance.includes('Rp 0 (Pas / Balance)'), 'Format string balance');
console.log('  ✅ Variance calculation (Lebih, Kurang, Pas) verified 100% mathematically correct!');

// Test 3: Active Shift selection on real POS log
const sampleActivePath = path.resolve('struck/02-20260926.TXT');
const auditActive = parsePosJournal(sampleActivePath);
const activeShift = getActiveOrLatestShift(auditActive);

assert.ok(activeShift, 'Active shift must be detected');
assert.strictEqual(activeShift.shiftNum, '2', 'Shift 2 harus terdeteksi sebagai shift aktif');
assert.strictEqual(activeShift.kasirName.toUpperCase(), 'RAFFI', 'Nama kasir shift 2 harus RAFFI');
assert.strictEqual(activeShift.totalFisikLaci, 580400, 'Target kas fisik laci shift 2 harus Rp 580.400');
console.log('  ✅ Active shift detection correctly selected Shift 2 (RAFFI) with target Rp 580.400!');

// Test 4: Format Variance message
const msgLebih = formatVarianceMessage({
    shift: activeShift,
    kasFisikAktual: 590400,
    tanggal: auditActive.tanggal,
    station: auditActive.station
});

assert.ok(msgLebih.includes('HASIL REKONSILIASI VARIANCE KAS'), 'Header struk');
assert.ok(msgLebih.includes('Shift 2'), 'Shift label');
assert.ok(msgLebih.toUpperCase().includes('RAFFI'), 'Kasir label');
assert.ok(msgLebih.includes('Target Kas Sistem : Rp 580.400'), 'Target kas');
assert.ok(msgLebih.includes('Kas Fisik Laci    : Rp 590.400'), 'Kas fisik laci');
assert.ok(msgLebih.includes('Variance (Selisih): *+Rp 10.000 (Lebih)*'), 'Variance output');
console.log('  ✅ formatVarianceMessage produces clean, concise, cashier-friendly text!');

// Test 5: Closed log fallback to latest shift
const sampleClosedPath = path.resolve('struck/02-20260924.TXT');
const auditClosed = parsePosJournal(sampleClosedPath);
const latestClosedShift = getActiveOrLatestShift(auditClosed);

assert.ok(latestClosedShift, 'Latest closed shift must be detected');
assert.strictEqual(latestClosedShift.shiftNum, '2', 'Shift 2 harus terdeteksi sebagai shift terakhir');
console.log('  ✅ Closed journal fallback correctly selects the latest shift in the file!');

console.log('✅ test_feat20_variance_audit.js PASSED ALL CHECKS!\n');
