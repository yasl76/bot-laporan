import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

export function getSafeTargetSPD(targetSPD, fallback = 4725000) {
    if (typeof targetSPD === 'number' && Number.isFinite(targetSPD) && targetSPD > 0) {
        return targetSPD;
    }
    const parsed = parseFloat(targetSPD);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
}

export function aggregateRekapData(dataList) {
    let totalSpd = 0, totalMpp = 0, totalNbh = 0, totalYccg = 0, totalSosisOri = 0, totalSosisKeju = 0, totalRte = 0;
    dataList.forEach(item => {
        const itemSpd = typeof item.spd === 'number' ? item.spd : parseFloat(item.spd) || 0;
        const itemMpp = typeof item.mpp === 'number' ? item.mpp : parseFloat(item.mpp) || 0;
        const itemNbh = typeof item.nbh === 'number' ? item.nbh : parseFloat(item.nbh) || 0;
        const itemYccg = typeof item.yccg === 'number' ? item.yccg : parseFloat(item.yccg) || 0;
        const itemSosisOri = typeof item.sosis_ori === 'number' ? item.sosis_ori : parseFloat(item.sosis_ori) || 0;
        const itemSosisKeju = typeof item.sosis_keju === 'number' ? item.sosis_keju : parseFloat(item.sosis_keju) || 0;

        let itemRte = typeof item.total_rte === 'number' ? item.total_rte : parseFloat(item.total_rte);
        if (!Number.isFinite(itemRte) || itemRte === 0) {
            itemRte = itemSosisOri + itemSosisKeju;
        }

        totalSpd += itemSpd;
        totalMpp += itemMpp;
        totalNbh += itemNbh;
        totalYccg += itemYccg;
        totalSosisOri += itemSosisOri;
        totalSosisKeju += itemSosisKeju;
        totalRte += (itemRte || 0);
    });
    return { totalSpd, totalMpp, totalNbh, totalYccg, totalSosisOri, totalSosisKeju, totalRte };
}

