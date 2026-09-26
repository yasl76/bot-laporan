import fs from 'fs';
import path from 'path';
import { formatRp, parseNominal } from './src/formatters.js';
export { parseNominal };


/**
 * Mem-parse isi file jurnal kasir POS OMI (misal 02-20260926.TXT)
 * @param {string} contentOrPath - Teks log jurnal atau path ke file .TXT
 * @returns {object} Hasil analisa per-shift dan total harian
 */
export function parsePosJournal(contentOrPath) {
    let text = '';
    let fileName = 'Jurnal POS';

    if (fs.existsSync(contentOrPath)) {
        text = fs.readFileSync(contentOrPath, 'latin1');
        fileName = path.basename(contentOrPath);
    } else {
        text = String(contentOrPath);
    }

    // Deteksi inisialisasi shift
    const shiftMatches = listShiftMatches(text);
    if (shiftMatches.length === 0) {
        throw new Error('Format file tidak dikenali sebagai log jurnal kasir POS OMI (tidak ditemukan blok INISIALISASI).');
    }

    const shifts = [];

    for (let idx = 0; idx < shiftMatches.length; idx++) {
        const sm = shiftMatches[idx];
        const station = sm.station;
        const tanggal = sm.tanggal;
        const shiftNum = sm.shiftNum;
        const jamMulai = sm.jamMulai;
        const kasirId = sm.kasirId;
        const kasirName = sm.kasirName;
        const cashAwal = sm.cashAwal;

        const startIdx = sm.endPos;
        const endIdx = idx + 1 < shiftMatches.length ? shiftMatches[idx + 1].startPos : text.length;
        const shiftBody = text.slice(startIdx, endIdx);

        const hasSlip = shiftBody.includes('=========== SLIP PENJUALAN =============');
        const bodyToCalc = hasSlip ? shiftBody.split('=========== SLIP PENJUALAN =============')[0] : shiftBody;

        // Hitung transaksi struk di shift ini
        const txMatches = [...bodyToCalc.matchAll(/----------------------------------------\s*\n\s*:\s*[\d/]+:[\d:]+\s*O8BM\/\d+\/\d+\/[^\s\n]+/g)];
        const totalStruk = txMatches.length;

        // 1. Tunai (Net Cash = Total Bayar Tunai - Total Kembali)
        const tunaiMatches = [...bodyToCalc.matchAll(/PEMBAYARAN TUNAI\s*:\s*([\d.]+)/g)];
        const kembaliMatches = [...bodyToCalc.matchAll(/KEMBALI\s*(?:\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.)?\s*:\s*([\d.]+)/g)];
        const totalBayarTunai = tunaiMatches.reduce((acc, m) => acc + parseNominal(m[1]), 0);
        const totalKembali = kembaliMatches.reduce((acc, m) => acc + parseNominal(m[1]), 0);
        const tunaiNet = totalBayarTunai - totalKembali;

        // 2. E-Money / QRIS
        const emoneyMatches = [...bodyToCalc.matchAll(/PEMBAYARAN E-MONEY\s*:\s*([\d.]+)/g)];
        const emoney = emoneyMatches.reduce((acc, m) => acc + parseNominal(m[1]), 0);

        // 3. Debit Card (DC.xxxx-xxxx-xxxx-xxxx)
        const debitMatches = [...bodyToCalc.matchAll(/DC\.[\d-]+\s*:\s*([\d.]+)/g)];
        const debit = debitMatches.reduce((acc, m) => acc + parseNominal(m[1]), 0);

        // 4. Credit Card (CC.xxxx-xxxx-xxxx-xxxx)
        const creditMatches = [...bodyToCalc.matchAll(/CC\.[\d-]+\s*:\s*([\d.]+)/g)];
        const credit = creditMatches.reduce((acc, m) => acc + parseNominal(m[1]), 0);

        // 5. Voucher
        const voucherMatches = [...bodyToCalc.matchAll(/PEMBAYARAN VOUCHER\s*:\s*([\d.]+)/g)];
        const voucher = voucherMatches.reduce((acc, m) => acc + parseNominal(m[1]), 0);

        // 6. Piutang Karyawan / Kredit Anggota
        const kreditMatches = [...bodyToCalc.matchAll(/PEMBAYARAN KREDIT\s*:\s*([\d.]+)/g)];
        const kreditAnggota = kreditMatches.reduce((acc, m) => acc + parseNominal(m[1]), 0);

        // Total omset penjualan shift
        const totalPenjualan = tunaiNet + emoney + debit + credit + voucher + kreditAnggota;
        const totalFisikLaci = cashAwal + tunaiNet;

        // Ambil data resmi dari Slip Penjualan jika shift sudah closing
        let slipData = null;
        if (hasSlip) {
            const slipPart = shiftBody.split('=========== SLIP PENJUALAN =============')[1] || '';
            const mSlipClosing = slipPart.match(/Tgl Closing\s*:\s*([^\n]+)/);
            const mSlipTunai = slipPart.match(/-\s*Tunai\s+([\d.]+)/);
            const mSlipEmoney = slipPart.match(/-\s*E-Money\s+([\d.]+)/);
            const mSlipDebit = slipPart.match(/-\s*Debit Card\s+([\d.]+)/);
            const mSlipCredit = slipPart.match(/-\s*Credit Card\s+([\d.]+)/);
            const mSlipKasAktual = slipPart.match(/-\s*Kas Aktual\s+([\d.]+)/);
            const mSlipVariance = slipPart.match(/VARIANCE\s+([\d.]+)/);
            const mSlipTotalStruk = slipPart.match(/TOTAL STRUK\s+([\d]+)/);

            slipData = {
                tglClosing: mSlipClosing ? mSlipClosing[1].trim() : '',
                tunai: mSlipTunai ? parseNominal(mSlipTunai[1]) : 0,
                emoney: mSlipEmoney ? parseNominal(mSlipEmoney[1]) : 0,
                debit: mSlipDebit ? parseNominal(mSlipDebit[1]) : 0,
                credit: mSlipCredit ? parseNominal(mSlipCredit[1]) : 0,
                kasAktual: mSlipKasAktual ? parseNominal(mSlipKasAktual[1]) : 0,
                variance: mSlipVariance ? parseNominal(mSlipVariance[1]) : 0,
                totalStruk: mSlipTotalStruk ? parseInt(mSlipTotalStruk[1], 10) : totalStruk
            };
        }

        shifts.push({
            station,
            tanggal,
            shiftNum,
            jamMulai,
            kasirId,
            kasirName,
            cashAwal,
            isClosed: hasSlip,
            status: hasSlip ? 'CLOSED' : 'ACTIVE',
            totalStruk: slipData ? slipData.totalStruk : totalStruk,
            tunaiNet,
            emoney,
            debit,
            credit,
            voucher,
            kreditAnggota,
            totalPenjualan,
            totalFisikLaci,
            slipData
        });
    }

    // Hitung Grand Total harian
    const grandTotal = {
        totalPenjualan: shifts.reduce((acc, s) => acc + s.totalPenjualan, 0),
        totalTunaiNet: shifts.reduce((acc, s) => acc + s.tunaiNet, 0),
        totalEmoney: shifts.reduce((acc, s) => acc + s.emoney, 0),
        totalDebit: shifts.reduce((acc, s) => acc + s.debit, 0),
        totalCredit: shifts.reduce((acc, s) => acc + s.credit, 0),
        totalVoucher: shifts.reduce((acc, s) => acc + s.voucher, 0),
        totalKreditAnggota: shifts.reduce((acc, s) => acc + s.kreditAnggota, 0),
        totalStruk: shifts.reduce((acc, s) => acc + s.totalStruk, 0)
    };

    return {
        fileName,
        tanggal: shifts[0]?.tanggal || '',
        station: shifts[0]?.station || '02',
        shiftCount: shifts.length,
        shifts,
        grandTotal
    };
}

