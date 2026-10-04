import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';

const MONTH_NAMES = {
    'januari': 1, 'january': 1, 'jan': 1,
    'februari': 2, 'february': 2, 'feb': 2,
    'maret': 3, 'march': 3, 'mar': 3,
    'april': 4, 'apr': 4,
    'mei': 5, 'may': 5,
    'juni': 6, 'june': 6, 'jun': 6,
    'juli': 7, 'july': 7, 'jul': 7,
    'agustus': 8, 'august': 8, 'ags': 8, 'agu': 8, 'aug': 8,
    'september': 9, 'sep': 9, 'sept': 9,
    'oktober': 10, 'october': 10, 'okt': 10, 'oct': 10,
    'november': 11, 'nov': 11,
    'desember': 12, 'december': 12, 'des': 12, 'dec': 12
};

/**
 * Deteksi tanggal secara cerdas dari nama file atau isi sheet.
 * Format yang didukung:
 * - DD-MM-YYYY / DD.MM.YYYY / DD_MM_YYYY (cth: "Y COFFEE 03-10-2026.xls" -> day 3, month 10, year 2026)
 * - DD NamaBulan YYYY (cth: "Y COFFEE 3 Oktober 2026.xls" -> day 3, month 10, year 2026)
 * - YYYY-MM-DD (cth: "report_2026-10-03.xlsx" -> day 3, month 10, year 2026)
 * - Compact YYYYMMDD (cth: "report_20261003.xls" -> day 3, month 10, year 2026)
 * - Header sheet "Tgl.Cetak : 10/3/2026"
 * - Fallback ke tanggal hari ini
 */