export async function buildExcelJSWorkbook(dataList, outputPath, targetSPD = 4725000, storeInfo = null) {
    if (!dataList || dataList.length === 0) {
        throw new Error('Tidak ada data laporan untuk di-export ke Excel.');
    }

    const namaToko = storeInfo?.nama_toko || storeInfo?.nama || 'OMI TITAN EKSEKUTIF MART';
    const kodeToko = storeInfo?.kode_toko || storeInfo?.kode || 'O8BM';
    const targetSpdSafe = targetSPD === 0 ? 0 : getSafeTargetSPD(targetSPD);

    const { totalSpd, totalMpp, totalNbh, totalYccg, totalSosisOri, totalSosisKeju, totalRte } = aggregateRekapData(dataList);
    const jumlahHari = dataList.length;
    const rataSpd = jumlahHari > 0 ? Math.round(totalSpd / jumlahHari) : 0;
    const rawAchMtdRatio = (targetSpdSafe > 0 && rataSpd) ? (rataSpd / targetSpdSafe) : 0;

    let sumApc = 0, countApc = 0;
    dataList.forEach(item => {
        const a = typeof item.apc === 'number' ? item.apc : parseFloat(item.apc);
        if (Number.isFinite(a) && a > 0) {
            sumApc += a;
            countApc++;
        }
    });
    const avgApc = countApc > 0 ? Math.round(sumApc / countApc) : 0;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'OMI Titan Eksekutif Mart';
    wb.lastModifiedBy = 'Bot Laporan OMI';
    wb.created = new Date();
    wb.modified = new Date();

    const thinBorder = {
        top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
    };

    const cardBorder = {
        top: { style: 'thin', color: { argb: 'FF1B365D' } },
        bottom: { style: 'thin', color: { argb: 'FF1B365D' } },
        left: { style: 'thin', color: { argb: 'FF1B365D' } },
        right: { style: 'thin', color: { argb: 'FF1B365D' } }
    };

    const navyHeaderFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1B365D' }
    };

    const cardValueFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEBF3FB' }
    };

    const exportDateStr = `${new Date().toLocaleDateString('id-ID')} ${new Date().toLocaleTimeString('id-ID')}`;

    // =========================================================================
    // SHEET 1: DATA HARIAN LENGKAP
    // =========================================================================
    const wsHarian = wb.addWorksheet('Data Penjualan Harian', {
        views: [{ state: 'frozen', ySplit: 8 }]
    });

    // Baris 1: Judul
    wsHarian.mergeCells('A1:Q1');
    const r1 = wsHarian.getCell('A1');
    r1.value = 'LAPORAN PENJUALAN HARIAN TOKO';
    r1.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF1B365D' } };
    r1.alignment = { horizontal: 'center', vertical: 'middle' };
    wsHarian.getRow(1).height = 28;

    // Baris 2: Profil Toko
    wsHarian.mergeCells('A2:Q2');
    const r2 = wsHarian.getCell('A2');
    r2.value = `${namaToko} (${kodeToko})`;
    r2.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF2F5597' } };
    r2.alignment = { horizontal: 'center', vertical: 'middle' };
    wsHarian.getRow(2).height = 20;

    // Baris 3: Tanggal Export
    wsHarian.mergeCells('A3:Q3');
    const r3 = wsHarian.getCell('A3');
    r3.value = `Tanggal Export: ${exportDateStr}`;
    r3.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF595959' } };
    r3.alignment = { horizontal: 'center', vertical: 'middle' };
    wsHarian.getRow(3).height = 18;

    // Baris 4: Kosong
    wsHarian.getRow(4).height = 10;

    // Baris 5 & 6: 4 KPI Summary Cards
    // Card 1: Total SPD (Cols B-D)
    // Card 2: Target RAB (Cols F-H)
    // Card 3: Pencapaian MTD % (Cols J-L)
    // Card 4: Rata-rata APC (Cols N-P)
    const cards = [
        { cols: ['B', 'D'], title: 'TOTAL SPD (MTD)', val: totalSpd, fmt: 'Rp #,##0' },
        { cols: ['F', 'H'], title: 'TARGET RAB HARIAN', val: targetSpdSafe, fmt: 'Rp #,##0' },
        { cols: ['J', 'L'], title: 'PENCAPAIAN MTD (ACH %)', val: rawAchMtdRatio, fmt: '0.00%' },
        { cols: ['N', 'P'], title: 'RATA-RATA APC', val: avgApc, fmt: 'Rp #,##0' }
    ];

    wsHarian.getRow(5).height = 20;
    wsHarian.getRow(6).height = 26;

    cards.forEach(card => {
        const titleRange = `${card.cols[0]}5:${card.cols[1]}5`;
        const valRange = `${card.cols[0]}6:${card.cols[1]}6`;

        wsHarian.mergeCells(titleRange);
        wsHarian.mergeCells(valRange);

        const tCell = wsHarian.getCell(`${card.cols[0]}5`);
        tCell.value = card.title;
        tCell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
        tCell.alignment = { horizontal: 'center', vertical: 'middle' };
        tCell.fill = navyHeaderFill;

        const vCell = wsHarian.getCell(`${card.cols[0]}6`);
        vCell.value = card.val;
        vCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF1B365D' } };
        vCell.alignment = { horizontal: 'center', vertical: 'middle' };
        vCell.fill = cardValueFill;
        vCell.numFmt = card.fmt;

        // Apply borders across merged card cells
        const colStart = wsHarian.getColumn(card.cols[0]).number;
        const colEnd = wsHarian.getColumn(card.cols[1]).number;
        for (let c = colStart; c <= colEnd; c++) {
            wsHarian.getRow(5).getCell(c).border = cardBorder;
            wsHarian.getRow(6).getCell(c).border = cardBorder;
        }
    });

    // Baris 7: Kosong
    wsHarian.getRow(7).height = 12;

    // Baris 8: Header Tabel
    const tableHeaders = [
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
    ];

    const headerRow = wsHarian.getRow(8);
    headerRow.values = tableHeaders;
    headerRow.height = 26;
    headerRow.eachCell(cell => {
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = navyHeaderFill;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = thinBorder;
    });

    // Baris 9+: Data Rows
    dataList.forEach((item, idx) => {
        const itemSpd = typeof item.spd === 'number' ? item.spd : (parseFloat(item.spd) || 0);
        const itemAvgSpd = typeof item.avg_spd === 'number' ? item.avg_spd : (parseFloat(item.avg_spd) || 0);

        const rawAchHarian = (targetSpdSafe > 0 && itemSpd) ? (itemSpd / targetSpdSafe) : 0;
        const achHarianRatio = Number.isFinite(rawAchHarian) ? rawAchHarian : 0;

        const rawAchMtd = (targetSpdSafe > 0 && itemAvgSpd) ? (itemAvgSpd / targetSpdSafe) : 0;
        const achMtdRatio = Number.isFinite(rawAchMtd) ? rawAchMtd : 0;

        const rowNum = 9 + idx;
        const row = wsHarian.getRow(rowNum);
        row.height = 20;

        let mgVal = item.mg !== undefined && item.mg !== null ? item.mg : '';
        let mgNum = null;
        if (typeof mgVal === 'number') {
            mgNum = mgVal > 1 ? mgVal / 100 : mgVal;
        } else if (typeof mgVal === 'string' && mgVal.trim() !== '') {
            const cleanMg = mgVal.replace('%', '').trim();
            const parsedMg = parseFloat(cleanMg);
            if (Number.isFinite(parsedMg)) {
                mgNum = parsedMg > 1 ? parsedMg / 100 : parsedMg;
            }
        }

        const sOri = typeof item.sosis_ori === 'number' ? item.sosis_ori : (parseFloat(item.sosis_ori) || 0);
        const sKeju = typeof item.sosis_keju === 'number' ? item.sosis_keju : (parseFloat(item.sosis_keju) || 0);
        let rteVal = typeof item.total_rte === 'number' ? item.total_rte : parseFloat(item.total_rte);
        if (!Number.isFinite(rteVal) || rteVal === 0) {
            rteVal = sOri + sKeju;
        }

        row.values = [
            idx + 1,
            item.tanggal || '',
            itemSpd,
            achHarianRatio,
            item.std || 0,
            item.apc || 0,
            item.mgrp || 0,
            mgNum !== null ? mgNum : (item.mg || ''),
            item.lpp || 0,
            itemAvgSpd,
            achMtdRatio,
            item.yccg || 0,
            sOri,
            sKeju,
            rteVal,
            item.mpp || 0,
            item.nbh || 0
        ];

        const isEven = idx % 2 === 1;
        const rowBg = isEven ? 'FFF8F9FA' : 'FFFFFFFF';

        row.eachCell((cell, colNum) => {
            cell.font = { name: 'Arial', size: 9.5 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
            cell.border = thinBorder;

            // Perataan & Number Format
            if (colNum === 1 || colNum === 2) {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else if (colNum === 4 || colNum === 11) {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = '0.00%';
            } else if (colNum === 3 || colNum === 6 || colNum === 7 || colNum === 9 || colNum === 10) {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = 'Rp #,##0';
            } else if (colNum === 8 && mgNum !== null) {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = '0.00%';
            } else {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                if (typeof cell.value === 'number') {
                    cell.numFmt = '#,##0';
                }
            }
        });
    });

    // Auto-fit Column Widths (Sheet 1)
    wsHarian.columns.forEach((column, colIdx) => {
        let maxLen = 0;
        const headerText = tableHeaders[colIdx] || '';
        maxLen = Math.max(maxLen, headerText.length);

        column.eachCell({ includeEmpty: false }, (cell, rowIdx) => {
            if (rowIdx >= 8) {
                let cellText = cell.value ? cell.value.toString() : '';
                if (cell.numFmt === 'Rp #,##0' && typeof cell.value === 'number') {
                    cellText = 'Rp ' + cell.value.toLocaleString('id-ID');
                } else if (cell.numFmt === '0.00%' && typeof cell.value === 'number') {
                    cellText = (cell.value * 100).toFixed(2) + '%';
                }
                maxLen = Math.max(maxLen, cellText.length);
            }
        });
        column.width = Math.max(maxLen + 4, colIdx === 0 ? 6 : 12);
    });

    // =========================================================================
    // SHEET 2: RINGKASAN AKUMULASI PERFORMA BULANAN
    // =========================================================================
    const wsRingkasan = wb.addWorksheet('Ringkasan Bulanan');

    // Header Sheet 2
    wsRingkasan.mergeCells('A1:C1');
    const s2Title = wsRingkasan.getCell('A1');
    s2Title.value = 'RINGKASAN AKUMULASI PERFORMA BULANAN';
    s2Title.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    s2Title.fill = navyHeaderFill;
    s2Title.alignment = { horizontal: 'center', vertical: 'middle' };
    wsRingkasan.getRow(1).height = 28;

    wsRingkasan.mergeCells('A2:C2');
    const s2Sub = wsRingkasan.getCell('A2');
    s2Sub.value = `${namaToko} (${kodeToko})`;
    s2Sub.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FFD9E1F2' } };
    s2Sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
    s2Sub.alignment = { horizontal: 'center', vertical: 'middle' };
    wsRingkasan.getRow(2).height = 20;

    wsRingkasan.mergeCells('A3:C3');
    const s2Date = wsRingkasan.getCell('A3');
    s2Date.value = `Tanggal Export: ${exportDateStr}`;
    s2Date.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF595959' } };
    s2Date.alignment = { horizontal: 'center', vertical: 'middle' };
    wsRingkasan.getRow(3).height = 18;

    let s2CurrentRow = 5;

    function renderSection(sectionTitle, headers, rowsData) {
        // Section Header
        const hRow = wsRingkasan.getRow(s2CurrentRow);
        hRow.values = headers;
        hRow.height = 22;
        hRow.eachCell(cell => {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = navyHeaderFill;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = thinBorder;
        });
        s2CurrentRow++;

        // Rows
        rowsData.forEach((r, idx) => {
            const dataRow = wsRingkasan.getRow(s2CurrentRow);
            dataRow.values = [r.label, r.val, r.ket];
            dataRow.height = 20;
            const bg = (idx % 2 === 1) ? 'FFF8F9FA' : 'FFFFFFFF';

            dataRow.eachCell((cell, col) => {
                cell.font = { name: 'Arial', size: 9.5, bold: (col === 2) };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
                cell.border = thinBorder;

                if (col === 1) {
                    cell.alignment = { horizontal: 'left', vertical: 'middle' };
                } else if (col === 2) {
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    if (r.fmt) cell.numFmt = r.fmt;
                } else {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                }
            });
            s2CurrentRow++;
        });
        s2CurrentRow++; // blank line
    }

    // Section 1: Indikator Performa
    renderSection(
        'INDIKATOR PERFORMA',
        ['Indikator Performa', 'Nilai / Akumulasi', 'Keterangan'],
        [
            { label: 'Total Hari Masuk', val: jumlahHari, ket: 'Hari Laporan', fmt: '#,##0' },
            { label: 'Target SPD Harian', val: targetSpdSafe, ket: 'Target RAB Toko', fmt: 'Rp #,##0' },
            { label: 'Total Akumulasi SPD', val: totalSpd, ket: 'Rupiah', fmt: 'Rp #,##0' },
            { label: 'Rata-rata SPD Harian', val: rataSpd, ket: 'Rupiah', fmt: 'Rp #,##0' },
            { label: 'Pencapaian MTD (ACH %)', val: rawAchMtdRatio, ket: 'Terhadap Target RAB', fmt: '0.00%' },
            { label: 'Rata-rata APC', val: avgApc, ket: 'Rupiah', fmt: 'Rp #,##0' }
        ]
    );

    // Section 2: Kategori F&B
    renderSection(
        'KATEGORI F&B',
        ['Kategori F&B', 'Total Terjual', 'Satuan'],
        [
            { label: 'Penjualan YCCG', val: totalYccg, ket: 'Cup', fmt: '#,##0' },
            { label: 'Sosis Original', val: totalSosisOri, ket: 'Pcs', fmt: '#,##0' },
            { label: 'Sosis Keju', val: totalSosisKeju, ket: 'Pcs', fmt: '#,##0' },
            { label: 'Total Penjualan RTE', val: totalRte, ket: 'Pcs', fmt: '#,##0' }
        ]
    );

    // Section 3: Stock Opname
    renderSection(
        'TEMUAN STOCK OPNAME',
        ['Temuan Stock Opname', 'Jumlah', 'Satuan'],
        [
            { label: 'Total MPP (Expired/Rusak)', val: totalMpp, ket: 'Item', fmt: '#,##0' },
            { label: 'Total NBH (Barang Hilang)', val: totalNbh, ket: 'Item', fmt: '#,##0' }
        ]
    );

    wsRingkasan.columns = [
        { width: 34 },
        { width: 22 },
        { width: 26 }
    ];

    await wb.xlsx.writeFile(outputPath);
    return outputPath;
}