/**
 * Mencari semua inisialisasi shift di dalam log teks
 */
function listShiftMatches(text) {
    const regex = /Station\s*:\s*(\d+)\s+Tanggal\s*:\s*([\d-]+)\s*\n\s*Shift\s*:\s*(\d+)\s+Jam\s*:\s*([\d:]+).*?ID Kasir\s*:\s*([^\n]+)\s*\n\s*Nama Kasir\s*:\s*([^\n]+)\s*\n\s*Cash Awal\s*:\s*Rp\.\s*([\d.]+)/gs;
    const matches = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
        matches.push({
            startPos: m.index,
            endPos: regex.lastIndex,
            station: m[1].trim(),
            tanggal: m[2].trim(),
            shiftNum: m[3].trim(),
            jamMulai: m[4].trim(),
            kasirId: m[5].trim(),
            kasirName: m[6].trim(),
            cashAwal: parseNominal(m[7])
        });
    }
    return matches;
}

/**
 * Memformat hasil audit menjadi pesan WhatsApp yang siap kirim
 */
export function formatPosAuditMessage(auditResult) {
    const { fileName, tanggal, station, shifts, grandTotal } = auditResult;

    let text = `🧾 *AUDIT KAS & JURNAL STRUK KASIR*\n`;
    text += `OMI TITAN EKSEKUTIF MART (Station ${station})\n`;
    text += `📅 Tanggal: *${tanggal}* | File: _${fileName}_\n`;
    text += `----------------------------------------\n`;

    shifts.forEach((s) => {
        const isLive = !s.isClosed;
        const statusBadge = isLive 
            ? `⏳ *SEDANG BERJALAN (Shift Aktif)*` 
            : `✅ *SUDAH CLOSING* _(${s.slipData?.tglClosing?.split(' ')[1] || 'Tutup'})_`;

        text += `\n👤 *SHIFT ${s.shiftNum}* — ${statusBadge}\n`;
        text += `• Kasir       : *${s.kasirName}* (${s.kasirId})\n`;
        text += `• Jam Mulai   : ${s.jamMulai} WIB\n`;
        text += `• Total Struk : *${s.totalStruk} Transaksi*\n`;
        text += `• Total Omset : *Rp ${formatRp(s.totalPenjualan)}*\n`;
        text += `  ------------------------------------\n`;
        text += `  💵 Tunai (Net)     : Rp ${formatRp(s.tunaiNet)}\n`;
        text += `  📱 E-Money (QRIS)  : Rp ${formatRp(s.emoney)}\n`;
        if (s.debit > 0) text += `  💳 Kartu Debit     : Rp ${formatRp(s.debit)}\n`;
        if (s.credit > 0) text += `  💳 Kartu Kredit    : Rp ${formatRp(s.credit)}\n`;
        if (s.voucher > 0) text += `  🎟️ Voucher         : Rp ${formatRp(s.voucher)}\n`;
        if (s.kreditAnggota > 0) text += `  📋 Bon Karyawan    : Rp ${formatRp(s.kreditAnggota)}\n`;
        text += `  ------------------------------------\n`;
        text += `  Modal Kas Awal     : Rp ${formatRp(s.cashAwal)}\n`;
        text += `  👉 *UANG FISIK LACI: Rp ${formatRp(s.totalFisikLaci)}*\n`;

        if (isLive) {
            text += `\n  💡 *PANDUAN PRA-CLOSING SHIFT ${s.shiftNum}:*\n`;
            text += `  1. Hitung uang fisik di laci Anda sekarang.\n`;
            text += `     Wajib ada tepat: *Rp ${formatRp(s.totalFisikLaci)}*\n`;
            text += `  2. Cocokkan total EDC / QRIS saat ini:\n`;
            text += `     • E-Money/QRIS  : Rp ${formatRp(s.emoney)}\n`;
            if (s.credit > 0 || s.debit > 0) {
                text += `     • Kartu EDC     : Rp ${formatRp(s.credit + s.debit)}\n`;
            }
            text += `  ⚠️ _Jika ada selisih, lacak nota kas sebelum closing resmi!_\n`;
        } else if (s.slipData && s.slipData.variance > 0) {
            text += `  ⚠️ _Catatan Variance Slip: Rp ${formatRp(s.slipData.variance)}_\n`;
        }
    });

    if (shifts.length > 1) {
        text += `\n========================================\n`;
        text += `📊 *TOTAL AKUMULASI HARI INI (${shifts.length} Shift):*\n`;
        text += `• Total Semua Struk : *${grandTotal.totalStruk} Struk*\n`;
        text += `• Total Omset Toko  : *Rp ${formatRp(grandTotal.totalPenjualan)}*\n`;
        text += `• Total Uang Tunai  : Rp ${formatRp(grandTotal.totalTunaiNet)}\n`;
        text += `• Total E-Money     : Rp ${formatRp(grandTotal.totalEmoney)}\n`;
        text += `• Total Kartu (EDC) : Rp ${formatRp(grandTotal.totalDebit + grandTotal.totalCredit)}\n`;
        if (grandTotal.totalVoucher > 0) text += `• Total Voucher     : Rp ${formatRp(grandTotal.totalVoucher)}\n`;
        if (grandTotal.totalKreditAnggota > 0) text += `• Total Bon/Kredit  : Rp ${formatRp(grandTotal.totalKreditAnggota)}\n`;
    }

    text += `\n----------------------------------------\n`;
    text += `💡 _Kirim file .TXT terbaru kapan saja untuk cek rekonsiliasi kas secara realtime._`;
    return text;
}

