import fs from 'fs';

const WHITELIST_FILE = 'whitelist.json';
export const DEFAULT_SUPER_ADMINS = [
    '6285852559058',
    '215633832722432',
    '6285123338591',
    '168779396993221'
];

/**
 * Normalisasi nomor WhatsApp:
 * Mengubah format lokal 08xxx menjadi 628xxx, membuang tanda baca, akhiran @s.whatsapp.net, @lid, atau :device
 */
export function normalizeNumber(num) {
    if (!num) return '';
    let clean = num.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (clean.startsWith('08')) {
        clean = '62' + clean.slice(1);
    }
    return clean;
}

/**
 * Membaca data whitelist dari whitelist.json
 * Otomatis memastikan daftar Super Admin selalu ada dan valid
 */
export function loadWhitelist() {
    try {
        if (!fs.existsSync(WHITELIST_FILE)) {
            const initial = {
                admin: DEFAULT_SUPER_ADMINS[0],
                admin_secondary: DEFAULT_SUPER_ADMINS[1],
                admin_lid: DEFAULT_SUPER_ADMINS[2],
                super_admins: [...DEFAULT_SUPER_ADMINS],
                users: [
                    { number: DEFAULT_SUPER_ADMINS[0], name: 'Super Admin Utama', role: 'super_admin' },
                    { number: DEFAULT_SUPER_ADMINS[1], name: 'Super Admin Cadangan', role: 'super_admin' },
                    { number: DEFAULT_SUPER_ADMINS[2], name: 'Super Admin HP (LID)', role: 'super_admin' }
                ]
            };
            fs.writeFileSync(WHITELIST_FILE, JSON.stringify(initial, null, 2));
            return initial;
        }

        const data = JSON.parse(fs.readFileSync(WHITELIST_FILE, 'utf8'));
        if (!data.super_admins || !Array.isArray(data.super_admins)) {
            data.super_admins = [...DEFAULT_SUPER_ADMINS];
        } else {
            // Pastikan semua default super admin tetap ada
            for (const sa of DEFAULT_SUPER_ADMINS) {
                if (!data.super_admins.includes(sa)) {
                    data.super_admins.push(sa);
                }
            }
        }

        if (!data.users || !Array.isArray(data.users)) {
            data.users = [];
        }

        // Pastikan Super Admin terdaftar di users dengan role super_admin
        for (const sa of data.super_admins) {
            const exists = data.users.find(u => normalizeNumber(u.number) === sa);
            if (!exists) {
                data.users.push({ number: sa, name: 'Super Admin', role: 'super_admin' });
            } else {
                exists.role = 'super_admin';
            }
        }

        return data;
    } catch (e) {
        console.error('Error membaca whitelist:', e);
        return {
            admin: DEFAULT_SUPER_ADMINS[0],
            super_admins: [...DEFAULT_SUPER_ADMINS],
            users: DEFAULT_SUPER_ADMINS.map(num => ({ number: num, name: 'Super Admin', role: 'super_admin' }))
        };
    }
}

/**
 * Menyimpan data whitelist ke file
 */
