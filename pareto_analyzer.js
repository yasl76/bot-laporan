import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

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
                // Prioritaskan file yang mengandung kata 'pareto'
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

    // Dynamic Header Detection: Memindai 30 baris awal untuk menemukan kolom kunci
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

        // Jika menemukan minimal 3 kata kunci utama (misal PLU, Nama Barang, Qty Stock)
        if (foundKeywords >= 3) {
            headerRowIdx = r;
            break;
        }
    }

    // Fallback jika header terpisah 2 baris (seperti contoh pareto july.xls baris 13-14)
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

        // Lewati baris kosong atau baris total
        if (!plu || !nama || nama.toLowerCase().includes('total') || nama.toLowerCase().includes('grand')) {
            continue;
        }

        const no = parseInt(row[colMap.no]) || (allItems.length + 1);
        const qtyJual = parseFloat(String(row[colMap.qtyJual] || '0').replace(/[^0-9.-]/g, '')) || 0;
        const pkm = parseFloat(String(row[colMap.pkm] || '0').replace(/[^0-9.-]/g, '')) || 0;
        const ft = parseFloat(String(row[colMap.ft] || '0').replace(/[^0-9.-]/g, '')) || 0;
        const rawStock = String(row[colMap.qtyStock] !== undefined ? row[colMap.qtyStock] : '0').replace(/[^0-9.-]/g, '');
        const qtyStock = parseFloat(rawStock) || 0;

        // Hitung estimasi rekomendasi order PB
        let rekomendasiOrder = 0;
        if (pkm > qtyStock) {
            rekomendasiOrder = Math.ceil(pkm - qtyStock);
        } else if (qtyStock <= 5) {
            rekomendasiOrder = Math.max(10 - qtyStock, 5);
        }

        let statusKritis = 'AMAN';
        if (qtyStock <= 0) {
            statusKritis = '🔴 KOSONG / HABIS';
        } else if (qtyStock <= 5) {
            statusKritis = '🟠 SANGAT KRITIS (<= 5)';
        } else if (qtyStock <= maxStockThreshold) {
            statusKritis = '🟡 MENIPIS (<= 10)';
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
            statusKritis
        };

        allItems.push(item);
        if (qtyStock <= maxStockThreshold) {
            lowStockItems.push(item);
        }
    }

    // Urutkan barang kritis: stok 0 teratas, lalu berdasarkan ranking pareto
    lowStockItems.sort((a, b) => {
        if (a.qtyStock === b.qtyStock) return a.no - b.no;
        return a.qtyStock - b.qtyStock;
    });

    return {
        totalItem: allItems.length,
        totalKritis: lowStockItems.length,
        totalKosong: lowStockItems.filter(i => i.qtyStock <= 0).length,
        lowStockItems,
        fileName: path.basename(filePath)
    };
}

/**
 * Generate File Excel Rekomendasi PB (Permintaan Barang)
 */
export function generatePbExcel(analysisResult, outputPath = 'Laporan_PB_Pareto.xlsx') {
    const { lowStockItems, totalItem, totalKritis, totalKosong, fileName } = analysisResult;

    const dataExcel = [];

    // Header Laporan
    dataExcel.push(['REKOMENDASI PERMINTAAN BARANG (PB) - ANALISA STOK PARETO']);
    dataExcel.push(['NAMA TOKO: OMI TITAN EKSEKUTIF MART (O8BM)']);
    dataExcel.push([`File Sumber: ${fileName} | Tanggal Generate: ${new Date().toLocaleDateString('id-ID')} ${new Date().toLocaleTimeString('id-ID')}`]);
    dataExcel.push([`Total Item Pareto: ${totalItem} | Stok Kritis (<= 10): ${totalKritis} Item | Stok Kosong (0): ${totalKosong} Item`]);
    dataExcel.push([]); // Baris kosong

    // Header Kolom Tabel
    dataExcel.push([
        'No.',
        'Ranking Pareto',
        'Kode PLU',
        'Nama Barang',
        'Sisa Stok Toko',
        'PKM',
        'Fraction (FT)',
        'Qty Penjualan',
        'Rekomendasi Order (Pcs)',
        'Status Kritis'
    ]);

    // Data Baris
    lowStockItems.forEach((item, index) => {
        dataExcel.push([
            index + 1,
            item.no,
            item.plu,
            item.nama,
            item.qtyStock,
            item.pkm,
            item.ft,
            item.qtyJual,
            item.rekomendasiOrder,
            item.statusKritis
        ]);
    });

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet(dataExcel);

    // Atur Lebar Kolom agar rapi saat dibuka di Microsoft Excel
    ws['!cols'] = [
        { wch: 6 },  // No.
        { wch: 15 }, // Ranking
        { wch: 15 }, // PLU
        { wch: 35 }, // Nama Barang
        { wch: 15 }, // Sisa Stok
        { wch: 10 }, // PKM
        { wch: 12 }, // FT
        { wch: 15 }, // Qty Jual
        { wch: 22 }, // Rekomendasi Order
        { wch: 24 }  // Status Kritis
    ];

    xlsx.utils.book_append_sheet(wb, ws, 'Rekomendasi PB Pareto');
    xlsx.writeFile(wb, outputPath);
    return outputPath;
}

/**
 * Generate ringkasan teks untuk balasan WhatsApp
 */
export function getPbSummaryText(analysisResult, limit = 10) {
    const { lowStockItems, totalKritis, totalKosong, fileName } = analysisResult;

    let text = `📦 *ANALISA STOK PARETO & REKOMENDASI PB*\n`;
    text += `----------------------------------------\n`;
    text += `📁 Sumber: *${fileName}*\n`;
    text += `🔴 Stok Kosong (0) : *${totalKosong} Item*\n`;
    text += `🟡 Stok Menipis (<=10) : *${totalKritis} Item*\n\n`;

    text += `🚨 *TOP ${Math.min(limit, lowStockItems.length)} ITEM PALING KRITIS RESTOCK:*\n`;
    lowStockItems.slice(0, limit).forEach((item, idx) => {
        text += `${idx + 1}. *${item.nama}* (PLU: ${item.plu})\n`;
        text += `   ↳ Sisa Stok: *${item.qtyStock}* | PKM: ${item.pkm} | Rekomendasi PB: *${item.rekomendasiOrder} pcs*\n`;
    });

    text += `\n----------------------------------------\n`;
    text += `💡 _Ketik *!pb excel* untuk mengunduh laporan Excel lengkap (${totalKritis} item) siap kirim ke supplier._`;
    return text;
}