/**
 * Mengambil shift yang sedang aktif (live); jika tidak ada, ambil shift terakhir
 * @param {object} auditResult - Objek hasil parsePosJournal
 * @returns {object|null} Shift yang ditargetkan
 */
export function getActiveOrLatestShift(auditResult) {
    if (!auditResult || !auditResult.shifts || auditResult.shifts.length === 0) {
        return null;
    }
    // Cari shift aktif
    const activeShift = auditResult.shifts.find(s => !s.isClosed || s.status === 'ACTIVE');
    if (activeShift) {
        return activeShift;
    }
    // Jika semua sudah closing, ambil shift paling akhir
    return auditResult.shifts[auditResult.shifts.length - 1];
}

/**
 * Menghitung selisih (variance) antara fisik kas aktual dan target sistem
 * @param {number} targetFisikLaci - Target kas menurut sistem POS
 * @param {number} kasFisikAktual - Nominal uang fisik dihitung kasir
 * @returns {object} { selisih, status, formattedVariance }
 */
export function calculateVariance(targetFisikLaci, kasFisikAktual) {
    const selisih = (kasFisikAktual || 0) - (targetFisikLaci || 0);
    let status = 'PAS';
    let formattedVariance = 'Rp 0 (Pas / Balance)';

    if (selisih > 0) {
        status = 'LEBIH';
        formattedVariance = `+Rp ${formatRp(selisih)} (Lebih)`;
    } else if (selisih < 0) {
        status = 'KURANG';
        formattedVariance = `-Rp ${formatRp(Math.abs(selisih))} (Kurang)`;
    }

    return {
        targetFisikLaci,
        kasFisikAktual,
        selisih,
        status,
        formattedVariance
    };
}

