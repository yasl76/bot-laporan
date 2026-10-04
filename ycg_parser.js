import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';

/**
 * Deteksi tanggal secara cerdas dari nama file atau isi sheet.
 * Format yang didukung:
 * - DD-MM-YYYY (cth: "Y COFFEE 03-10-2026.xls" -> day 3, month 10, year 2026)
 * - YYYY-MM-DD (cth: "report_2026-10-03.xlsx" -> day 3, month 10, year 2026)
 * - Header sheet "Tgl.Cetak : 10/3/2026"
 * - Fallback ke tanggal hari ini
 */
export function extractDateFromFilenameOrHeader(fileName = '', rows = []) {
    // 1. Filename format ISO YYYY-MM-DD
    const isoMatch = fileName.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})/);
    if (isoMatch) {
        return {
            day: parseInt(isoMatch[3], 10),
            month: parseInt(isoMatch[2], 10),
            year: parseInt(isoMatch[1], 10),
            source: 'filename_iso'
        };
    }

    // 2. Filename format DD-MM-YYYY (standar Indonesia)
    const dmyMatch = fileName.match(/(?:^|[^\d])(\d{1,2})[-_](\d{1,2})[-_](\d{4})(?:[^\d]|$)/);
    if (dmyMatch) {
        return {
            day: parseInt(dmyMatch[1], 10),
            month: parseInt(dmyMatch[2], 10),
            year: parseInt(dmyMatch[3], 10),
            source: 'filename_dmy'
        };
    }

    // 3. Header sheet check (cth: Tgl.Cetak : 10/3/2026)
    if (Array.isArray(rows)) {
        for (let r = 0; r < Math.min(rows.length, 15); r++) {
            const row = rows[r];
            if (!row) continue;
            for (const cell of row) {
                if (typeof cell !== 'string') continue;
                const tglMatch = cell.match(/Tgl\.?\s*Cetak\s*:\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i);
                if (tglMatch) {
                    const p1 = parseInt(tglMatch[1], 10);
                    const p2 = parseInt(tglMatch[2], 10);
                    const p3 = parseInt(tglMatch[3], 10);

                    // Deteksi nama bulan dari sheet jika ada (cth: October)
                    let detectedMonth = null;
                    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
                    for (let r2 = 0; r2 < Math.min(rows.length, 15); r2++) {
                        const row2Text = (rows[r2] || []).join(' ').toLowerCase();
                        for (let m = 0; m < months.length; m++) {
                            if (row2Text.includes(months[m])) {
                                detectedMonth = m + 1;
                                break;
                            }
                        }
                        if (detectedMonth) break;
                    }

                    if (detectedMonth) {
                        const day = (p1 === detectedMonth) ? p2 : p1;
                        return { day, month: detectedMonth, year: p3, source: 'header' };
                    }

                    // Standar format tanggal POS di Indonesia: jika p1 > 12 maka p1 adalah hari
                    if (p1 > 12) {
                        return { day: p1, month: p2, year: p3, source: 'header' };
                    } else if (p2 > 12) {
                        return { day: p2, month: p1, year: p3, source: 'header' };
                    } else {
                        return { day: p2, month: p1, year: p3, source: 'header' };
                    }
                }
            }
        }
    }

    // 4. Filename single day check, cth: "Y COFFEE 3.xls"
    const singleDayMatch = fileName.match(/(?:coffee|ycg|sosis|rte)[^\d]*(\d{1,2})(?:\.|\b)/i);
    if (singleDayMatch) {
        const d = parseInt(singleDayMatch[1], 10);
        if (d >= 1 && d <= 31) {
            return { day: d, month: new Date().getMonth() + 1, year: new Date().getFullYear(), source: 'filename_day' };
        }
    }

    // 5. Fallback ke tanggal hari ini
    const now = new Date();
    return { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear(), source: 'today_fallback' };
}

/**
 * Memeriksa apakah file adalah file laporan YCG (Coffee) atau Sosis RTE.
 */
export function isYcgOrSosisFile(filePath, rawFileName = '') {
    const fileName = (rawFileName || (typeof filePath === 'string' ? path.basename(filePath) : '')).toLowerCase();
    if (
        fileName.includes('ycg') ||
        fileName.includes('coffee') ||
        fileName.includes('kopi') ||
        fileName.includes('sosis') ||
        fileName.includes('sausage') ||
        fileName.includes('rte')
    ) {
        return true;
    }

    if (filePath && typeof filePath === 'string' && fs.existsSync(filePath)) {
        try {
            const wb = xlsx.readFile(filePath);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            for (let r = 0; r < Math.min(rows.length, 15); r++) {
                const rowText = (rows[r] || []).join(' ').toLowerCase();
                if (
                    rowText.includes('y/coffee') ||
                    rowText.includes('y coffee') ||
                    rowText.includes('yccg') ||
                    rowText.includes('sosis') ||
                    rowText.includes('rte')
                ) {
                    return true;
                }
            }
        } catch (_) {}
    }
    return false;
}

/**
 * Parsing file Excel YCG / Sosis untuk mengekstrak jumlah terjual per varian pada tanggal tertentu.
 */
