import xlsx from 'xlsx';
import fs from 'fs';

const formatRp = (angka) => new Intl.NumberFormat('id-ID').format(Math.round(angka) || 0);

export function getStructuredTextRekap(dataList, targetSPD = 4725000, storeInfo = null) {
    if (!dataList || dataList.length === 0) {
        return "⚠️ Belum ada data laporan yang tersimpan untuk direkap bulan ini.";
    }

    const namaToko = storeInfo?.nama_toko || storeInfo?.nama || 'OMI TITAN EKSEKUTIF MART';
    const kodeToko = storeInfo?.kode_toko || storeInfo?.kode || 'O8BM';

    let totalSpd = 0;
    let totalMpp = 0;
    let totalNbh = 0;
    let totalYccg = 0;
    let totalSosisOri = 0;
    let totalSosisKeju = 0;
    let totalRte = 0;
    const jumlahHari = dataList.length;

    dataList.forEach(item => {
        totalSpd += (item.spd || 0);
        totalMpp += (item.mpp || 0);
        totalNbh += (item.nbh || 0);
        totalYccg += (item.yccg || 0);
        totalSosisOri += (item.sosis_ori || 0);
        totalSosisKeju += (item.sosis_keju || 0);
        totalRte += (item.total_rte || 0);
    });

    const rataSpd = Math.round(totalSpd / jumlahHari);
    const achMtd = ((rataSpd / targetSPD) * 100).toFixed(2);

    let text = `📊 *REKAP PERFORMA TOKO BULAN INI*\n`;
    text += `${namaToko} (${kodeToko})\n`;
    text += `----------------------------------------\n`;
    text += `🗓️ *Total Hari Kerja Masuk:* ${jumlahHari} Hari\n\n`;

    text += `💰 *Akumulasi Sales & Target:*
- Total SPD Terkumpul   : Rp ${formatRp(totalSpd)}
- Rata-rata SPD Harian  : Rp ${formatRp(rataSpd)}
- Target RAB Harian     : Rp ${formatRp(targetSPD)}
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
        const ach = ((d.spd / targetSPD) * 100).toFixed(1);
        text += `• ${d.tanggal}: SPD Rp ${formatRp(d.spd)} (${ach}%) | YCCG: ${d.yccg || 0} | RTE: ${d.total_rte || 0}\n`;
    });

    text += `----------------------------------------\n`;
    text += `💡 _Ketik *!rekap excel* untuk mengunduh rekap harian lengkap dalam bentuk file Excel._`;
    return text;
}

export function generateRekapExcel(dataList, outputPath = 'Rekap_Bulanan.xlsx', targetSPD = 4725000, storeInfo = null) {
    if (!dataList || dataList.length === 0) {
        throw new Error('Tidak ada data laporan untuk di-export ke Excel.');
    }

    const namaToko = storeInfo?.nama_toko || storeInfo?.nama || 'OMI TITAN EKSEKUTIF MART';
    const kodeToko = storeInfo?.kode_toko || storeInfo?.kode || 'O8BM';

    const wb = xlsx.utils.book_new();

    // 1. SHEET 1: DATA HARIAN LENGKAP
    const rowsHarian = [];
    rowsHarian.push(['LAPORAN PENJUALAN HARIAN TOKO']);
    rowsHarian.push([`${namaToko} (${kodeToko})`]);
    rowsHarian.push([`Tanggal Export: ${new Date().toLocaleDateString('id-ID')} ${new Date().toLocaleTimeString('id-ID')}`]);
    rowsHarian.push([]); // blank

    rowsHarian.push([
        'No.',
        'Tanggal',
        'SPD (Rp)',
        'ACH Harian (%)',
        'STD',
        'APC (Rp)',
        'MGRP (Rp)',
        'MG (%)',
        'LPP OMI (Rp)',
        'Avg SPD (Rp)',
        'ACH MTD (%)',
        'YCCG (Cup)',
        'Sosis Ori (Pcs)',
        'Sosis Keju (Pcs)',
        'Total RTE (Pcs)',
        'SO MPP',
        'SO NBH'
    ]);

    dataList.forEach((item, idx) => {
        const achHarian = item.spd ? ((item.spd / targetSPD) * 100).toFixed(2) : '0';
        const achMtd = item.avg_spd ? ((item.avg_spd / targetSPD) * 100).toFixed(2) : '0';

        rowsHarian.push([
            idx + 1,
            item.tanggal,
            item.spd || 0,
            parseFloat(achHarian),
            item.std || 0,
            item.apc || 0,
            item.mgrp || 0,
            item.mg || '',
            item.lpp || 0,
            item.avg_spd || 0,
            parseFloat(achMtd),
            item.yccg || 0,
            item.sosis_ori || 0,
            item.sosis_keju || 0,
            item.total_rte || 0,
            item.mpp || 0,
            item.nbh || 0
        ]);
    });

    const wsHarian = xlsx.utils.aoa_to_sheet(rowsHarian);
    wsHarian['!cols'] = [
        { wch: 5 },  // No
        { wch: 20 }, // Tanggal
        { wch: 15 }, // SPD
        { wch: 15 }, // ACH Harian
        { wch: 8 },  // STD
        { wch: 12 }, // APC
        { wch: 15 }, // MGRP
        { wch: 10 }, // MG%
        { wch: 18 }, // LPP
        { wch: 15 }, // Avg SPD
        { wch: 15 }, // ACH MTD
        { wch: 12 }, // YCCG
        { wch: 15 }, // Sosis Ori
        { wch: 15 }, // Sosis Keju
        { wch: 15 }, // Total RTE
        { wch: 10 }, // SO MPP
        { wch: 10 }  // SO NBH
    ];
    xlsx.utils.book_append_sheet(wb, wsHarian, 'Data Penjualan Harian');

    // 2. SHEET 2: RINGKASAN PERFORMA BULANAN
    let totalSpd = 0;
    let totalMpp = 0;
    let totalNbh = 0;
    let totalYccg = 0;
    let totalSosisOri = 0;
    let totalSosisKeju = 0;
    let totalRte = 0;
    const jumlahHari = dataList.length;

    dataList.forEach(item => {
        totalSpd += (item.spd || 0);
        totalMpp += (item.mpp || 0);
        totalNbh += (item.nbh || 0);
        totalYccg += (item.yccg || 0);
        totalSosisOri += (item.sosis_ori || 0);
        totalSosisKeju += (item.sosis_keju || 0);
        totalRte += (item.total_rte || 0);
    });

    const rataSpd = Math.round(totalSpd / jumlahHari);
    const achMtd = ((rataSpd / targetSPD) * 100).toFixed(2);

    const rowsRingkasan = [
        ['RINGKASAN AKUMULASI PERFORMA BULANAN'],
        [`${namaToko} (${kodeToko})`],
        [`Tanggal Export: ${new Date().toLocaleDateString('id-ID')}`],
        [],
        ['Indikator Performa', 'Nilai / Akumulasi', 'Keterangan'],
        ['Total Hari Masuk', jumlahHari, 'Hari Laporan'],
        ['Target SPD Harian', targetSPD, 'Target RAB Toko'],
        ['Total Akumulasi SPD', totalSpd, 'Rupiah'],
        ['Rata-rata SPD Harian', rataSpd, 'Rupiah'],
        ['Pencapaian MTD (ACH %)', `${achMtd}%`, 'Terhadap Target RAB'],
        [],
        ['Kategori F&B', 'Total Terjual', 'Satuan'],
        ['Penjualan YCCG', totalYccg, 'Cup'],
        ['Sosis Original', totalSosisOri, 'Pcs'],
        ['Sosis Keju', totalSosisKeju, 'Pcs'],
        ['Total Penjualan RTE', totalRte, 'Pcs'],
        [],
        ['Temuan Stock Opname', 'Jumlah', 'Satuan'],
        ['Total MPP (Expired/Rusak)', totalMpp, 'Item'],
        ['Total NBH (Barang Hilang)', totalNbh, 'Item']
    ];

    const wsRingkasan = xlsx.utils.aoa_to_sheet(rowsRingkasan);
    wsRingkasan['!cols'] = [
        { wch: 30 },
        { wch: 20 },
        { wch: 25 }
    ];
    xlsx.utils.book_append_sheet(wb, wsRingkasan, 'Ringkasan Bulanan');

    xlsx.writeFile(wb, outputPath);
    return outputPath;
}

