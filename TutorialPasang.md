# ✈️ Tutorial Pasang & Upload SKYBOUND (GitHub Pages / Hosting / Lokal)

Panduan lengkap cara memasang dan meng-online-kan game **SKYBOUND — Low-Poly 3D Flight Simulator** ke **GitHub Pages (`*.github.io`)**, hosting web biasa (Netlify / Vercel / cPanel), maupun dijalankan secara lokal, lengkap dengan panduan **Multiplayer Online (Co-Op & Versus · Room Code)**.

---

## 📁 1. Pilihan File yang Bisa Di-Upload

Di dalam folder `HRAI/SKYBOUND/`, terdapat **2 cara** untuk meng-upload game:

### Opsi A — Versi 1 File Mandiri (*Standalone* — **Paling Praktis**)
- Gunakan file **`SKYBOUND.html`** (ukuran ~1,6 MB).
- Seluruh kode 3D Three.js, tekstur prosedural, suara WebAudio, UI, dan sistem Multiplayer WebRTC sudah tergabung di dalam **1 file HTML ini saja**.
- **Tips**: Saat di-upload ke GitHub Pages atau hosting, cukup ubah nama `SKYBOUND.html` menjadi **`index.html`** agar langsung terbuka saat link website diakses.

### Opsi B — Versi Folder Proyek (`index.html` + `dist/`)
- Upload file-file berikut dari dalam folder `SKYBOUND/`:
  - `index.html`
  - `dist/game.js`
  - `dist/game.css`

---

## 🌐 2. Cara Upload ke GitHub Pages (`*.github.io`)

GitHub Pages menyediakan hosting gratis dengan **HTTPS otomatis**, sehingga fitur **Multiplayer Online (WebRTC P2P Room Code)** dan **Sensor Giroskop HP** langsung berfungsi sempurna.

### A. Lewat Browser HP atau PC (Tanpa Install Aplikasi)

