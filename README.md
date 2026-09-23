# Bot WhatsApp Laporan Performance Toko

Bot WhatsApp otomatisasi rekapitulasi performa harian dan stock opname toko retail menggunakan Node.js dan library [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys).

---

## 🚀 Fitur Utama

- 📱 **Otentikasi Multi-File:** Sesi login disimpan secara lokal dan aman (`sesi_bot/`).
- 📝 **Template Format Pesan:** Mengirim formulir laporan siap isi (`menu`, `lapor`, atau `!menu`).
- 📊 **Olah Laporan Otomatis (`!kirimlaporan`):**
  - Ekstraksi nilai metrik: SPD, STD, APC, MGRP, MG%, LPP, Avg Sales, MPP, NBH.
  - Validasi otomatis angka SPD harian.
  - Perhitungan otomatis Pencapaian Harian (ACH) & MTD terhadap Target RAB.
  - Format balasan resmi siap kirim ke grup manajemen.
- 📈 **Rekap Akumulasi Bulanan (`!rekap`):**
  - Rekap total hari kerja, rata-rata SPD, pencapaian MTD, serta total MPP & NBH.
- 🔄 **Fitur Koreksi (`!hapusdata`):**
  - Menghapus data laporan hari ini jika terjadi kekeliruan input.

---

## 🛠️ Instalasi & Menjalankan Bot

1. **Clone Repositori:**
   ```bash
   git clone https://github.com/yasl76/bot-laporan.git
   cd bot-laporan
   ```

2. **Install Dependensi:**
   ```bash
   npm install
   ```

3. **Jalankan Bot:**
   ```bash
   npm start
   ```

4. **Hubungkan WhatsApp:**
   Scan QR Code yang muncul di terminal menggunakan aplikasi WhatsApp di HP Anda (*Perangkat Tertaut*).

---

## 🔒 Catatan Keamanan
- Folder `sesi_bot/` berisi token autentikasi sesi WhatsApp Anda dan dikecualikan secara ketat pada `.gitignore`. **Jangan pernah membagikan atau mengunggah folder sesi ini ke publik.**
