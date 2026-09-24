import xlsx from 'xlsx';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

/**
 * Parsing angka aman yang menangani locale Indonesia (koma sebagai desimal)
 * dan mencegah nilai non-finite / NaN.
 */
export function parseSafeFloat(val) {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    let str = String(val).trim();
    if (!str) return 0;
    if (str.includes(',') && str.includes('.')) {
        if (str.indexOf('.') < str.indexOf(',')) {
            str = str.replace(/\./g, '').replace(',', '.');
        } else {
            str = str.replace(/,/g, '');
        }
    } else if (str.includes(',')) {
        str = str.replace(',', '.');
    }
    const clean = str.replace(/[^0-9.-]/g, '');
    const num = parseFloat(clean);
    return Number.isFinite(num) ? num : 0;
}

/**
 * Mencari file pareto terbaru di folder kerja
 */
export function getLatestParetoFile(baseDir = '.') {
    try {
        const files = fs.readdirSync(baseDir);
        const paretoFiles = files
            .filter(f => {
                const lower = f.toLowerCase();
                const isExcel = lower.endsWith('.xls') || lower.endsWith('.xlsx');
                const isIgnored = lower.startsWith('~$') || lower.startsWith('laporan_pb') || lower.startsWith('rekap_bulanan') || lower.startsWith('test_');
                return isExcel && !isIgnored;
            })
            .map(f => {
                const fullPath = path.join(baseDir, f);
                return { name: f, fullPath, mtime: fs.statSync(fullPath).mtime };
            })
            .sort((a, b) => {
                const aPareto = a.name.toLowerCase().includes('pareto') ? 1 : 0;
                const bPareto = b.name.toLowerCase().includes('pareto') ? 1 : 0;
                if (aPareto !== bPareto) return bPareto - aPareto;
                return b.mtime - a.mtime;
            });

        return paretoFiles.length > 0 ? paretoFiles[0].fullPath : null;
    } catch (e) {
        console.error('Error mencari file pareto:', e);
        return null;
    }
}

/**
 * Analisa dinamis file pareto Excel (.xls / .xlsx)
 */