export function saveWhitelist(data) {
    try {
        fs.writeFileSync(WHITELIST_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.error('Error menyimpan whitelist:', e);
        return false;
    }
}

/**
 * Memeriksa apakah nomor memiliki hak akses Super Admin
 * Super Admin memiliki kendali penuh: pengaturan toko, manajemen whitelist, reset data, dll.
 */
export function isSuperAdmin(jid) {
    const num = normalizeNumber(jid);
    if (!num) return false;
    const data = loadWhitelist();

    if (data.super_admins && data.super_admins.some(sa => normalizeNumber(sa) === num)) {
        return true;
    }
    if (num === normalizeNumber(data.admin) || (data.admin_lid && num === normalizeNumber(data.admin_lid))) {
        return true;
    }
    return data.users.some(u => 
        (normalizeNumber(u.number) === num || (u.lid && normalizeNumber(u.lid) === num)) && 
        u.role === 'super_admin'
    );
}

/**
 * Memeriksa apakah nomor terdaftar di bot (Super Admin atau Admin Biasa)
 */
export function isAllowed(jid) {
    const num = normalizeNumber(jid);
    if (!num) return false;
    if (isSuperAdmin(num)) return true;

    const data = loadWhitelist();
    return data.users.some(u => 
        normalizeNumber(u.number) === num || 
        (u.lid && normalizeNumber(u.lid) === num)
    );
}

/**
 * Tambah Admin Biasa (Karyawan Toko / Kasir / Kepala Toko)
 */
export function addNumber(number, name = 'Karyawan Toko', lid = '') {
    const norm = normalizeNumber(number);
    if (!norm || norm.length < 9) {
        return { success: false, message: '⚠️ Format nomor tidak valid. Masukkan nomor HP Indonesia yang benar (cth: 08123456789).' };
    }

    const normLid = lid ? normalizeNumber(lid) : '';
    const data = loadWhitelist();
    const existing = data.users.find(u => 
        normalizeNumber(u.number) === norm || 
        (normLid && u.lid && normalizeNumber(u.lid) === normLid)
    );
    if (existing) {
        if (normLid && !existing.lid) {
            existing.lid = normLid;
            saveWhitelist(data);
            return { 
                success: true, 
                message: `✅ Nomor *${norm}* (${existing.name}) sudah terdaftar.\n🔗 LID WhatsApp (*${normLid}*) berhasil ditautkan ke akun ini!` 
            };
        }
        return { success: false, message: `ℹ️ Nomor *${norm}* (${existing.name}) sudah terdaftar sebagai *${existing.role || 'admin_biasa'}*.` };
    }

    const newUser = { number: norm, name, role: 'admin_biasa' };
    if (normLid) {
        newUser.lid = normLid;
    }
    data.users.push(newUser);
    saveWhitelist(data);
    return {
        success: true,
        message: `✅ Berhasil menambahkan Admin Biasa!\n• Nomor: *${norm}*${normLid ? `\n• LID   : *${normLid}*` : ''}\n• Nama  : *${name}*\n• Peran : *Admin Biasa (Operasional)*`
    };
}

/**
 * Hapus nomor dari whitelist
 */
export function removeNumber(number) {
    const norm = normalizeNumber(number);
    const data = loadWhitelist();

    if (isSuperAdmin(norm)) {
        return { success: false, message: `⛔ Tidak dapat menghapus nomor *${norm}* karena merupakan *Super Admin*.` };
    }

    const before = data.users.length;
    data.users = data.users.filter(u => 
        normalizeNumber(u.number) !== norm && 
        (!u.lid || normalizeNumber(u.lid) !== norm)
    );

    if (data.users.length === before) {
        return { success: false, message: `ℹ️ Nomor/LID *${norm}* tidak ditemukan dalam daftar pengguna.` };
    }

    saveWhitelist(data);
    return { success: true, message: `✅ Nomor/LID *${norm}* berhasil dihapus dari sistem bot.` };
}

/**
 * Tampilkan daftar nomor terdaftar beserta perannya
 */
export function listNumbers() {
    const data = loadWhitelist();
    const superAdmins = data.users.filter(u => u.role === 'super_admin');
    const normalAdmins = data.users.filter(u => u.role !== 'super_admin');

    let text = `📋 *DAFTAR AKSES PENGGUNA BOT (WHITELIST)*\n`;
    text += `----------------------------------------\n`;
    text += `👑 *SUPER ADMIN (${superAdmins.length}):*\n`;
    superAdmins.forEach((u, i) => {
        const lidInfo = u.lid ? ` (LID: ${u.lid})` : '';
        text += `${i + 1}. ${u.number} - ${u.name}${lidInfo}\n`;
    });

    text += `\n👥 *ADMIN BIASA / OPERASIONAL (${normalAdmins.length}):*\n`;
    if (normalAdmins.length === 0) {
        text += `_(Belum ada admin biasa terdaftar. Tambahkan dengan !tambahnomor [no] [nama])_\n`;
    } else {
        normalAdmins.forEach((u, i) => {
            const lidInfo = u.lid ? ` (LID: ${u.lid})` : '';
            text += `${i + 1}. ${u.number} - ${u.name}${lidInfo}\n`;
        });
    }

    text += `----------------------------------------\n`;
    text += `💡 *Perintah Super Admin:*\n`;
    text += `• *!tambahnomor [nomor] [nama]*\n`;
    text += `• *!hapusnomor [nomor]*`;
    return text;
}
