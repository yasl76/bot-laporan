/**
 * src/formatters.js
 * Centralized formatting, numeric sanitization, and date calculation utilities.
 */

/**
 * Validates and converts input into a valid Date object.
 * Fallbacks to new Date() if invalid or undefined.
 * @param {Date|string|number} [d]
 * @returns {Date}
 */
function toValidDate(d) {
    if (d === undefined || d === null) return new Date();
    if (d instanceof Date) {
        return isNaN(d.getTime()) ? new Date() : d;
    }
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Parse float safely with Indonesian comma decimal support ('21,50' -> 21.50).
 * Handles thousand-separators, mixed dots and commas, negative values, and non-numeric inputs.
 * @param {string|number} val
 * @returns {number}
 */
export function parseSafeFloat(val) {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    let str = String(val).trim();
    if (!str) return 0;

    // Both dots and commas present
    if (str.includes(',') && str.includes('.')) {
        if (str.indexOf('.') < str.indexOf(',')) {
            // e.g. "1.500,75" -> dot is thousand separator, comma is decimal
            str = str.replace(/\./g, '').replace(',', '.');
        } else {
            // e.g. "1,500.75" -> comma is thousand separator, dot is decimal
            str = str.replace(/,/g, '');
        }
    } else if (str.includes(',')) {
        // Only commas present
        const commaCount = (str.match(/,/g) || []).length;
        if (commaCount === 1) {
            // Single comma: decimal separator in Indonesian (e.g. "21,00", "12,5")
            str = str.replace(',', '.');
        } else {
            // Multiple commas: thousand separators (e.g. "1,500,000")
            str = str.replace(/,/g, '');
        }
    } else if ((str.match(/\./g) || []).length > 1) {
        // Multiple dots without comma: thousand separators (e.g. "1.500.000")
        str = str.replace(/\./g, '');
    }

    const clean = str.replace(/[^0-9.-]/g, '');
    const num = parseFloat(clean);
    return Number.isFinite(num) ? num : 0;
}

/**
 * Parse monetary / quantity strings by stripping non-numeric characters.
 * Extracts digits from string, returns float/number, returns 0 for invalid/empty inputs.
 * @param {string|number} val
 * @returns {number}
 */
export function parseNominal(val) {
    if (val === undefined || val === null) return 0;
    const clean = String(val).replace(/[^0-9]/g, '');
    return clean ? parseFloat(clean) : 0;
}

/**
 * Formats a number to Indonesian Rupiah string (e.g., 4725000 -> "4.725.000").
 * Safely handles 0, null, undefined, NaN, negative values, and string inputs.
 * @param {number|string} val
 * @returns {string}
 */
export function formatRp(val) {
    if (val === undefined || val === null) return '0';
    let num;
    if (typeof val === 'number') {
        num = val;
    } else {
        const str = String(val).trim();
        if (!str) return '0';
        num = parseSafeFloat(str);
        if (num === 0 && !/^[-+]?0+([.,]0+)?$/.test(str)) {
            const isNegative = str.startsWith('-');
            const nominal = parseNominal(str);
            num = isNegative ? -nominal : nominal;
        }
    }
    if (!Number.isFinite(num) || isNaN(num)) return '0';
    const rounded = Math.round(num);
    const safeInt = Object.is(rounded, -0) ? 0 : rounded;
    return new Intl.NumberFormat('id-ID').format(safeInt);
}

/**
 * Computes achievement percentage ((actual / target) * 100).toFixed(2).
 * Safely returns "0.00" if target <= 0 or invalid.
 * @param {number|string} actual
 * @param {number|string} target
 * @returns {string} Two-decimal percentage string (e.g. "100.50" or "0.00")
 */
export function calculateAch(actual, target) {
    const numActual = typeof actual === 'number' ? actual : (parseSafeFloat(actual) || 0);
    const numTarget = typeof target === 'number' ? target : (parseSafeFloat(target) || 0);

    if (!Number.isFinite(numTarget) || numTarget <= 0) {
        return '0.00';
    }
    if (!Number.isFinite(numActual)) {
        return '0.00';
    }

    const ach = ((numActual / numTarget) * 100).toFixed(2);
    return Number.isFinite(parseFloat(ach)) ? ach : '0.00';
}

/**
 * Escapes special characters for regular expression matching.
 * @param {string} str
 * @returns {string}
 */
export function escapeRegex(str) {
    if (str === undefined || str === null) return '';
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns date formatted in Indonesian locale (e.g. "26 September 2026").
 * @param {Date|string|number} [date=new Date()]
 * @returns {string}
 */
export function formatDateIndo(date = new Date()) {
    const validDate = toValidDate(date);
    return validDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Returns month and year formatted in Indonesian locale (e.g. "September 2026").
 * @param {Date|string|number} [date=new Date()]
 * @returns {string}
 */
export function formatMonthYearIndo(date = new Date()) {
    const validDate = toValidDate(date);
    return validDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

/**
 * Returns sanitized filename date string ("26-09-2026", "26_September_2026", etc.).
 * @param {Date|string|number} [date=new Date()]
 * @param {'short'|'long'|'month'|string} [style='short']
 * @returns {string}
 */
export function formatDateFileName(date = new Date(), style = 'short') {
    const validDate = toValidDate(date);
    if (style === 'long') {
        const str = validDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        return str.replace(/[\s\/]/g, '_');
    }
    if (style === 'month') {
        const str = validDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        return str.replace(/[\s\/]/g, '_');
    }
    // Default 'short': "DD-MM-YYYY" (e.g. "26-09-2026")
    const day = String(validDate.getDate()).padStart(2, '0');
    const month = String(validDate.getMonth() + 1).padStart(2, '0');
    const year = validDate.getFullYear();
    return `${day}-${month}-${year}`;
}