export function analyzePareto(filePath, maxStockThreshold = 10) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File pareto tidak ditemukan: ${filePath}`);
    }

    const wb = xlsx.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 5) {
        throw new Error('File Excel tidak memuat data yang cukup.');
    }

    // Dynamic Header Detection
    let headerRowIdx = -1;
    let colMap = {
        no: -1,
        plu: -1,
        nama: -1,
        qtyJual: -1,
        pkm: -1,
        ft: -1,
        qtyStock: -1,
        hrgJual: -1
    };

    for (let r = 0; r < Math.min(rows.length, 30); r++) {
        const row = rows[r];
        if (!row || !Array.isArray(row)) continue;

        let foundKeywords = 0;
        row.forEach((cell, c) => {
            const str = String(cell).toLowerCase().trim().replace(/[\n\r]+/g, ' ');
            if (str === 'no' || str === 'no.') colMap.no = c;
            if (str === 'plu' || str === 'kode' || str.includes('kode barang')) { colMap.plu = c; foundKeywords++; }
            if (str.includes('nama barang') || str === 'barang' || str.includes('deskripsi')) { colMap.nama = c; foundKeywords++; }
            if (str === 'qty' || str.includes('qty jual') || str === 'sales qty') { if (colMap.qtyJual === -1) colMap.qtyJual = c; foundKeywords++; }
            if (str === 'pkm') colMap.pkm = c;
            if (str === 'ft' || str === 'frac') colMap.ft = c;
            if (str.includes('qty stock') || str === 'stock' || str === 'stok' || str === 'qty stok') { colMap.qtyStock = c; foundKeywords++; }
            if (str.includes('hrg jual') || str.includes('harga')) colMap.hrgJual = c;
        });

        if (foundKeywords >= 3) {
            headerRowIdx = r;
            break;
        }
    }

    if (colMap.plu === -1 || colMap.qtyStock === -1) {
        colMap = { no: 0, plu: 2, nama: 3, qtyJual: 7, pkm: 24, ft: 26, qtyStock: 29, hrgJual: 14 };
        headerRowIdx = 13;
    }

    const lowStockItems = [];
    const allItems = [];

    const startRow = headerRowIdx + 1;
    for (let r = startRow; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;

        const plu = String(row[colMap.plu] || '').trim();
        const nama = String(row[colMap.nama] || '').trim();

        if (!plu || !nama || nama.toLowerCase().includes('total') || nama.toLowerCase().includes('grand')) {
            continue;
        }

        const no = parseInt(row[colMap.no]) || (allItems.length + 1);
        const qtyJual = parseSafeFloat(row[colMap.qtyJual]);
        const pkm = parseSafeFloat(row[colMap.pkm]);
        const ft = parseSafeFloat(row[colMap.ft]);
        const qtyStock = parseSafeFloat(row[colMap.qtyStock]);

        let rekomendasiOrder = 0;
        if (pkm > qtyStock) {
            rekomendasiOrder = Math.ceil(pkm - qtyStock);
        } else if (qtyStock <= 5) {
            rekomendasiOrder = Math.max(10 - qtyStock, 5);
        }

        let statusKritis = 'AMAN';
        let prioritasLevel = 3;
        if (qtyStock <= 0) {
            statusKritis = '🔴 KOSONG / HABIS';
            prioritasLevel = 1;
        } else if (qtyStock <= 5) {
            statusKritis = '🟠 SANGAT KRITIS (1-5)';
            prioritasLevel = 2;
        } else if (qtyStock <= maxStockThreshold) {
            statusKritis = maxStockThreshold === 10 ? '🟡 MENIPIS (6-10)' : `🟡 MENIPIS (6-${maxStockThreshold})`;
            prioritasLevel = 3;
        }

        const item = {
            no,
            plu,
            nama,
            qtyJual,
            pkm,
            ft,
            qtyStock,
            rekomendasiOrder,
            statusKritis,
            prioritasLevel
        };

        allItems.push(item);
        if (qtyStock <= maxStockThreshold) {
            lowStockItems.push(item);
        }
    }

    // Urutkan cerdas: Prioritas 1 (Habis) teratas diurutkan berdasarkan Ranking Pareto terlaris
    lowStockItems.sort((a, b) => {
        if (a.prioritasLevel !== b.prioritasLevel) return a.prioritasLevel - b.prioritasLevel;
        return a.no - b.no;
    });

    const totalKosong = lowStockItems.filter(i => i.qtyStock <= 0).length;
    const totalSangatKritis = lowStockItems.filter(i => i.qtyStock > 0 && i.qtyStock <= Math.min(5, maxStockThreshold)).length;
    const totalMenipis = lowStockItems.filter(i => i.qtyStock > 5 && i.qtyStock <= maxStockThreshold).length;

    return {
        totalItem: allItems.length,
        totalKritis: lowStockItems.length,
        totalKosong,
        totalSangatKritis,
        totalMenipis,
        lowStockItems,
        maxStockThreshold,
        fileName: path.basename(filePath)
    };
}

/**
 * Generate File Excel Rekomendasi PB dengan Tampilan Bewarna, Rapi, & Elegan
 */
export async function generatePbExcel(analysisResult, outputPath = 'Laporan_PB_Pareto.xlsx', storeInfo = null) {
    const { lowStockItems, totalItem, totalKritis, totalKosong, totalSangatKritis, totalMenipis, maxStockThreshold = 10, fileName } = analysisResult;

    const namaToko = storeInfo?.nama_toko || storeInfo?.nama || 'OMI TITAN EKSEKUTIF MART';
    const kodeToko = storeInfo?.kode_toko || storeInfo?.kode || 'O8BM';
    const cabangToko = storeInfo?.cabang ? ` - CABANG ${storeInfo.cabang}` : ' - CABANG BEKASI';

    const wb = new ExcelJS.Workbook();
    wb.creator = `Bot Laporan ${namaToko}`;
    wb.created = new Date();

    // ========================================================
    // SHEET 1: DAFTAR REKOMENDASI ORDER PB
    // ========================================================
    const ws = wb.addWorksheet('Daftar Order PB Pareto', {
        views: [{ state: 'frozen', ySplit: 5 }]
    });

    // 1. Title Banner (Navy Blue Elegan)
    ws.mergeCells('A1:L1');
    const titleCell = ws.getCell('A1');
    titleCell.value = 'DAFTAR REKOMENDASI PERMINTAAN BARANG (PB) - ANALISA STOK PARETO';
    titleCell.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    // 2. Subtitle Banner (Soft Dark Blue)
    ws.mergeCells('A2:L2');
    const subCell = ws.getCell('A2');
    subCell.value = `${namaToko} (KODE: ${kodeToko})${cabangToko}`;
    subCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFD9E1F2' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 20;

    // 3. Metadata
    ws.mergeCells('A3:L3');
    const metaCell = ws.getCell('A3');
    metaCell.value = `Periode File: ${fileName} | Batas Stok: <= ${maxStockThreshold} pcs | Dibuat: ${new Date().toLocaleDateString('id-ID')} ${new Date().toLocaleTimeString('id-ID')} | Ringkasan: ${totalKritis} SKU Butuh Restock (${totalKosong} Habis, ${totalSangatKritis} Sangat Kritis, ${totalMenipis} Menipis)`;
    metaCell.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF595959' } };
    metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(3).height = 18;

    ws.getRow(4).height = 8; // Spasi pemisah

    // 4. Baris Header Kolom Tabel (Bewarna Navy Blue dengan Teks Putih Tebal)
    const headers = [
        'No.',
        'Prioritas',
        'Ranking',
        'Kode PLU',
        'Nama Barang',
        'Sisa Stok',
        'Target (PKM)',
        'Isi/Dus (FT)',
        'Penjualan (Qty)',
        'Order (Pcs)',
        'Estimasi Order (Dus)',
        'Status Kritis'
    ];

    const headerRow = ws.getRow(5);
    headerRow.values = headers;
    headerRow.height = 26;

    headerRow.eachCell((cell) => {
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
            top: { style: 'medium', color: { argb: 'FF102A45' } },
            bottom: { style: 'medium', color: { argb: 'FF102A45' } },
            left: { style: 'thin', color: { argb: 'FFB4C6E7' } },
            right: { style: 'thin', color: { argb: 'FFB4C6E7' } }
        };
    });

    const thinBorder = {
        top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
    };

    // 5. Baris Data (Row Bewarna Sesuai Status Kritis)
    lowStockItems.forEach((item, idx) => {
        const rowNum = 6 + idx;
        const row = ws.getRow(rowNum);

        let labelPrioritas = '3. Menipis';
        let statusText = '🟡 MENIPIS (6-10)';
        // Default zebra striping bersih
        let rowBgColor = (idx % 2 === 0) ? 'FFFFFFFF' : 'FFF9FAFB';
        let fontColor = 'FF212529';

        // Highlight Merah Pastel untuk Stok Kosong / Habis (Prioritas 1)
        if (item.qtyStock <= 0) {
            labelPrioritas = '1. URGENT';
            statusText = '🔴 KOSONG / HABIS';
            rowBgColor = 'FFFCE4D6'; // Soft Peach/Red highlight
            fontColor = 'FF9C0006';  // Dark Red text
        }
        // Highlight Kuning Pastel untuk Stok Sangat Kritis 1-5 (Prioritas 2)
        else if (item.qtyStock <= 5) {
            labelPrioritas = '2. SEGERA';
            statusText = '🟠 KRITIS (1-5)';
            rowBgColor = 'FFFFF2CC'; // Soft Amber highlight
            fontColor = 'FF7F6000';  // Dark Amber text
        }

        let orderDus = `${item.rekomendasiOrder} Pcs`;
        if (item.ft > 1 && item.rekomendasiOrder > 0) {
            const jumlahDus = Math.ceil(item.rekomendasiOrder / item.ft);
            if (Number.isFinite(jumlahDus) && jumlahDus > 0) {
                orderDus = `${jumlahDus} Dus (${item.rekomendasiOrder} Pcs)`;
            }
        }

        row.values = [
            idx + 1,
            labelPrioritas,
            item.no,
            String(item.plu),
            item.nama,
            item.qtyStock,
            item.pkm || 0,
            item.ft > 0 ? item.ft : '-',
            item.qtyJual || 0,
            item.rekomendasiOrder,
            orderDus,
            statusText
        ];
        row.height = 20;

        row.eachCell((cell, colNumber) => {
            cell.font = {
                name: 'Arial',
                size: 9.5,
                color: { argb: fontColor },
                bold: (colNumber === 2 || colNumber === 10 || item.qtyStock <= 0)
            };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBgColor } };
            cell.border = thinBorder;

            // Perataan kolom
            if (colNumber === 1 || colNumber === 2 || colNumber === 3 || colNumber === 4 || colNumber === 8 || colNumber === 12) {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else if (colNumber === 5) {
                cell.alignment = { horizontal: 'left', vertical: 'middle' };
            } else {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
            }
        });
    });

    // Lebar Kolom Proporsional
    ws.columns = [
        { width: 6 },  // No
        { width: 16 }, // Prioritas
        { width: 10 }, // Ranking
        { width: 14 }, // PLU
        { width: 38 }, // Nama Barang
        { width: 13 }, // Sisa Stok
        { width: 14 }, // Target (PKM)
        { width: 13 }, // Isi Dus (FT)
        { width: 16 }, // Qty Jual
        { width: 15 }, // Order Pcs
        { width: 24 }, // Order Dus
        { width: 22 }  // Status Kritis
    ];

    // Aktifkan Filter Otomatis Excel
    ws.autoFilter = `A5:L${5 + lowStockItems.length}`;

    // ========================================================
    // SHEET 2: RINGKASAN EKSEKUTIF (DASHBOARD)
    // ========================================================
    const ws2 = wb.addWorksheet('Ringkasan Eksekutif');
    ws2.mergeCells('A1:C1');
    const s2Title = ws2.getCell('A1');
    s2Title.value = 'RINGKASAN EKSEKUTIF MONITORING STOK PARETO';
    s2Title.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    s2Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    s2Title.alignment = { horizontal: 'center', vertical: 'middle' };
    ws2.getRow(1).height = 26;

    ws2.mergeCells('A2:C2');
    const s2Sub = ws2.getCell('A2');
    s2Sub.value = `${namaToko} (${kodeToko})`;
    s2Sub.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FFD9E1F2' } };
    s2Sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
    s2Sub.alignment = { horizontal: 'center', vertical: 'middle' };
    ws2.getRow(2).height = 20;

    ws2.getRow(4).values = ['PARAMETER MONITORING', 'JUMLAH (SKU)', 'KETERANGAN & TINDAKAN'];
    ws2.getRow(4).height = 22;
    ws2.getRow(4).eachCell(cell => {
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder;
    });

    const kpis = [
        ['Total Produk Pareto Dianalisa', totalItem, 'Seluruh produk pareto aktif di sistem POS', 'FFFFFFFF'],
        ['Total Produk Membutuhkan Restock', totalKritis, `Produk dengan sisa stok fisik <= ${maxStockThreshold} pcs`, 'FFF2F2F2'],
        ['Stok Habis / Kosong (0 atau minus)', totalKosong, 'Prioritas 1: Segera buatkan PO/PB ke suplier hari ini', 'FFFCE4D6'],
        ['Stok Sangat Kritis (1 s/d 5 pcs)', totalSangatKritis, 'Prioritas 2: Berpotensi habis dalam 1-2 hari ke depan', 'FFFFF2CC'],
        [`Stok Menipis (6 s/d ${maxStockThreshold} pcs)`, totalMenipis, 'Prioritas 3: Persiapan jadwal pemesanan mingguan', 'FFFFFFFF']
    ];

    kpis.forEach((kpi, i) => {
        const r = ws2.getRow(5 + i);
        r.values = [kpi[0], kpi[1], kpi[2]];
        r.height = 22;
        r.eachCell((cell, col) => {
            cell.font = { name: 'Arial', size: 9.5, bold: (col === 2) };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kpi[3] } };
            cell.border = thinBorder;
            cell.alignment = { horizontal: col === 2 ? 'center' : 'left', vertical: 'middle' };
        });
    });

    ws2.columns = [
        { width: 38 },
        { width: 16 },
        { width: 55 }
    ];

    await wb.xlsx.writeFile(outputPath);
    return outputPath;
}

/**
 * Generate ringkasan teks untuk balasan WhatsApp
 */
export function getPbSummaryText(analysisResult, limit = 10, storeInfo = null) {
    const { lowStockItems, totalKritis, totalKosong, totalSangatKritis, totalMenipis, maxStockThreshold = 10, fileName } = analysisResult;
    const namaToko = storeInfo?.nama_toko || storeInfo?.nama || 'OMI TITAN EKSEKUTIF MART';
    const kodeToko = storeInfo?.kode_toko || storeInfo?.kode || 'O8BM';

    let text = `📦 *ANALISA STOK PARETO & REKOMENDASI PB*\n`;
    text += `${namaToko} (${kodeToko})\n`;
    text += `----------------------------------------\n`;
    text += `📁 Sumber: *${fileName}*\n`;
    text += `🎯 Ambang Batas Stok  : *<= ${maxStockThreshold} pcs*\n`;
    text += `🔴 Stok Habis (0)      : *${totalKosong} Item* (Prioritas 1)\n`;
    text += `🟠 Sangat Kritis (1-5) : *${totalSangatKritis} Item* (Prioritas 2)\n`;
    if (maxStockThreshold > 5) {
        text += `🟡 Menipis (6-${maxStockThreshold})     : *${totalMenipis} Item* (Prioritas 3)\n`;
    }
    text += `📊 *Total Perlu Restock: ${totalKritis} Item*\n\n`;

    if (lowStockItems.length === 0) {
        text += `✅ *SEMUA STOK DALAM KONDISI AMAN!*\n`;
        text += `Tidak ada item yang berada di bawah ambang batas stok (<= ${maxStockThreshold} pcs).\n`;
    } else {
        text += `🚨 *TOP ${Math.min(limit, lowStockItems.length)} ITEM PALING URGENT RESTOCK:*\n`;
        lowStockItems.slice(0, limit).forEach((item, idx) => {
            let orderSatuan = `${item.rekomendasiOrder} pcs`;
            if (item.ft > 1 && item.rekomendasiOrder > 0) {
                const dus = Math.ceil(item.rekomendasiOrder / item.ft);
                if (Number.isFinite(dus) && dus > 0) {
                    orderSatuan = `${dus} Dus (${item.rekomendasiOrder} pcs)`;
                }
            }

            text += `${idx + 1}. *${item.nama}* (Rank: #${item.no} | PLU: ${item.plu})\n`;
            text += `   ↳ Sisa Stok: *${item.qtyStock}* | PKM: ${item.pkm} | Rekomendasi: *${orderSatuan}*\n`;
        });
    }

    text += `\n----------------------------------------\n`;
    text += `💡 _Ketik *!pb excel* untuk mengunduh laporan Excel lengkap (tabel terurut dengan fitur filter & estimasi dus)._`;
    return text;
}