1. Buka [https://github.com](https://github.com) dan **Login** ke akun GitHub kamu.
2. Tekan tombol **`+`** di pojok kanan atas → pilih **`New repository`**.
3. Isi pengaturan repositori:
   - **Repository name**: misalnya `skybound`
   - **Public / Private**: pilih **Public**
   - Centang **`Add a README file`**
   - Klik **`Create repository`**.
4. Di halaman repositori yang baru dibuat, klik tombol **`Add file`** → **`Upload files`**.
5. Pilih file **`SKYBOUND.html`** dari folder `Download/HRAI/SKYBOUND/` di HP/PC kamu:
   - *(Rekomendasi)* Ubah dulu nama `SKYBOUND.html` menjadi **`index.html`** sebelum di-upload agar alamat web-nya bersih.
6. Ketik pesan di bawah (misal: `Upload game SKYBOUND`) lalu klik **`Commit changes`**.
7. **Aktifkan GitHub Pages**:
   - Buka tab **`Settings`** di repositori tersebut.
   - Di menu sebelah kiri, pilih **`Pages`**.
   - Pada bagian **Build and deployment → Source**, pilih **`Deploy from a branch`**.
   - Pada bagian **Branch**, ubah `None` menjadi **`main`** (atau `master`), biarkan folder di **`/ (root)`**, lalu klik **`Save`**.
8. Tunggu sekitar **1–2 menit**, lalu segarkan (*refresh*) halaman **Settings → Pages**.
9. Link game kamu akan muncul dan siap dimainkan di:
   - **`https://<username-github>.github.io/skybound/`** *(jika file bernama `index.html`)*
   - **`https://<username-github>.github.io/skybound/SKYBOUND.html`** *(jika nama file tetap `SKYBOUND.html`)*

---

### B. Lewat Terminal Termux / Git CLI

Jika kamu ingin meng-upload seluruh folder proyek langsung dari Termux:

```bash
cd /storage/emulated/0/Download/HRAI/SKYBOUND

# Salin SKYBOUND.html sebagai halaman utama (opsional)
cp SKYBOUND.html index.html

git init
git branch -M main
git add index.html SKYBOUND.html dist/ src/ README.md Changelog.md
git commit -m "Deploy SKYBOUND v2.1.0 Online Multiplayer"
git remote add origin https://github.com/<USERNAME_KAMU>/skybound.git
git push -u origin main
```

Setelah `git push` berhasil, aktifkan **Settings → Pages → Branch: `main`** di GitHub seperti pada langkah A.7 di atas.

---

## ⚡ 3. Cara Upload ke Hosting Lain (Netlify / Vercel / cPanel)

### A. Netlify Drop (Tanpa Akun GitHub — 10 Detik Online)
1. Buat folder baru di HP/PC, masukkan `SKYBOUND.html` ke dalamnya lalu ubah namanya menjadi **`index.html`**.
2. Buka [https://app.netlify.com/drop](https://app.netlify.com/drop).
3. Tarik (*drag & drop*) atau pilih folder tersebut.
4. Website langsung aktif dengan link `https://nama-random.netlify.app` (bisa diganti nama domainnya di menu *Site configuration*).

### B. cPanel / Shared Hosting / VPS
1. Masuk ke **File Manager** di cPanel hosting kamu → buka folder **`public_html/`** (atau subfolder seperti `public_html/skybound/`).
2. Upload **`SKYBOUND.html`** lalu *Rename* menjadi **`index.html`**.
3. Game langsung bisa diakses melalui domain hosting kamu!

---

## 🎮 4. Panduan Bermain Mode Multiplayer Online (Room Code)

Begitu game sudah online di `github.io` atau hosting kamu, pemain dari berbagai perangkat (HP Android, iPhone, Tablet, maupun PC/Laptop) bisa bermain bersama:

### Langkah Membuat Room (Pemain 1 / Host)
1. Buka link game, lalu di **Menu Utama** tekan tombol:
   **`ONLINE · MULTIPLAYER · CO-OP & VERSUS (ROOM CODE)`**.
2. Isi **CALLSIGN PILOT** (contoh: `GARUDA-1`).
3. Pilih **MODE ONLINE**:
   - **`CO-OP ONLINE`**: Semua pemain satu tim melawan skuadron bandit AI bersama-sama. Tidak ada *friendly fire*, teman ditandai sebagai **`[ALLY]`** berwarna biru-sian di layar & radar, dan jumlah *kill* tim dihitung bersama di **`SQUAD KILL`**.
   - **`VERSUS ONLINE`**: Pertempuran *Dogfight PvP* antar-pemain! Semua sistem senjata (**Target Lock**, **Rudal Pelacak IR**, **Meriam**, **Auto-Lock Camera `LCK`**, dan **Threat Scope**) akan mengunci pesawat pemain lawan (**`[VS]`**).
4. Pilih **BANDIT AI (ALL MODE)**:
   - **`ON (ALL MODE)`**: PvP antar-pemain + Bandit AI muncul bersamaan di langit.
   - **`MURNI PvP`**: Duel khusus antar-pemain tanpa bandit AI.
5. Pilih **PETA ROOM** (`CORAL`, `KOTA`, `GURUN`, atau `GUNUNG`).
6. Tekan **`BUAT ROOM`** (kamu bisa membiarkan kotak kode kosong untuk kode otomatis seperti `SKY482`, atau mengetik kode buatanmu sendiri).
7. Tekan **`SALIN KODE`** dan kirimkan kode tersebut ke temanmu, lalu klik **`TERBANG ONLINE · MULAI SORTIE`**.

### Langkah Bergabung ke Room (Pemain 2–8 / Wingman & Rival)
1. Buka link game yang sama, lalu masuk ke menu **`MULTIPLAYER · CO-OP & VERSUS`**.
2. Isi **CALLSIGN PILOT** (contoh: `ELANG-2`).
3. Ketik kode dari Host (contoh: `SKY482`) pada kolom **ROOM CODE**, lalu tekan **`GABUNG ROOM`**.
4. Peta dunia dan mode permainan (`CO-OP` atau `VERSUS`) akan otomatis menyesuaikan dengan pengaturan Host.
5. Tekan **`TERBANG ONLINE · MULAI SORTIE`** untuk langsung masuk ke langit yang sama!

> **💡 Tips Tambahan**:
> - **Pilih Pesawat Berbeda**: Sebelum masuk atau terbang, kamu bisa memilih pesawat favoritmu di menu **NEW GAME → HANGAR** (**F-31 WRAITH**, **T-6 SPARROW**, **A-14 THUNDERBOLT**, **F-40 GHOST**, atau **B-2 TITAN**). Pemain lain akan melihat bentuk model 3D pesawat sesuai yang kamu gunakan!
> - **Tes Offline Antar-Tab di 1 Perangkat**: Jika kamu membuka 2 tab browser di HP/PC yang sama dan memasukkan Room Code yang sama, game otomatis menggunakan jalur lokal *zero-latency* (`BroadcastChannel`) sehingga bisa diuji coba kapan saja bahkan tanpa kuota internet.