export function extractDateFromFilenameOrHeader(fileName = '', rows = []) {
    // 1. Filename format ISO YYYY-MM-DD
    const isoMatch = fileName.match(/(\d{4})[-_. ](\d{1,2})[-_. ](\d{1,2})/);
    if (isoMatch) {
        return {
            day: parseInt(isoMatch[3], 10),
            month: parseInt(isoMatch[2], 10),
            year: parseInt(isoMatch[1], 10),
            source: 'filename_iso'
        };
    }

    // 2. Filename format DD-MM-YYYY (standar Indonesia)
    const dmyMatch = fileName.match(/(?:^|[^\d])(\d{1,2})[-_. ](\d{1,2})[-_. ](\d{4})(?:[^\d]|$)/);
    if (dmyMatch) {
        return {
            day: parseInt(dmyMatch[1], 10),
            month: parseInt(dmyMatch[2], 10),
            year: parseInt(dmyMatch[3], 10),
            source: 'filename_dmy'
        };
    }

    // 3. Filename format DD NamaBulan YYYY (cth: "3 Oktober 2026")
    const dmyTextMatch = fileName.match(/(?:^|[^\d])(\d{1,2})[-_. ]([a-zA-Z]{3,10})[-_. ](\d{4})(?:[^\d]|$)/);
    if (dmyTextMatch) {
        const monthWord = dmyTextMatch[2].toLowerCase();
        if (MONTH_NAMES[monthWord]) {
            return {
                day: parseInt(dmyTextMatch[1], 10),
                month: MONTH_NAMES[monthWord],
                year: parseInt(dmyTextMatch[3], 10),
                source: 'filename_dmy_text'
            };
        }
    }

    // 4. Filename format Compact ISO YYYYMMDD (cth: 20261003)
    const compactIsoMatch = fileName.match(/(?:^|[^\d])(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[^\d]|$)/);
    if (compactIsoMatch) {
        return {
            day: parseInt(compactIsoMatch[3], 10),
            month: parseInt(compactIsoMatch[2], 10),
            year: parseInt(compactIsoMatch[1], 10),
            source: 'filename_compact_iso'
        };
    }

    // 5. Header sheet check (cth: Tgl.Cetak : 10/3/2026 atau 3/10/2026)
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

                    // Deteksi nama bulan dari sheet jika ada (cth: October atau Oktober)
                    let detectedMonth = null;
                    for (let r2 = 0; r2 < Math.min(rows.length, 15); r2++) {
                        const row2Text = (rows[r2] || []).join(' ').toLowerCase();
                        for (const [mName, mNum] of Object.entries(MONTH_NAMES)) {
                            if (mName.length >= 4 && row2Text.includes(mName)) {
                                detectedMonth = mNum;
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

    // 6. Filename single day check, cth: "Y COFFEE 3.xls"
    const singleDayMatch = fileName.match(/(?:coffee|ycg|sosis|rte)[^\d]*(\d{1,2})(?:\.|\b)/i);
    if (singleDayMatch) {
        const d = parseInt(singleDayMatch[1], 10);
        if (d >= 1 && d <= 31) {
            return { day: d, month: new Date().getMonth() + 1, year: new Date().getFullYear(), source: 'filename_day' };
        }
    }

    // 7. Fallback ke tanggal hari ini
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

    let initialIsYcg = false;
    let initialIsSosis = false;

    // Deteksi judul laporan di 15 baris pertama
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const rowText = (rows[r] || []).join(' ').toLowerCase();
        if (rowText.includes('y/coffee') || rowText.includes('y coffee') || rowText.includes('yccg')) {
            initialIsYcg = true;
        }
        if (rowText.includes('sosis') || rowText.includes('sausage') || rowText.includes('rte')) {
            initialIsSosis = true;
        }
    }

    if (!initialIsYcg && !initialIsSosis) {
        const lowerName = fileName.toLowerCase();
        if (lowerName.includes('coffee') || lowerName.includes('ycg') || lowerName.includes('kopi')) initialIsYcg = true;
        if (lowerName.includes('sosis') || lowerName.includes('rte') || lowerName.includes('sausage')) initialIsSosis = true;
    }

    // Pencarian baris header tanggal (1..31)
    let dateHeaderRowIdx = -1;
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;
        let dayMatches = 0;
        for (let day = 1; day <= 10; day++) {
            if (row.some(c => {
                const s = String(c).trim();
                const v = parseInt(s, 10);
                return !isNaN(v) && v === day;
            })) {
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
    const hCol = dateHeaderRow.findIndex(c => {
        const str = String(c).trim();
        if (!str) return false;
        const v = parseInt(str, 10);
        return !isNaN(v) && v === targetDay && (str === String(targetDay) || str === String(targetDay).padStart(2, '0'));
    });

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

        // Cek nomor urut di kolom 0 atau kolom 1
        let cellNo = row[0];
        let no = parseInt(cellNo, 10);
        let noCol = 0;
        if (isNaN(no) || no <= 0) {
            cellNo = row[1];
            no = parseInt(cellNo, 10);
            if (!isNaN(no) && no > 0) {
                noCol = 1;
            }
        }
        if (isNaN(no) || no <= 0) continue;

        // Cari PLU (string angka) di kolom noCol+1..6
        let plu = '';
        let pluCol = -1;
        for (let c = noCol + 1; c <= 6; c++) {
            if (row[c] && /^\d+$/.test(String(row[c]).trim())) {
                plu = String(row[c]).trim();
                pluCol = c;
                break;
            }
        }

        // Cari Deskripsi (string berisi huruf) dari kolom 1 s/d kolom sebelum tanggal
        let desc = '';
        for (let c = 1; c < Math.min(hCol, 15); c++) {
            if (c === pluCol || c === noCol) continue;
            const val = row[c];
            if (val && typeof val === 'string' && /[a-zA-Z]/.test(val) && !val.trim().match(/^\d+$/)) {
                const candidate = val.trim();
                if (candidate.length > 2) {
                    desc = candidate;
                    break;
                }
            }
        }

        if (!desc || desc.toLowerCase().includes('total') || desc.toLowerCase().includes('grand')) {
            continue;
        }

        let qtyVal = row[dataCol];
        if (qtyVal === undefined || qtyVal === null || qtyVal === '') {
            if (m) {
                for (let mc = m.s.c; mc <= m.e.c; mc++) {
                    if (row[mc] !== undefined && row[mc] !== null && row[mc] !== '') {
                        qtyVal = row[mc];
                        break;
                    }
                }
            }
            if (qtyVal === undefined || qtyVal === null || qtyVal === '') {
                if (row[hCol] !== undefined && row[hCol] !== null && row[hCol] !== '') {
                    qtyVal = row[hCol];
                } else if (dataCol > 0 && row[dataCol - 1] !== undefined && row[dataCol - 1] !== null && row[dataCol - 1] !== '') {
                    qtyVal = row[dataCol - 1];
                } else {
                    qtyVal = 0;
                }
            }
        }
        const qty = typeof qtyVal === 'number' ? qtyVal : (parseInt(qtyVal, 10) || 0);

        items.push({ no, plu, desc, qty });

        const lowerDesc = desc.toLowerCase();
        if (initialIsSosis && !initialIsYcg) {
            // File khusus laporan Sosis RTE: hanya hitung varian sosis
            if (lowerDesc.includes('keju') || lowerDesc.includes('cheese')) {
                foundSosisItems = true;
                sosisKejuTotal += qty;
            } else if (
                lowerDesc.includes('sosis') ||
                lowerDesc.includes('sausage') ||
                lowerDesc.includes('ori') ||
                lowerDesc.includes('original')
            ) {
                foundSosisItems = true;
                sosisOriTotal += qty;
            }
            // Item pelengkap lain seperti saos/kemasan diabaikan dan tidak dimasukkan ke kopi
        } else if (initialIsYcg && !initialIsSosis) {
            // File khusus laporan YCG Coffee
            foundCoffeeItems = true;
            yccgTotal += qty;
        } else {
            // File gabungan atau auto-deteksi
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
    }

    let isYcg = initialIsYcg || foundCoffeeItems;
    let isSosis = initialIsSosis || foundSosisItems;

    if (initialIsSosis && !initialIsYcg) {
        isYcg = false;
        isSosis = true;
    } else if (initialIsYcg && !initialIsSosis) {
        isYcg = true;
        isSosis = false;
    }

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
