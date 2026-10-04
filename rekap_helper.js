import fs from 'fs';
import path from 'path';
import cp from 'child_process';
import { fileURLToPath } from 'url';
import { formatRp } from './src/formatters.js';
import { getSafeTargetSPD, aggregateRekapData, buildExcelJSWorkbook } from './exceljs_rekap_builder.js';

export { getSafeTargetSPD };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_SCRIPT = path.join(__dirname, 'exceljs_rekap_worker.js');

export function getStructuredTextRekap(dataList, targetSPD = 4725000, storeInfo = null) {
    if (!dataList || dataList.length === 0) {
        return "⚠️ Belum ada data laporan yang tersimpan untuk direkap bulan ini.";
    }

    const namaToko = storeInfo?.nama_toko || storeInfo?.nama || 'OMI TITAN EKSEKUTIF MART';
    const kodeToko = storeInfo?.kode_toko || storeInfo?.kode || 'O8BM';

    const { totalSpd, totalMpp, totalNbh, totalYccg, totalSosisOri, totalSosisKeju, totalRte } = aggregateRekapData(dataList);
    const jumlahHari = dataList.length;

    const targetSpdSafe = getSafeTargetSPD(targetSPD);
    const rataSpd = jumlahHari > 0 ? Math.round(totalSpd / jumlahHari) : 0;
    const achMtd = targetSpdSafe > 0 ? ((rataSpd / targetSpdSafe) * 100).toFixed(2) : '0.00';

    let text = `📊 *REKAP PERFORMA TOKO BULAN INI*\n`;
    text += `${namaToko} (${kodeToko})\n`;
    text += `----------------------------------------\n`;
    text += `🗓️ *Total Hari Kerja Masuk:* ${jumlahHari} Hari\n\n`;

    text += `💰 *Akumulasi Sales & Target:*
- Total SPD Terkumpul   : Rp ${formatRp(totalSpd)}
- Rata-rata SPD Harian  : Rp ${formatRp(rataSpd)}
- Target RAB Harian     : Rp ${formatRp(targetSpdSafe)}
- Pencapaian MTD (ACH)  : *${achMtd}%*\n\n`;

    text += `☕ *Akumulasi Penjualan YCCG & RTE:*
- Total YCCG Keluar     : *${totalYccg} Cup*
- Sosis Ori             : ${totalSosisOri} Pcs
- Sosis Keju            : ${totalSosisKeju} Pcs
- Total Penjualan RTE   : *${totalRte} Pcs*\n\n`;

    text += `📦 *Akumulasi Stock Opname:*
- Total MPP (Expired/Rusak) : *${totalMpp} Item*
- Total NBH (Barang Hilang)  : *${totalNbh} Item*\n`;

    // Riwayat singkat (maksimal 5 hari terakhir)
    text += `----------------------------------------\n`;
    text += `📋 *Riwayat 5 Hari Terakhir:*\n`;
    const sliceDays = dataList.slice(-5);
    sliceDays.forEach(d => {
        const dSpd = typeof d.spd === 'number' ? d.spd : (parseFloat(d.spd) || 0);
        const ach = targetSpdSafe > 0 ? ((dSpd / targetSpdSafe) * 100).toFixed(1) : '0.0';
        text += `• ${d.tanggal}: SPD Rp ${formatRp(dSpd)} (${ach}%) | YCCG: ${d.yccg || 0} | RTE: ${d.total_rte || 0}\n`;
    });

    text += `----------------------------------------\n`;
    text += `💡 _Ketik *!rekap excel* untuk mengunduh rekap harian lengkap dalam bentuk file Excel._`;
    return text;
}

export function generateRekapExcel(dataList, outputPath = 'Rekap_Bulanan.xlsx', targetSPD = 4725000, storeInfo = null) {
    if (!dataList || dataList.length === 0) {
        throw new Error('Tidak ada data laporan untuk di-export ke Excel.');
    }

    try {
        const payload = JSON.stringify({
            dataList,
            outputPath: path.resolve(outputPath),
            targetSPD,
            storeInfo
        });

        cp.execFileSync(process.execPath, [WORKER_SCRIPT], {
            input: payload,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        });

        return outputPath;
    } catch (err) {
        console.error('Error saat membuat file Excel Rekap dengan ExcelJS:', err);
        throw err;
    }
}
