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

        if (!plu || !nama || nama.toLowerCase().includes('total') || nama.toLowerCase().includes('grand')) {
            continue;
        }

        const no = parseInt(row[colMap.no]) || (allItems.length + 1);
        const qtyJual = parseFloat(String(row[colMap.qtyJual] || '0').replace(/[^0-9.-]/g, '')) || 0;
        const pkm = parseFloat(String(row[colMap.pkm] || '0').replace(/[^0-9.-]/g, '')) || 0;
        const ft = parseFloat(String(row[colMap.ft] || '0').replace(/[^0-9.-]/g, '')) || 0;
        const rawStock = String(row[colMap.qtyStock] !== undefined ? row[colMap.qtyStock] : '0').replace(/[^0-9.-]/g, '');
        const qtyStock = parseFloat(rawStock) || 0;

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
            statusKritis = '🟡 MENIPIS (6-10)';
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
    const totalSangatKritis = lowStockItems.filter(i => i.qtyStock > 0 && i.qtyStock <= 5).length;
    const totalMenipis = lowStockItems.filter(i => i.qtyStock > 5 && i.qtyStock <= maxStockThreshold).length;

    return {
        totalItem: allItems.length,
        totalKritis: lowStockItems.length,
        totalKosong,
        totalSangatKritis,
        totalMenipis,
        lowStockItems,
        fileName: path.basename(filePath)
    };
}

/**
 * Generate File Excel Rekomendasi PB yang Sangat Rapi & Profesional
 */
export function generatePbExcel(analysisResult, outputPath = 'Laporan_PB_Pareto.xlsx') {
    const { lowStockItems, totalItem, totalKritis, totalKosong, totalSangatKritis, totalMenipis, fileName } = analysisResult;

    const wb = xlsx.utils.book_new();

    // ========================================================
    // SHEET 1: DAFTAR REKOMENDASI ORDER PB (TABEL UTAMA)
    // ========================================================
    const rowsUtama = [];

    // Header Judul Dokumen
    rowsUtama.push(['DAFTAR REKOMENDASI PERMINTAAN BARANG (PB) - ANALISA STOK PARETO']);
    rowsUtama.push(['OMI TITAN EKSEKUTIF MART (KODE: O8BM) - CABANG BEKASI']);
    rowsUtama.push([`File Sumber: ${fileName} | Tanggal Dibuat: ${new Date().toLocaleDateString('id-ID')} ${new Date().toLocaleTimeString('id-ID')}`]);
    rowsUtama.push([`Ringkasan: ${totalItem} Total SKU | ${totalKritis} Butuh Restock (${totalKosong} Habis, ${totalSangatKritis} Sangat Kritis, ${totalMenipis} Menipis)`]);
    rowsUtama.push([]); // Baris kosong pemisah

    // Baris Header Kolom Tabel
    rowsUtama.push([
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
        'Estimasi Order (Dus/Karton)',
        'Status Kritis'
    ]);

    // Data Baris
    lowStockItems.forEach((item, index) => {
        let labelPrioritas = '3. Menipis';
        if (item.prioritasLevel === 1) labelPrioritas = '1. URGENT (HABIS)';
        else if (item.prioritasLevel === 2) labelPrioritas = '2. SEGERA (1-5)';

        // Hitung estimasi order dus jika FT tersedia
        let orderDus = `${item.rekomendasiOrder} Pcs`;
        if (item.ft > 1 && item.rekomendasiOrder > 0) {
            const jumlahDus = Math.ceil(item.rekomendasiOrder / item.ft);
            orderDus = `${jumlahDus} Dus (${item.rekomendasiOrder} Pcs)`;
        }

        rowsUtama.push([
            index + 1,
            labelPrioritas,
            item.no,
            String(item.plu), // Pastikan PLU tersimpan sebagai teks agar angka 0 di depan tidak hilang
            item.nama,
            item.qtyStock,
            item.pkm || 0,
            item.ft > 0 ? item.ft : '-',
            item.qtyJual || 0,
            item.rekomendasiOrder,
            orderDus,
            item.statusKritis
        ]);
    });

    const wsUtama = xlsx.utils.aoa_to_sheet(rowsUtama);

    // Pengaturan Lebar Kolom Presisi agar tidak terpotong (###)
    wsUtama['!cols'] = [
        { wch: 6 },  // No.
        { wch: 18 }, // Prioritas
        { wch: 10 }, // Ranking
        { wch: 14 }, // Kode PLU
        { wch: 38 }, // Nama Barang
        { wch: 12 }, // Sisa Stok
        { wch: 13 }, // Target (PKM)
        { wch: 14 }, // Isi/Dus (FT)
        { wch: 16 }, // Penjualan (Qty)
        { wch: 14 }, // Order (Pcs)
        { wch: 25 }, // Estimasi Order (Dus)
        { wch: 25 }  // Status Kritis
    ];

    // Aktifkan Fitur AutoFilter Excel pada baris header (Baris 6)
    wsUtama['!autofilter'] = { ref: `A6:L${rowsUtama.length}` };

    xlsx.utils.book_append_sheet(wb, wsUtama, 'Daftar Order PB Pareto');

    // ========================================================
    // SHEET 2: RINGKASAN EKSEKUTIF / DASHBOARD STOK
    // ========================================================
    let totalPcsOrder = 0;
    lowStockItems.forEach(i => { totalPcsOrder += (i.rekomendasiOrder || 0); });

    const rowsSummary = [
        ['RINGKASAN EKSEKUTIF MONITORING STOK PARETO'],
        ['OMI TITAN EKSEKUTIF MART (O8BM)'],
        [`Tanggal Analisa: ${new Date().toLocaleDateString('id-ID')} ${new Date().toLocaleTimeString('id-ID')}`],
        [],
        ['PARAMETER MONITORING', 'JUMLAH (SKU)', 'KETERANGAN & TINDAKAN'],
        ['Total Produk Pareto Dianalisa', totalItem, 'Seluruh produk pareto aktif di sistem POS'],
        ['Total Produk Membutuhkan Restock', totalKritis, 'Produk dengan sisa stok fisik <= 10 pcs'],
        ['Stok Habis / Kosong (0 atau minus)', totalKosong, 'Prioritas 1: Segera buatkan PO/PB ke suplier hari ini'],
        ['Stok Sangat Kritis (1 s/d 5 pcs)', totalSangatKritis, 'Prioritas 2: Berpotensi habis dalam 1-2 hari ke depan'],
        ['Stok Menipis (6 s/d 10 pcs)', totalMenipis, 'Prioritas 3: Persiapan jadwal pemesanan mingguan'],
        [],
        ['ESTIMASI KUANTITAS PEMESANAN', 'JUMLAH (PCS)', 'KETERANGAN'],
        ['Total Estimasi Order PB', totalPcsOrder, 'Akumulasi kuantitas barang yang direkomendasikan']
    ];

    const wsSummary = xlsx.utils.aoa_to_sheet(rowsSummary);
    wsSummary['!cols'] = [
        { wch: 38 },
        { wch: 16 },
        { wch: 45 }
    ];

    xlsx.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Eksekutif');

    xlsx.writeFile(wb, outputPath);
    return outputPath;
}