/**
 * Memformat pesan ringkas hasil audit variance kas laci
 * @param {object} params - { shift, kasFisikAktual, tanggal, station }
 * @returns {string} Pesan teks WhatsApp
 */
export function formatVarianceMessage({ shift, kasFisikAktual, tanggal, station }) {
    const targetFisikLaci = shift.totalFisikLaci !== undefined ? shift.totalFisikLaci : (shift.cashAwal + shift.tunaiNet);
    const variance = calculateVariance(targetFisikLaci, kasFisikAktual);

    let text = `🧾 *HASIL REKONSILIASI VARIANCE KAS*\n`;
    text += `OMI TITAN EKSEKUTIF MART (Station ${station || '02'})\n`;
    text += `👤 Shift       : *Shift ${shift.shiftNum}* (${shift.kasirName})\n`;
    text += `📅 Tanggal     : *${tanggal || 'Hari Ini'}*\n`;
    text += `----------------------------------------\n`;
    text += `• Target Kas Sistem : Rp ${formatRp(targetFisikLaci)}\n`;
    text += `• Kas Fisik Laci    : Rp ${formatRp(kasFisikAktual)}\n`;
    text += `• Variance (Selisih): *${variance.formattedVariance}*\n`;
    text += `----------------------------------------`;

    return text;
}