export function parseYcgOrSosisExcel(filePathOrBuffer, options = {}) {
    let wb;
    if (typeof filePathOrBuffer === 'string') {
        if (!fs.existsSync(filePathOrBuffer)) {
            throw new Error(`File tidak ditemukan: ${filePathOrBuffer}`);
        }
        wb = xlsx.readFile(filePathOrBuffer);
    } else {
        wb = xlsx.read(filePathOrBuffer, { type: 'buffer' });
    }

    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const merges = sheet['!merges'] || [];

    const fileName = options.fileName || (typeof filePathOrBuffer === 'string' ? path.basename(filePathOrBuffer) : '');
    const dateInfo = extractDateFromFilenameOrHeader(fileName, rows);
    const targetDay = options.targetDay || dateInfo.day;

    let isYcg = false;
    let isSosis = false;

    // Deteksi judul laporan di 15 baris pertama
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const rowText = (rows[r] || []).join(' ').toLowerCase();
        if (rowText.includes('y/coffee') || rowText.includes('y coffee') || rowText.includes('yccg')) {
            isYcg = true;
        }
        if (rowText.includes('sosis') || rowText.includes('sausage') || rowText.includes('rte')) {
            isSosis = true;
        }
    }

    if (!isYcg && !isSosis) {
        const lowerName = fileName.toLowerCase();
        if (lowerName.includes('coffee') || lowerName.includes('ycg') || lowerName.includes('kopi')) isYcg = true;
        if (lowerName.includes('sosis') || lowerName.includes('rte') || lowerName.includes('sausage')) isSosis = true;
    }

    // Pencarian baris header tanggal (1..31)
    let dateHeaderRowIdx = -1;
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;
        let dayMatches = 0;
        for (let day = 1; day <= 10; day++) {
            if (row.some(c => String(c).trim() === String(day))) {
                dayMatches++;
            }
        }
        if (dayMatches >= 2) {
            dateHeaderRowIdx = r;
            break;
        }
    }

    if (dateHeaderRowIdx === -1) {
        throw new Error('Tidak dapat menemukan baris header tanggal (1..31) pada file Excel.');
    }

    const dateHeaderRow = rows[dateHeaderRowIdx];
    const hCol = dateHeaderRow.findIndex(c => String(c).trim() === String(targetDay));

    if (hCol === -1) {
        throw new Error(`Tanggal ${targetDay} tidak ditemukan dalam kolom header laporan.`);
    }

    // Penentuan kolom data dengan memperhitungkan merge cells
    let dataCol = hCol;
    const m = merges.find(m => m.s.c <= hCol && m.e.c >= hCol && m.s.r > dateHeaderRowIdx);
    if (m) {
        dataCol = m.s.c;
    }

    let yccgTotal = 0;
    let sosisOriTotal = 0;
    let sosisKejuTotal = 0;
    let foundSosisItems = false;
    let foundCoffeeItems = false;
    const items = [];

    for (let r = dateHeaderRowIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;

        // Cek nomor urut di awal baris
        const cellNo = row[0];
        const isItemRow = cellNo !== '' && cellNo !== null && cellNo !== undefined && !isNaN(parseInt(cellNo, 10)) && parseInt(cellNo, 10) > 0;
        if (!isItemRow) continue;

        const no = parseInt(cellNo, 10);
        // Cari PLU (string angka) di kolom 1..6
        let plu = '';
        for (let c = 1; c <= 6; c++) {
            if (row[c] && /^\d+$/.test(String(row[c]).trim())) {
                plu = String(row[c]).trim();
                break;
            }
        }

        // Cari Deskripsi (string berisi huruf) di kolom 4..12
        let desc = '';
        for (let c = 4; c <= 12; c++) {
            if (row[c] && typeof row[c] === 'string' && /[a-zA-Z]/.test(row[c])) {
                desc = row[c].trim();
                break;
            }
        }

        if (!desc || desc.toLowerCase().includes('total') || desc.toLowerCase().includes('grand')) {
            continue;
        }

        let qtyVal = row[dataCol];
        if (qtyVal === undefined || qtyVal === null || qtyVal === '') {
            if (row[hCol] !== undefined && row[hCol] !== null && row[hCol] !== '') {
                qtyVal = row[hCol];
            } else if (dataCol > 0 && row[dataCol - 1] !== undefined && row[dataCol - 1] !== null && row[dataCol - 1] !== '') {
                qtyVal = row[dataCol - 1];
            } else {
                qtyVal = 0;
            }
        }
        const qty = typeof qtyVal === 'number' ? qtyVal : (parseInt(qtyVal, 10) || 0);

        items.push({ no, plu, desc, qty });

        const lowerDesc = desc.toLowerCase();
        if (lowerDesc.includes('sosis') || lowerDesc.includes('sausage')) {
            foundSosisItems = true;
            if (lowerDesc.includes('keju') || lowerDesc.includes('cheese')) {
                sosisKejuTotal += qty;
            } else {
                sosisOriTotal += qty;
            }
        } else {
            foundCoffeeItems = true;
            yccgTotal += qty;
        }
    }

    if (foundSosisItems) isSosis = true;
    if (foundCoffeeItems || (!foundSosisItems && items.length > 0)) isYcg = true;

    const detectedDateStr = `${String(targetDay).padStart(2, '0')}-${String(dateInfo.month).padStart(2, '0')}-${dateInfo.year}`;

    return {
        isYcg,
        isSosis,
        targetDay,
        detectedDateStr,
        yccg: isYcg ? yccgTotal : null,
        sosisOri: isSosis ? sosisOriTotal : null,
        sosisKeju: isSosis ? sosisKejuTotal : null,
        totalRte: isSosis ? (sosisOriTotal + sosisKejuTotal) : null,
        itemCount: items.length,
        items
    };
}
