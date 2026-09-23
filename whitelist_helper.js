import fs from 'fs';

const WHITELIST_FILE = 'whitelist.json';
const DEFAULT_ADMIN = '6285123338591';

export function normalizeNumber(num) {
    if (!num) return '';
    let clean = num.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (clean.startsWith('08')) {
        clean = '62' + clean.slice(1);
    }
    return clean;
}

export function loadWhitelist() {
    try {
        if (!fs.existsSync(WHITELIST_FILE)) {
            const initial = {
                admin: DEFAULT_ADMIN,
                users: [{ number: DEFAULT_ADMIN, name: 'Admin Utama', role: 'admin' }]
            };
            fs.writeFileSync(WHITELIST_FILE, JSON.stringify(initial, null, 2));
            return initial;
        }
        const data = JSON.parse(fs.readFileSync(WHITELIST_FILE, 'utf8'));
        if (!data.users) data.users = [];
        return data;
    } catch (e) {
        console.error('Error membaca whitelist:', e);
        return { admin: DEFAULT_ADMIN, users: [{ number: DEFAULT_ADMIN, name: 'Admin Utama', role: 'admin' }] };
    }
}

export function saveWhitelist(data) {
    fs.writeFileSync(WHITELIST_FILE, JSON.stringify(data, null, 2));
}

export function isAllowed(jid) {
    const num = normalizeNumber(jid);
    const data = loadWhitelist();
    if (num === data.admin) return true;
    return data.users.some(u => normalizeNumber(u.number) === num);
}

export function isAdmin(jid) {
    const num = normalizeNumber(jid);
    const data = loadWhitelist();
    return num === data.admin;
}

export function addNumber(number, name = 'Karyawan Toko') {
    const norm = normalizeNumber(number);
    if (!norm || norm.length < 9) return { success: false, message: 'Format nomor tidak valid.' };

    const data = loadWhitelist();
    if (data.users.some(u => normalizeNumber(u.number) === norm)) {
        return { success: false, message: `Nomor ${norm} sudah terdaftar sebelumnya.` };
    }

    data.users.push({ number: norm, name, role: 'user' });
    saveWhitelist(data);
    return { success: true, message: `✅ Nomor *${norm}* (${name}) berhasil ditambahkan ke whitelist!` };
}

export function removeNumber(number) {
    const norm = normalizeNumber(number);
    const data = loadWhitelist();
    if (norm === data.admin) {
        return { success: false, message: 'Tidak dapat menghapus nomor Admin Utama.' };
    }

    const before = data.users.length;
    data.users = data.users.filter(u => normalizeNumber(u.number) !== norm);

    if (data.users.length === before) {
        return { success: false, message: `Nomor ${norm} tidak ditemukan di whitelist.` };
    }

    saveWhitelist(data);
    return { success: true, message: `✅ Nomor *${norm}* berhasil dihapus dari whitelist.` };
}

export function listNumbers() {
    const data = loadWhitelist();
    let text = `📋 *DAFTAR NOMOR TERDAFTAR (WHITELIST)*\n----------------------------------------\n`;
    text += `👑 *Admin Utama:* ${data.admin}\n\n`;
    text += `👥 *Daftar Pengguna Aktif (${data.users.length}):*\n`;
    data.users.forEach((u, i) => {
        text += `${i + 1}. ${u.number} - ${u.name} (${u.role || 'user'})\n`;
    });
    text += `----------------------------------------\n`;
    text += `_Gunakan !tambahnomor [nomor] [nama] atau !hapusnomor [nomor] untuk mengelola._`;
    return text;
}