/**
 * Generate ringkasan teks untuk balasan WhatsApp
 */
export function getPbSummaryText(analysisResult, limit = 10) {
    const { lowStockItems, totalKritis, totalKosong, totalSangatKritis, fileName } = analysisResult;

    let text = `📦 *ANALISA STOK PARETO & REKOMENDASI PB*\n`;
    text += `OMI TITAN EKSEKUTIF MART (O8BM)\n`;
    text += `----------------------------------------\n`;
    text += `📁 Sumber: *${fileName}*\n`;
    text += `🔴 Stok Habis (0)       : *${totalKosong} Item* (Prioritas 1)\n`;
    text += `🟠 Sangat Kritis (1-5) : *${totalSangatKritis} Item* (Prioritas 2)\n`;
    text += `🟡 Total Perlu Restock : *${totalKritis} Item*\n\n`;

    text += `🚨 *TOP ${Math.min(limit, lowStockItems.length)} ITEM PALING URGENT RESTOCK:*\n`;
    lowStockItems.slice(0, limit).forEach((item, idx) => {
        let orderSatuan = `${item.rekomendasiOrder} pcs`;
        if (item.ft > 1) {
            const dus = Math.ceil(item.rekomendasiOrder / item.ft);
            orderSatuan = `${dus} Dus (${item.rekomendasiOrder} pcs)`;
        }

        text += `${idx + 1}. *${item.nama}* (Rank: #${item.no} | PLU: ${item.plu})\n`;
        text += `   ↳ Sisa Stok: *${item.qtyStock}* | PKM: ${item.pkm} | Rekomendasi: *${orderSatuan}*\n`;
    });

    text += `\n----------------------------------------\n`;
    text += `💡 _Ketik *!pb excel* untuk mengunduh laporan Excel lengkap (tabel terurut dengan fitur filter & estimasi dus)._`;
    return text;
}
