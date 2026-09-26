import fs from 'fs';
import { formatRp } from './src/formatters.js';

const CONFIG_FILE = 'config.json';

const DEFAULT_CONFIG = {
    nama_toko: 'OMI TITAN EKSEKUTIF MART',
    kode_toko: 'O8BM',
    cabang: 'BEKASI',
    tgl_grand_opening: '26 FEBRUARI 2026',
    type_harga: '7',
    target_spd: 4725000,
    target_std: 135,
    target_apc: 35000,
    target_gm: '21.00',
    ambang_stok_pb: 10,
    reminder_closing_enabled: true,
    reminder_closing_jam: 21,
    reminder_closing_menit: 45,
    jam_rekap_otomatis: 23,
    menit_rekap_otomatis: 0,
    validasi_spd_min: 1000000,
    validasi_spd_max: 20000000
};

export function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
            return { ...DEFAULT_CONFIG };
        }
        const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        return { ...DEFAULT_CONFIG, ...data };
    } catch (e) {
        console.error('Error membaca config.json:', e);
        return { ...DEFAULT_CONFIG };
    }
}

export function saveConfig(cfg) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
        return true;
    } catch (e) {
        console.error('Error menyimpan config.json:', e);
        return false;
    }
}

export function updateConfig(updates) {
    const current = loadConfig();
    const updated = { ...current, ...updates };
    saveConfig(updated);
    return updated;
}

export function getStoreInfo(cfg = null) {
    const c = cfg || loadConfig();
    return { nama_toko: c.nama_toko, kode_toko: c.kode_toko, cabang: c.cabang };
}

export function getConfigSummary() {
    const c = loadConfig();
    const reminderStatus = c.reminder_closing_enabled
        ? `Aktif (Pukul ${String(c.reminder_closing_jam).padStart(2, '0')}:${String(c.reminder_closing_menit).padStart(2, '0')} WIB)`
        : 'Non-aktif (OFF)';

    let text = `⚙️ *PENGATURAN & KONFIGURASI TOKO AKTIF*\n`;
    text += `----------------------------------------\n`;
    text += `🏪 *Profil Toko:*\n`;
    text += `• Nama Toko   : ${c.nama_toko}\n`;
    text += `• Kode Toko   : ${c.kode_toko}\n`;
    text += `• Cabang      : ${c.cabang}\n`;
    text += `• Grand Opening: ${c.tgl_grand_opening}\n`;
    text += `• Type Harga  : ${c.type_harga}\n\n`;

    text += `🎯 *Target RAB Harian:*\n`;
    text += `• Target SPD  : Rp ${formatRp(c.target_spd)}\n`;
    text += `• Target STD  : ${c.target_std}\n`;
    text += `• Target APC  : Rp ${formatRp(c.target_apc)}\n`;
    text += `• Target GM%  : ${c.target_gm}%\n\n`;

    text += `📦 *Parameter PB (Pareto):*\n`;
    text += `• Default Batas Stok : <= ${c.ambang_stok_pb} pcs\n\n`;

    text += `⏰ *Jadwal Otomatis:*\n`;
    text += `• Pengingat Closing  : ${reminderStatus}\n`;
    text += `• Rekap Akhir Bulan  : Pukul ${String(c.jam_rekap_otomatis).padStart(2, '0')}:${String(c.menit_rekap_otomatis).padStart(2, '0')} WIB\n\n`;

    text += `🛡️ *Batas Validasi SPD:*\n`;
    text += `• Rentang Wajar: Rp ${formatRp(c.validasi_spd_min)} s/d Rp ${formatRp(c.validasi_spd_max)}\n`;
    text += `----------------------------------------\n`;
    text += `👑 *Perintah Khusus Super Admin:*\n`;
    text += `• *!settarget [nominal]* : Ubah target SPD\n`;
    text += `• *!setrab [spd] [std] [apc] [gm]* : Ubah 4 target RAB\n`;
    text += `• *!settoko [Nama] | [Kode] | [Cabang]* : Ubah profil toko\n`;
    text += `• *!setstok [angka]* : Ubah batas stok default PB\n`;
    text += `• *!setreminder [jam:menit / off]* : Atur jam pengingat\n`;
    text += `• *!setjam [jam:menit]* : Atur jam rekap bulanan\n`;
    text += `• *!setvalidasi [min] [max]* : Atur rentang wajar SPD\n`;
    text += `• *!tambahnomor [no] [nama]* : Tambah Admin Biasa\n`;
    text += `• *!hapusnomor [no]* : Hapus akses nomor\n`;
    text += `• *!resetdata* : Reset data rekap bulan baru`;
    return text;
}

