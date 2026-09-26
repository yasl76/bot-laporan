import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { parsePosJournal, formatPosAuditMessage, parseNominal } from '../../struk_parser.js';

console.log('🧪 Running Test Feat 19: POS Cashier Journal Parser & Pre-Closing Audit...');

// Test 1: Helper parseNominal
assert.strictEqual(parseNominal('1.054.550'), 1054550, 'parseNominal with dots');
assert.strictEqual(parseNominal('Rp. 350.000'), 350000, 'parseNominal with currency prefix');
assert.strictEqual(parseNominal('0'), 0, 'parseNominal 0');
assert.strictEqual(parseNominal(null), 0, 'parseNominal null');

const file24 = path.resolve('struck', '02-20260924.TXT');
const file26 = path.resolve('struck', '02-20260926.TXT');

// Test 2: Parse 02-20260924.TXT (Completed Day with 2 Closed Shifts)
if (fs.existsSync(file24)) {
    const res24 = parsePosJournal(file24);
    assert.strictEqual(res24.shiftCount, 2, 'Must detect 2 shifts in 02-20260924.TXT');
    
    // Shift 1
    const s1 = res24.shifts[0];
    assert.strictEqual(s1.shiftNum, '1');
    assert.strictEqual(s1.kasirId, 'RAN');
    assert.strictEqual(s1.isClosed, true, 'Shift 1 must be closed');
    assert.strictEqual(s1.tunaiNet, 982250, 'Shift 1 tunaiNet must match slip (982,250)');
    assert.strictEqual(s1.emoney, 687750, 'Shift 1 emoney must match slip (687,750)');
    assert.strictEqual(s1.credit, 319000, 'Shift 1 credit card must match slip (319,000)');
    assert.strictEqual(s1.debit, 0, 'Shift 1 debit must match slip (0)');
    assert.strictEqual(s1.totalFisikLaci, s1.cashAwal + s1.tunaiNet, 'Laci must be cashAwal + tunaiNet');

    // Shift 2
    const s2 = res24.shifts[1];
    assert.strictEqual(s2.shiftNum, '2');
    assert.strictEqual(s2.kasirId, 'GII');
    assert.strictEqual(s2.isClosed, true, 'Shift 2 must be closed');
    assert.strictEqual(s2.tunaiNet, 1349550, 'Shift 2 tunaiNet must match slip (1,349,550)');
    assert.strictEqual(s2.emoney, 1163750, 'Shift 2 emoney must match slip (1,163,750)');
    assert.strictEqual(s2.debit, 163500, 'Shift 2 debit must match slip (163,500)');
    assert.strictEqual(s2.credit, 217000, 'Shift 2 credit must match slip (217,000)');
    assert.strictEqual(s2.voucher, 5000, 'Shift 2 voucher must be 5,000');

    // Grand Total
    assert.strictEqual(res24.grandTotal.totalTunaiNet, 982250 + 1349550);
    assert.strictEqual(res24.grandTotal.totalEmoney, 687750 + 1163750);
    console.log('  ✅ 02-20260924.TXT parsed with 100% precision matching official POS slips!');
}

// Test 3: Parse 02-20260926.TXT (Live Day with Active Shift 2 - Raffi)
if (fs.existsSync(file26)) {
    const res26 = parsePosJournal(file26);
    assert.strictEqual(res26.shiftCount, 2, 'Must detect 2 shifts in 02-20260926.TXT');
    
    const s2 = res26.shifts[1];
    assert.strictEqual(s2.shiftNum, '2');
    assert.strictEqual(s2.kasirId, 'RAF');
    assert.strictEqual(s2.isClosed, false, 'Shift 2 must be ACTIVE (not closed yet)');
    assert.strictEqual(s2.status, 'ACTIVE');
    assert.strictEqual(s2.cashAwal, 350000, 'Cash awal shift 2 is 350,000');
    assert.strictEqual(s2.tunaiNet, 230400, 'Live tunai net is 230,400');
    assert.strictEqual(s2.totalFisikLaci, 580400, 'Live physical cash required is 580,400');
    assert.strictEqual(s2.credit, 120000, 'Credit card is 120,000');
    assert.strictEqual(s2.emoney, 444450, 'E-Money is 444,450');

    // Format message test
    const msg = formatPosAuditMessage(res26);
    assert.ok(msg.includes('AUDIT KAS & JURNAL STRUK KASIR'), 'Must have header');
    assert.ok(msg.includes('SEDANG BERJALAN (Shift Aktif)'), 'Must indicate active shift');
    assert.ok(msg.includes('580.400'), 'Must show required drawer physical cash');
    assert.ok(msg.includes('PANDUAN PRA-CLOSING'), 'Must provide guidance for cashier');
    console.log('  ✅ 02-20260926.TXT active shift correctly audited with guidance!');
}

console.log('✅ test_feat19_struk_parser.js PASSED ALL CHECKS!\n');
