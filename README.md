# Bot WhatsApp Laporan Performance & Analisa Stok Toko

Bot WhatsApp otomatisasi pelaporan kinerja penjualan harian, rekapitulasi performa bulanan, dan analisa stok pareto toko retail (*OMI TITAN EKSEKUTIF MART - Cabang Bekasi*) menggunakan Node.js, [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys), dan SheetJS (xlsx).

---

## 🚀 Fitur Unggulan

### 1. 🛡️ Keamanan & Whitelist Nomor
- **Whitelist Akses:** Hanya nomor yang terdaftar di `whitelist.json` yang dapat berinteraksi dengan bot.
- **Admin Commands:**
  - `!tambahnomor [nomor] [nama]` : Menambahkan nomor kasir/karyawan baru.
  - `!hapusnomor [nomor]` : Menghapus nomor dari whitelist.
  - `!listnomor` : Melihat seluruh nomor yang terdaftar.

### 2. 📊 Format Laporan Performance GO Baru
- Menginput dan memvalidasi SPD harian, STD, APC, MGRP, MG%, LPP, dan Avg Sales.
- **Pencatatan F&B:** Penjualan YCCG (cup) dan RTE (Sosis Original & Keju, total dihitung otomatis).
- **Kalkulasi Akurat:** Perhitungan otomatis persentase pencapaian Harian (ACH) & MTD terhadap Target RAB Toko (Rp 4.725.000).
- **Stock Opname:** Pencatatan temuan MPP (expired/rusak) dan NBH (barang hilang).
- Perintah menu template: `menu`, `lapor`, atau `!menu`.

### 3. 📦 Analisa Stok Pareto & Rekomendasi PB (Permintaan Barang)
- **Deteksi Cerdas (Dynamic Column Detection):** Membaca file pareto `.xls` atau `.xlsx` periode apa pun secara otomatis.
- **Penyaringan Stok Kritis:** Mendeteksi barang pareto dengan stok kosong (`0`) atau menipis (`<= 10`).
- **Rekomendasi Restock:** Menghitung jumlah order yang dibutuhkan berdasarkan PKM dan sisa stok toko.
- **Perintah:**
  - `!pb` : Ringkasan teks item paling kritis yang perlu di-restock.
  - `!pb excel` : Meng-generate dan mengirim dokumen Excel resmi `Laporan_PB_Pareto_[Tanggal].xlsx` siap kirim ke supplier.
- **Upload File Baru:** Cukup kirim file dokumen Excel pareto baru ke chat WhatsApp bot, bot akan otomatis memproses dan membalas dengan analisa terbaru.

### 4. 📈 Rekap Bulanan Terstruktur & Otomatisasi Akhir Bulan
- `!rekap` : Rangkuman teks terstruktur mencakup performa sales, penjualan F&B, temuan SO, dan riwayat harian.
- `!rekap excel` : Mengunduh file Excel `Rekap_Bulanan_[Periode].xlsx` lengkap dengan sheet data harian dan ringkasan bulanan.
- **Pengiriman Terjadwal Otomatis:** Setiap akhir bulan pukul 23:00, bot otomatis meng-generate dan mengirim file Excel rekapitulasi performa bulan tersebut ke nomor Admin Utama.

---

## 🛠️ Panduan Instalasi & Deploy di Server SSH (VPS / Linux)

### 1. Clone & Install
```bash
git clone https://github.com/yasl76/bot-laporan.git
cd bot-laporan
npm install
```

### 2. Setup Sesi WhatsApp
- **Opsi A (Scan QR):** Jalankan `npm start` di server, lalu scan QR code yang muncul di layar terminal menggunakan HP (menu *Perangkat Tertaut*).
- **Opsi B (Transfer Sesi):** Transfer folder `sesi_bot` dari laptop ke server via SCP:
  ```bash
  scp -r sesi_bot user@ip-server:/path/ke/bot-laporan/
  ```

### 3. Jalankan 24/7 di Background Menggunakan PM2
```bash
# Install PM2 jika belum ada
sudo npm install -g pm2

# Jalankan bot
pm2 start index.js --name "bot-laporan"

# Simpan agar otomatis nyala saat server reboot
pm2 save
pm2 startup
```

---

## 🔒 Catatan Keamanan
- Kredensial login WhatsApp (`sesi_bot/`) dilindungi oleh `.gitignore` dan tidak akan terunggah ke repositori publik.
