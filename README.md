# Bot WhatsApp Laporan Performance & Analisa Stok Toko (O8BM)

Bot WhatsApp otomatisasi pelaporan kinerja penjualan harian, rekapitulasi performa bulanan, dan analisa stok pareto toko retail (*OMI TITAN EKSEKUTIF MART - Cabang Bekasi*) menggunakan Node.js, [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys), ExcelJS, dan SheetJS.

---

## 🚀 Fitur Unggulan

### 1. 👑 Sistem Hak Akses Dua Tingkat (Super Admin vs Admin Biasa)
* **Super Admin:** Memegang kendali penuh atas pengaturan toko dinamis, manajemen whitelist, reset data bulanan, dan seluruh fitur operasional.
* **Admin Biasa (Karyawan / Kasir):** Didaftarkan oleh Super Admin (`!tambahnomor`) untuk operasional toko harian (`menu`, `!kirimlaporan`, `!rekap`, `!pb`, upload pareto, `!hapusdata`), namun diblokir dari perintah konfigurasi sistem.
* **Kompatibilitas WhatsApp Multi-Device (LID Support):** Mendukung auto-lookup dan mapping Linked Device Identifier (LID) sehingga karyawan tidak akan tertolak saat chat dari berbagai perangkat tertaut.

### 2. ⚙️ Pengaturan Toko Dinamis via Chat WhatsApp (Super Admin)
Konfigurasi tersimpan persisten di `config.json` dan dapat diubah langsung via chat:
* `!setting` / `!pengaturan` : Ringkasan status toko & parameter aktif.
* `!settarget [nominal]` : Ubah target SPD harian (cth: `!settarget 5000000`).
* `!setrab [spd] [std] [apc] [gm]` : Perbarui 4 indikator target RAB sekaligus.
* `!settoko [Nama] | [Kode] | [Cabang]` : Ubah profil identitas toko.
* `!setstok [angka]` : Ubah ambang batas default sisa stok kritis PB.
* `!setreminder [jam:menit / off / on]` : Jadwal pengingat closing harian.
* `!setjam [jam:menit]` : Jadwal pengiriman rekap bulanan otomatis.
* `!setvalidasi [min] [max]` : Batas wajar deteksi anomali input SPD.
* `!resetdata` : Backup otomatis & reset database untuk bulan baru.
* `!tambahnomor [no] [nama]` : Daftarkan nomor karyawan (auto-lookup LID).
* `!hapusnomor [no]` : Hapus akses nomor admin.
* `!listnomor` : Tampilkan daftar nomor terdaftar beserta status perannya.

### 3. 📊 Format Laporan Performance GO Baru
* Input data lengkap: SPD, STD, APC, MGRP, MG%, LPP, dan Avg Sales.
* **Pencatatan F&B:** Penjualan kopi YCCG (cup) dan RTE (Sosis Original & Keju, total dihitung otomatis).
* **Kalkulasi Presisi:** Perhitungan otomatis ACH Harian (%) & ACH MTD (%) terhadap target RAB toko.
* **Stock Opname:** Pencatatan temuan MPP (expired/rusak) dan NBH (barang hilang).
* **Validasi Anomali:** Peringatan otomatis jika SPD yang diinput berada di luar batas wajar.

### 4. 📦 Alur Konfirmasi Interaktif Analisa Stok Pareto (PB)
* **Upload Dokumen Interaktif:** Saat file pareto (`.xls`/`.xlsx`) diunggah, bot menanyakan pilihan batas stok (`10` untuk standar, `5` untuk urgent, atau angka kustom).
* **Shortcut Cepat:** Bisa upload dengan caption `!pb 5` atau ketik perintah `!pb [angka]` / `!pb excel [angka]`.
* **Spreadsheet Modern (ExcelJS):** Menghasilkan file Excel berformat rapi dengan tema Navy Blue, freeze panes, auto-filter, pewarnaan prioritas sel (merah untuk stok 0, amber untuk stok 1-5), serta estimasi konversi Karton/Dus (FT).

### 5. ⏰ Pengingat Closing Harian & Rekap Bulanan Otomatis
* **Closing Reminder:** Setiap pukul `21:45 WIB` (atau sesuai konfigurasi `!setreminder`), bot otomatis mengirim pesan pengingat ke seluruh staf agar segera mengirimkan laporan closing harian.
* **Rekap Akhir Bulan:** Setiap hari terakhir bulan pukul `23:00 WIB`, bot meng-generate rekap bulanan 2-sheet dan mengirimkannya otomatis ke seluruh Super Admin.

---

## 🛠️ Panduan Menjalankan di Server VPS Linux

### 1. Sinkronisasi Pembaruan dari Git:
```bash
cd ~/bot-laporan && git fetch origin && git reset --hard origin/main && npm install && pm2 restart bot-laporan
```

### 2. Memantau Log PM2:
```bash
pm2 status bot-laporan
pm2 logs bot-laporan --lines 30
```

---

## 🔒 Catatan Keamanan
* File sesi WhatsApp (`sesi_bot/`) dilindungi oleh `.gitignore` dan tidak akan terunggah ke repositori Git publik demi keamanan kredensial akun WhatsApp Anda.
