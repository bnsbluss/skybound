# Changelog — SKYBOUND

Semua perubahan penting pada proyek ini didokumentasikan di sini.

## [2.2.0] — Overhaul Multiplayer: Tim 3 vs 3 (40 Skor · 10 Menit), Versus Target 20 Tanpa NPC, Host Start + Guest READY, Daftar Room Aktif, Pilih Pesawat di Lobi & Perbaikan Map Gelap
### Added
- **⚔️ MODE BARU: VERSUS TIM 3 VS 3 (40 vs 40 · 10 MENIT) (`src/net/Multiplayer.js`, `src/core/Game.js`, `src/hud/HUD.js`, `src/styles.css`)**:
  - Pertempuran tim **TIM BIRU** (maks 3 pilot) melawan **TIM MERAH** (maks 3 pilot) murni PvP tanpa NPC/Bandit AI, lengkap dengan auto-balance tim saat bergabung, pemilih tim di lobi, dan pencegahan *friendly fire*.
  - **Papan Skor Atas HUD (`#mp-scoreboard`)**: menampilkan skor **`TIM BIRU 0/40`** — **timer hitung mundur `10:00`** — **`0/40 TIM MERAH`** secara *real-time*.
  - **Kondisi Menang & Layar Hasil (`#mp-result-screen`)**: tim pertama yang mencapai **skor 40** langsung menang; jika **waktu 10 menit habis**, tim dengan skor lebih tinggi menang (atau seri bila imbang), lengkap dengan klasemen akhir dan tombol kembali ke lobi room atau menu utama.
- **🏆 SKOR & KEMENANGAN MODE VERSUS SOLO (TARGET 20 · MURNI PvP) (`src/net/Multiplayer.js`, `src/core/Game.js`, `src/hud/HUD.js`)**:
  - Mode **Versus Solo** kini murni antar-pemain tanpa musuh AI/NPC, menampilkan **Skor Kamu**, **Target 20**, dan **Pemimpin Skor** di papan skor atas HUD; pemain pertama yang mencapai **20 kill** langsung menjadi pemenang.
- **👤 PEMBUATAN NAMA PROFIL PILOT SEBELUM MULTIPLAYER (`src/hud/HUD.js`, `src/core/Game.js`, `src/net/Multiplayer.js`)**:
  - Menambahkan modal **`BUAT NAMA PROFIL`** (`#mp-profile-gate`) sebelum pertama kali masuk ke lobi Multiplayer agar setiap pemain membuat *callsign* profil yang tersimpan permanen di `localStorage` (`skybound.callsign`, `skybound.profileSet`).
- **📋 MENU DAFTAR ROOM AKTIF (`#mp-room-list`) & KONTROL HOST START + GUEST READY (`src/net/Multiplayer.js`, `src/hud/HUD.js`, `src/core/Game.js`, `src/styles.css`)**:
  - Panel **DAFTAR ROOM AKTIF** dengan tombol **`↻ REFRESH`**, info kode room, Host, mode (`CO-OP` / `VERSUS 20` / `TIM 3v3`), peta, jumlah pilot, status (`LOBI` / `BERTEMPUR`), serta tombol **`GABUNG`** sekali klik.
  - **Sistem Host Start & Guest READY**: Host mengatur konfigurasi room dan memegang kendali mulai permainan; pemain yang bergabung menekan tombol **`SIAP (READY)`** untuk ikut masuk otomatis saat Host memulai (atau langsung terjun bila pertandingan sudah berlangsung).
- **✈️ DAFTAR PILIH PESAWAT DI LOBI MULTIPLAYER (`src/hud/HUD.js`, `src/core/Game.js`, `src/net/Multiplayer.js`, `src/styles.css`)**:
  - Menambahkan pemilih 5 pesawat tempur (`F-31 WRAITH`, `T-6 SPARROW`, `A-14 THUNDERBOLT`, `F-40 GHOST`, `B-2 TITAN`) langsung di lobi Multiplayer yang tersinkron ke seluruh room dan tampil pada **Squadron Roster**.
- **🛩️ OVERHAUL COCKPIT VIEW GAYA F-16C / ACE COMBAT, TANGAN PILOT 3D & RADAR COCKPIT (`src/aircraft/Cockpit.js`, `src/styles.css`, `src/hud/HUD.js`)**:
  - **Kanopi Bubble Terbuka & HUD Combiner Melengkung (512×512)**: kaca HUD optik tinggi berbingkai melengkung khas F-16 dengan pita kompas atas (`SE 155 S`), pita `SPEED` kiri, pita `ALT` kanan, tangga pitch dinamis (`+5/-5`), reticle, dan indikator `FIRE` / `MISSILE · FLARE!`.
  - **Konsol F-16 Otentik**: panel **ICP** tengah (6 tombol mode bundar + keypad 3×4 + thumbwheel), **RWR Radar Scope bundar** + lampu peringatan merah berkedip di kiri, dan layar **DED hijau** di kanan.
  - **Tangan & Lengan Pilot 3D Bersarung Tangan Nomex Matte + Animasi Tekan Tombol Senjata**: model tangan anatomi baru bersarung tangan pilot *matte* (sage-olive Nomex + telapak kulit gelap tanpa kilau krom), tangan kanan menggenggam *HOTAS side-stick* lengkap dengan animasi **jari telunjuk menarik pelatuk merah (`FIRE`)** dan **ibu jari kanan menekan tombol peluncur rudal merah (`MISSILE`)**, sementara tangan kiri bertumpu horizontal (*palm-down*) di tuas *throttle* dengan animasi **ibu jari kiri menekan sakelar `FLARE`**.
  - **Pencahayaan & Pantulan Cahaya Kanopi Real-Time (`src/aircraft/Cockpit.js`, `src/core/Game.js`, `src/styles.css`)**: interior kokpit tidak lagi gelap — vignette hitam berat pada `.cockpit-canopy` diganti kilau kaca kanopi tipis, seluruh panel bertekstur aviasi *matte-satin* dengan label ICP tajam, dan cahaya pantulan kanopi dinamis (`canopySunLight`, `canopyFillLight`, `consoleGlowLight`) mengikuti arah matahari, warna langit/bioma peta, dan kemiringan pesawat dengan chroma yang natural.
  - **Radar & Status Senjata Posisi Cockpit**: radar taktis kotak hijau transparan ditempatkan di pojok kiri bawah dan status senjata/flare di pojok kanan bawah selama *Cockpit View* aktif.
- **🚀 EFEK PELUNCURAN & ASAP MISSILE, MINICAM MISSILE (KANAN), 8 MODE MISSILE + SISTEM POINT & PELUNCURAN KAPAL INDUK (`src/combat/MissileCatalog.js`, `src/combat/Weapons.js`, `src/world/AircraftCarrier.js`, `src/core/Progress.js`, `src/core/Game.js`, `src/hud/HUD.js`, `src/styles.css`)**:
  - **Efek Peluncuran & Jejak Asap Rudal (`smokeMesh`)**: setiap peluncuran rudal memicu kilatan penyalaan roket + ledakan asap pilon (`6 puff`) diikuti jejak asap putih-abu bergulung pekat secara *real-time* di belakang rudal yang mengejar musuh.
  - **Minicam Missile Mengejar Target (Picture-in-Picture Kanan)**: menambahkan jendela **MISSILE CAM (`#missile-cam-frame`)** di sisi kanan layar menggunakan *WebGL scissor viewport* langsung di belakang rudal yang melesat menuju target (lengkap dengan jarak `RNG`, status `HOMING · LOCK`, dan tahan sejenak pada bola api **`IMPACT!`** saat meledak).
  - **8 Pilihan Mode Missile di Hangar + Sistem Point (`PTS`)**: menambahkan 8 jenis rudal berbeda (**`AIM-9X SIDEWINDER`** gratis, **`AIM-120 AMRAAM`**, **`QAAM VIPER`**, **`4AAM QUAD-SALVO`** 4 rudal serentak, **`HYDRA 6× BARRAGE`** 6 roket cepat, **`AGM-88 HARM`** supersonik, **`MPBM HELIOS`** ledakan kejut radius 48 m, dan **`X-02 HYPER-RAIL`** kembar hipersonik) yang dapat dibuka menggunakan **Point (`PTS`)** hadiah dari menyelesaikan misi kampanye, pertandingan Multiplayer, atau sorti tempur.
  - **Peluncuran Pesawat dari Kapal Induk (`CVN-07 SKYBOUND`) di Mode NEW GAME**: memulai **NEW GAME** dari Hangar kini mereset progres misi kembali ke **BAB 01** (dengan tetap mempertahankan **Pesawat**, **Point `PTS`**, dan **Missile** yang sudah terbuka), menempatkan pesawat di dek kapal induk 3D berhaluan rapi tanpa mesh menonjol lengkap dengan *Jet Blast Deflector*, menara pulau & radar berputar, uap ketapel (*steam catapult*), akselerasi cepat di dek lepas landas (`0 → 175 m/s`), lalu mengudara mulus ke medan tempur.
  - **Edit HUD Lengkap di Pengaturan (Termasuk HUD CAM & Tombol Khusus Mobile) (`src/hud/HUD.js`, `src/controls/MobileControls.js`, `src/styles.css`, `src/core/Game.js`)**: membuka **Edit HUD (`GESER` / `ATUR HUD MOBILE`)** dari Pengaturan kini menyembunyikan layar pengaturan sementara dan membuka mode editor langsung lengkap dengan bilah **`SIMPAN & SELESAI`**, termasuk panel **`HUD MISSILE CAM`** (posisi bawaan digeser agar tidak menimpa tape ketinggian) serta tombol sentuh **`CAM` khusus Mobile** yang dapat digeser, diubah ukuran, dan transparansinya secara mandiri.
  - **Perbaikan Stabilitas AI Mode Saat Target Lock & Fire-and-Forget (`src/core/Game.js`)**: mengganti kendali *body-frame* `atan2` dan manuver *break turn* tanpa batas roll pada `_autopilotInput()` dengan pengendali *bank-to-turn* terstabilkan horizon (`bank <= ±61°`, *PD damping* pada roll/pitch/yaw, *dead-astern hysteresis*, dan *wing-leveling* saat target terkunci) sehingga pesawat AI tidak lagi terbalik maupun berputar angka 8 saat mengunci target; begitu rudal terkunci meluncur, AI langsung beralih mengunci musuh lain (*fire-and-forget*) tanpa menunggu target sebelumnya meledak.
  - **4 Pesawat Tempur ELIT Ikonik & Rudal Khusus (`src/aircraft/AircraftCatalog.js`, `src/aircraft/AircraftModel.js`, `src/combat/MissileCatalog.js`, `src/core/Progress.js`, `src/hud/HUD.js`)**: menambahkan **`ADFX-02 MORGAN`** (`MPBM-X BURST` 72 m), **`X-02S STRIKE WYVERN`** (`EML ARCLIGHT` Railgun Mach 7), **`CFA-44 NOSFERATU`** (`ADMM 8× SWARM` salvo 8 rudal), dan **`ADF-01 FALKEN`** (`TLS-01 LASER` kembar) lengkap dengan siluet 3D otentik (COFFIN, sayap maju, V-tail, pod ADMM, *solo-wing*) yang terbuka lewat Misi 4–7 (otomatis membuka senjata khususnya).
  - **Afterburner Boost Lebih Tahan Lama & Cepat Pulih Sesuai Pesawat (`src/aircraft/FlightPhysics.js`)**: memperlambat pengurasan boost (`~8,7 dtk` standar hingga `~11,8 dtk` pada pesawat ELIT) serta mempercepat pengisian ulang & menurunkan ambang siap pakai (`14%`) sesuai rating `boost` masing-masing pesawat.
  - **Tank Patroli Bersenjata Khusus Map Gurun & Misi Gurun (`src/combat/DesertTanks.js`, `src/core/Game.js`, `src/core/Progress.js`)**: menambahkan konvoi **Tank Tempur Utama (MBT) 3D** eksklusif pada peta **GURUN (`desert`)** yang berpatroli mengikuti kontur bukit pasir, memutar turet & menembakkan meriam anti-udara ke pemain, tampil di radar, dapat dikunci rudal, dan dihitung langsung dalam target misi gurun (**BAB 03: PASIR BERDARAH** & **BAB 07: ARMADA GURUN**).
- **🏔️ OVERHAUL TERRAIN PETA & PEGUNUNGAN + PEMBATASAN ZONA PETA (`src/world/IslandField.js`, `src/world/World.js`, `src/core/Game.js`, `src/hud/HUD.js`)**:
  - **Mesh Terrain Daratan Seragam & Halus (`buildLandGridGeometry`)**: mengganti grid polar radial pada peta **GUNUNG**, **GURUN**, dan **KOTA** dengan grid Kartesius terindeks beresolusi seragam (`flatShading: false` dengan *vertex normal* halus), menghilangkan bug LOD `3,2 km` yang sebelumnya mengubah pegunungan menjadi poligon kacau, serta memperhalus gradasi lembah hijau, lereng pinus, tebing granit, dan garis salju puncak gunung.
  - **Pembatasan Area Peta (Combat Zone Boundary)**: menambahkan batas area tempur per peta (`getMapBounds()`: Coral `8,5 km`, Kota `10,5 km`, Gurun `11,5 km`, Gunung `12,0 km`) lengkap dengan cincin batas putus-putus pada **Tactical Radar**, peringatan HUD saat mendekati tepi peta, serta *auto turn-back* & *clamp* halus agar pesawat tidak bisa keluar jalur peta.
- **💬 SISTEM CHAT PERINTAH AI (`ENTER` → `/hvskbnd` & `/stop`), KAMERA MOUSE NON-INVERT & RESET `R` (`src/hud/HUD.js`, `src/core/Game.js`, `src/controls/InputManager.js`, `src/camera/ChaseCamera.js`, `src/styles.css`)**:
  - **Hapus Tombol AI → Sistem Chat (`ENTER`)**: tombol `AI` di HUD dihilangkan; pemain kini menekan **`Enter`** untuk membuka panel chat/komando (`#flight-chat`), ketik **`/hvskbnd`** untuk mengaktifkan **AI Mode**, dan ketik **`/stop`** untuk menghentikan AI Mode dan kembali ke kontrol manual (`ESC` untuk batal).
  - **Kamera Mouse Non-Invert & Tombol Reset `R`**: memperbaiki arah vertikal kamera mouse yang sebelumnya terbalik (*invert*) dan menambahkan tombol **`R`** (`resetOrbit()`) untuk langsung mengembalikan posisi dan zoom kamera tepat di belakang pesawat.
- **🎯 ANIMASI CROSSHAIR AUTO-LOCK, SUARA TARGET LOCK MISSILE & 🚨 ALARM RWR FLARE (`src/core/AudioSystem.js`, `src/core/Game.js`, `src/hud/HUD.js`, `src/aircraft/Cockpit.js`, `src/styles.css`)**:
  - **Animasi Crosshair Auto-Lock 2-Tahap (`SEEKING → LOCKED`)**: saat lawan masuk kerucut *seeker*, *crosshair* pembidik (`#target-box` + SVG `.tb-crosshair`) muncul lebar berwarna kuning-amber dan berputar mengecil secara mulus (`0% → 100%` dalam `0,65 dtk`) tepat mengunci badan pesawat target (didampingi indikator `SEEKING` di kaca HUD 3D), lalu berubah merah menyala (`LOCK · FIRE`) begitu terkunci penuh.
  - **Suara Target Lock Siap Tembak Rudal (Master Bus)**: begitu animasi *crosshair* selesai mengunci target, suara konfirmasi `lockTone()` dan nada Sidewinder harmonis berirama (`targetLockUpdate` / `lockReadyBeep`) langsung keluar keras dan jernih lewat bus `master` (menembus deru mesin & *afterburner*), lalu berhenti otomatis saat kunci target lepas atau jeda.
  - **Alarm Peringatan Rudal Mengejar (RWR Flare Warning)**: alarm audio RWR dua-nada prosedural (`missileAlarmUpdate` / `missileWarningBeep`) berbunyi otomatis saat rudal musuh mengejar pesawat dengan ritme makin cepat saat jarak mendekat (`< 650 m`), disertai kedipan lampu merah kokpit, pesan `MISSILE · FLARE!` di kaca HUD/DED, dan berhenti begitu flare mengecoh rudal.

### Changed
- **📍 JARAK DEPLOY & RESPAWN BERJAUHAN PER PEMAIN (`src/net/Multiplayer.js`, `src/core/Game.js`)**:
  - `getSpawnTransform(isRespawn)` mengatur jarak deploy dan respawn otomatis: **Tim 3v3** berhadapan selatan-utara berjarak `3,6 km` dengan formasi menyamping `420 m`, **Versus Solo** tersebar pada cincin radius `1.550 m` (dan memilih titik terjauh dari lawan saat respawn), serta **Co-Op** dalam formasi skuadron berdampingan.
- **⏸️ PAUSE TETAP ONLINE & AKTIF DI MULTIPLAYER (`src/core/Game.js`, `src/net/Multiplayer.js`)**:
  - Saat pemain membuka menu Pause di sesi Multiplayer, pesawat tetap online, memancarkan state secara *real-time*, terbang otomatis aman (`_pausedOnlineFlightInput()`), dan tetap aktif di langit bersama pemain lain.
- **🔒 KUNCI GANTI PETA SAAT PERTARUNGAN & NONAKTIFKAN `RESTART SORTIE` DI MULTIPLAYER (`src/core/Game.js`, `src/hud/HUD.js`, `src/styles.css`)**:
  - Pemilih peta (`#settings-map-select`, `#mp-map-select`) dan `_setMap()` dikunci selama pertarungan (`flying`, `paused`, `crashed`) serta dikunci bagi Guest di dalam room.
  - Tombol **`RESTART SORTIE`** (`#btn-restart`) dan `_restartSortie()` dinonaktifkan saat sesi Multiplayer aktif.
- **🚪 KELUAR PERTARUNGAN / TUTUP TAB LANGSUNG MEMUTUS ROOM (`src/core/Game.js`, `src/net/Multiplayer.js`)**:
  - Menekan **KEMBALI KE MENU**, keluar game, menutup tab (`beforeunload` / `pagehide`), atau terputus dari koneksi WebRTC langsung memanggil `leaveRoom()` dan menghapus pesawat pemain dari room Host.

### Fixed
- **🌑 PERBAIKAN MAP HITAM PEKAT / GELAP DI MODE VERSUS & CO-OP (`src/aircraft/EngineEffects.js`, `src/aircraft/Aircraft.js`, `src/net/Multiplayer.js`, `src/world/Sky.js`, `src/world/World.js`, `src/core/Game.js`)**:
  - Menemukan dan memperbaiki akar masalah: `RemotePilot` sebelumnya tidak memiliki `throttle` (`undefined`), menyebabkan `EngineEffects.update()` menghasilkan intensitas `THREE.PointLight = NaN` yang meracuni `reflectedLight` WebGL sehingga seluruh pulau, pesawat, dan awan menjadi hitam pekat. Kini `throttle`/`afterburner` disanitasi dengan `Number.isFinite(...)` dan pesawat remote menonaktifkan `PointLight` tambahan (`enableLight: false`).
  - Menginisialisasi posisi `sunLight` & `sunSprite` sejak konstruktor `Sky`, memperbarui pencahayaan & `shadowMap` langsung saat `_swapWorld()`, dan menunggu `_mapSwitchPromise` selesai saat meluncurkan sorti Multiplayer agar overlay loading tidak menimpa layar terbang.
- **🗺️ SINKRONISASI PETA HOST ↔ GUEST & DEDUPLIKASI PAKET (`src/net/Multiplayer.js`, `src/core/Game.js`)**:
  - Host kini otomatis menyiarkan `room-config` saat mengganti peta di lobi, disertai *fallback sync* lewat paket `state` dan antrean `_pendingMapSync`.
  - Menambahkan deduplikasi paket berbasis `msgId` agar hit dan skor PvP tidak pernah terhitung ganda saat *BroadcastChannel* dan WebRTC aktif bersamaan.
- **🎥 PERBAIKAN BUG TRANSISI KAMERA CHASE ↔ COCKPIT (`src/camera/ChaseCamera.js`, `src/core/Game.js`)**:
  - Memperbaiki bug di `_updateCockpit()` di mana kamera sempat menoleh mundur (`lookAt(physics.position)`) dan terbang menembus badan pesawat selama ~0,8 detik sebelum berpindah kaku ke kursi pilot. Kini perpindahan `CHASE ↔ COCKPIT` langsung *snap* presisi sejajar orientasi pesawat (`physics.quaternion`) dengan FOV kokpit yang stabil dan bersih.

### Tests
- `tests/test-game.mjs`: Menambahkan pengujian otomatis untuk modal profil sebelum Multiplayer, sinkronisasi peta & pesawat lobi, verifikasi tidak ada lampu `NaN` pada pesawat remote, Daftar Room Aktif, Host Start + Guest READY, Pause tetap online, keluar langsung lepas room, kunci ganti peta & blokir Restart Sortie, Versus target 20 tanpa NPC, serta Tim 3 vs 3 (target 40 & timer 10 menit).

## [2.1.0] — Multiplayer Online (Co-Op & Versus · Room Code), Gunung Api Aktif CORAL, 5 Model 3D Pesawat Unik, Awan Cumulus Transparan 50% & AI Dogfight Sejati
### Added
- **🌐 MULTIPLAYER ONLINE: CO-OP & VERSUS (ALL MODE) DENGAN ROOM CODE (`src/net/Multiplayer.js`, `src/hud/HUD.js`, `src/core/Game.js`, `src/styles.css`)**:
  - **2 Mode Online Lengkap**:
    - **CO-OP ONLINE**: Terbang satu skuadron bersama teman melawan bandit AI di semua peta (`CORAL`, `KOTA`, `GURUN`, `GUNUNG`). Teman muncul sebagai `[ALLY]` biru-sian di radar dan layar 3D tanpa *friendly fire*, serta berbagi penghitung *Squad Kill*.
    - **VERSUS ONLINE (All Mode)**: Pertempuran *Dogfight PvP* antar-pemain (bisa memilih **ALL MODE: PvP + Bandit AI** atau **MURNI PvP**). Pesawat lawan masuk ke sistem *Target Lock*, rudal pelacak IR, meriam, *Auto-Lock Camera (`LCK`)*, dan *Threat Scope*.
  - **Sistem Room Code Tanpa Backend (Siap untuk GitHub Pages / `github.io` & Hosting Statis)**: Menggunakan kombinasi **WebRTC Peer-to-Peer (PeerJS Cloud Broker + Google/Twilio STUN)** untuk koneksi lintas perangkat via internet serta **`BroadcastChannel`** untuk koneksi instan antar-tab lokal.
  - **Replika 3D Pesawat & Senjata Real-Time**: Setiap pemain menampilkan model 3D pesawat pilihannya (`F-31 WRAITH`, `T-6 SPARROW`, `A-14 THUNDERBOLT`, `F-40 GHOST`, atau `B-2 TITAN`) dengan interpolasi 60 FPS, semburan *afterburner*, tembakan meriam, dan peluncuran rudal.
- **🌋 GUNUNG API AKTIF & ASAP VULKANO DI PETA CORAL (`src/world/IslandField.js`)**:
  - Empat puncak pulau vulkanik di kepulauan **CORAL** (**Twinspire**, **Highpeak**, **Titan Ridge**, dan **Ember Cay**) kini memiliki kawah kaldera basal hitam (`volcano-cones`), danau lava pijar & aliran magma (`volcano-lava`), serta kepulan **asap vulkanik aktif (`volcano-smoke`)** yang terus membumbung tinggi, berputar, membesar, dan terbawa angin dari bibir kawah.
- **✈️ 5 MODEL 3D PESAWAT & SILUET HANGAR BERBEDA SESUAI NAMA PESAWAT (`src/aircraft/AircraftModel.js`, `src/hud/HUD.js`)**:
  - **F-31 WRAITH**: Sayap *swept trapezoid-delta*, *canard* depan, sirip ekor ganda miring (*canted V-tail*).
  - **T-6 SPARROW**: Sayap sapu maju (*forward-swept wing* ala X-29/Su-47), sirip ekor vertikal tunggal tinggi di tengah (*single dorsal fin*), dan *wingtip interceptor pods*.
  - **A-14 THUNDERBOLT**: Sayap lurus lebar berpelindung (*straight attack wing* ala A-10 Warthog), **dua mesin turbofan besar di punggung belakang**, ekor **H-tail** tegak di ujung stabilator, meriam putar *Gatling* di bawah hidung, dan tabung roket bawah sayap.
  - **F-40 GHOST**: Sayap berlian siluman (*diamond stealth wing*) dengan tepi belakang bergerigi, punggung *stealth chine* berfaset, tudung knalpot siluman rata, dan ekor V-tail miring lebar tanpa rudal eksternal.
  - **B-2 TITAN**: Sayap terbang raksasa tanpa ekor horizontal (*tailless flying-wing fortress* ala B-2 Spirit) dengan tepi belakang bergerigi huruf W, punuk badan pesawat *blended-wing-body*, dan sepasang rumah mesin ganda di punggung.
- **☁️ AWAN CUMULUS REALISTIS & TRANSPARAN 50% (`src/world/Clouds.js`)**:
  - **Transparansi 50% & Halo Uap Lembut**: material inti awan (`coreMaterial`) kini disetel `transparent: true` dengan **`opacity: 0.5` (transparan 50%)** serta `depthWrite: false`, dilapisi selubung kabut uap luar (`shellMaterial`, skala `1.18×`, `opacity: 0.24`) sehingga pesawat, pulau, gunung, dan siluet langit tetap terlihat samar-samar saat terbang menembus atau melintas di balik gugusan awan.
  - **Geometri Cumulus Organik & Tekstur Uap Prosedural**: mengganti poligon kaku *low-poly* (`flatShading: true`) dengan geometri kubah cumulus halus (`IcosahedronGeometry(1, 3)` yang dipahat multi-frekuensi dengan dasar kondensasi rata di bagian bawah dan kubah bergelombang di bagian atas), lengkap dengan *vertical self-shadowing vertex colors* (puncak putih hangat terkena matahari, dasar biru-kelabu atmosferik) dan tekstur kabut radial prosedural (`createCloudVaporTexture()`).

### Fixed
- **🎯 TARGET LOCK & FPM PRESISI PADA SEMUA SKALA UI (`src/hud/HUD.js`, `src/core/Game.js`, `src/combat/Weapons.js`, `src/combat/Enemies.js`)**:
  - **Koreksi Skala Koordinat HUD (`--ui-scale`)**: container `.hud` diskalakan dengan `transform: scale(var(--ui-scale))` (default desktop 110%, hingga 160%), tetapi `_updateTargetBox` dan `_updateFPM` sebelumnya mengalikan koordinat NDC dengan `viewport.w/h` mentah sehingga kotak *Target Lock* meleset 10%–60% ke kanan-bawah dari posisi pesawat musuh. Kini proyeksi dibagi `this.uiScale` dan `camera.updateMatrixWorld()` dipanggil sebelum proyeksi sehingga kotak lock menempel presisi tepat di badan bandit.
  - **Sinkronisasi `enemy.direction`**: `Enemies.js` kini memperbarui vektor `e.direction.copy(_fwd)` setiap frame (sebelumnya selalu tertinggal di `(0, 0, -1)`), sehingga prediksi *lead* meriam, rudal, dan pendeteksi ancaman bekerja akurat terhadap arah terbang bandit yang sebenarnya.
  - **Koreksi Polaritas Roll Autopilot & Anti-Tabrak Gunung (`_aiTerrainEvade`, `_aiTerrainRisk`, `_safeSpawn`)**:
    - Di `FlightPhysics`, `+roll` memiringkan sayap ke **kiri** dan `-roll` ke **kanan**. Pemulihan darurat medan (`_aiTerrainEvade`) dan lantai ketinggian (`floorPitch`) kini meratakan sayap dengan `clamp(-_aiRight.y * 2.8, -1, 1)` (sebelumnya tanda `+_aiRight.y` terbalik sehingga pesawat terguling terbalik 180° lalu menarik hidung ke bawah menghantam lereng gunung).
    - **Perlindungan Punggung Gunung & Anti-Split-S**: `_aiTerrainRisk()` kini memindai hingga `4,6 detik` ke depan dengan kompensasi tanjakan lereng (`rise`), menjepit titik bidik (`aim.y`) minimal `260 m` di atas puncak punggung bukit di antara pesawat dan target, serta membatasi sudut miring (`bankVert`) agar AI tidak pernah berguling terbalik (*inverted split-S*) saat mengejar musuh yang terbang rendah di lembah gunung.
    - **Koridor Spawn Aman & Lookahead Bandit**: `_safeSpawn()` di peta daratan/pegunungan kini memindai koridor `1,5 km` ke depan arah terbang agar pesawat tidak muncul di dasar lembah tepat di depan dinding gunung, dan musuh (`Enemies.js`) juga memindai ketinggian lereng `1,4–2,6 detik` di depan hidungnya.
  - **Sinkronisasi Auto-Lock View (`LCK`) & Seeker**: kerucut *Target Lock* diperluas sedikit (`0.88` / ±28° hingga `2,8 km`) dan kamera `LCK` otomatis mengikuti target yang sedang dikunci senjata atau diburu AI.

### Changed
- **🧠 AI PILOT TEMPUR SEJATI (`src/core/Game.js`, `src/combat/Weapons.js`)**:
  - **Scored Target Selection & Stickiness**: AI mengevaluasi seluruh bandit setiap detik berdasarkan sudut terhadap hidung pesawat, jarak, dan *stickiness* bonus `+0.5` pada target yang sedang dikejar agar menuntaskan *kill* tanpa berpindah-pindah sasaran.
  - **Solusi Balistik Meriam Iteratif (`_gunSolution`)**: menghitung waktu tempuh peluru 4 iterasi dengan kecepatan moncong `950 m/s` **dan** `45%` warisan kecepatan pesawat sendiri (`GUN_INHERIT`), menghasilkan titik bidik (*gun pipper*) yang presisi.
  - **Lead & Lag Pursuit + Bank-to-Turn**: terbang *lead pursuit* saat mengejar, beralih ke *lag pursuit* (mengincar di belakang ekor musuh) saat jarak `< 650 m` dengan laju mendekat tinggi agar tidak *overshoot*, serta memutar bidang *lift* sayap ke bidang target sebelum menarik *elevator*.
  - **Manuver Bertahan (*Defensive Break-Turn*)**: `_aiAssessThreat()` mendeteksi bandit di ekor (`< 1,5 km` yang mengarahkan hidung ke kita) atau rudal musuh (`< 1,3 km`) dan langsung melakukan *max-G break turn* ke arah penyerang.
  - **Hasil Benchmark Headless (`3 × 90 detik`)**: tingkat *kill* AI melonjak dari **15 kill** menjadi **59 kill** (~4× lipat) dengan pemakaian peluru meriam yang jauh lebih hemat dan 0 *crash*.
- **⚡ OPTIMASI PERFORMA & FRAME RATE (`Clouds.js`, `TrailSystem.js`, `CityGrid.js`, `Sky.js`, `Enemies.js`, `Game.js`)**:
  - **Throttling Awan & Lalu Lintas Kota**: pembaruan matriks `InstancedMesh` awan (`Clouds.update`) kini berjalan pada 20 Hz (menghemat >66% upload buffer matriks GPU), dan simulasi lalu lintas New York (`Traffic.update`) di-throttle ke 30 Hz.
  - **Zero-Allocation Hot Loop**: `Enemies.getAlive()` dan `Enemies.getContacts()` kini memakai array cache pre-alokasi tanpa membuat array/objek baru setiap frame; `TrailSystem` tidak lagi melakukan `.clone()` vektor saat memancarkan asap dan menghentikan upload `BufferAttribute` GPU ketika tidak ada partikel aktif.
  - **Optimasi Matriks Bayangan Matahari & Telemetry**: `Sky.update` hanya menghitung ulang drift matahari 4 kali per detik dan hanya memperbarui matriks kamera bayangan (`sunLight`) saat pesawat berpindah >4 m; `Game._update` berbagi satu pembacaan `telemetry`, `contacts`, dan `combat` untuk HUD, kokpit 3D, dan audio.
  - **Adaptive Resolution Lebih Responsif**: penyesuaian skala resolusi dinamis kini bereaksi dalam 1,2 detik ketika FPS turun di bawah 50 FPS.
- **🧠 AI PILOT LEBIH PINTAR MELAWAN MUSUH (`src/core/Game.js`, `src/combat/Weapons.js`)**:
  - **3D Bank-to-Turn & Roll-Plane Alignment**: AI menghitung sudut bidang belok (`atan2(lateral, vertical)`), memiringkan sayap tepat ke bidang target sebelum menarik pitch penuh, lalu beralih mulus ke *fine-tracking* teredam saat target masuk kerucut depan (`forwardDot > 0.82`) agar bidikan stabil tanpa osilasi.
  - **Komitmen Serangan (*Target Lock Commitment*)**: jika timer *retarget* habis saat musuh sudah berada di depan hidung (`dot > 0.72`, jarak `< 2,5 km`), AI memperpanjang fokus pada target tersebut sampai tuntas ditembak jatuh.
  - **Balistik Meriam 950 m/s & Manajemen Panas (Anti-Overheat)**: perhitungan *lead pursuit* di bawah 1,5 km memakai kecepatan peluru meriam asli (`950 m/s`), menembak baik pada titik prediksi (*lead pipper*) maupun garis lurus (*boresight*), dan otomatis menahan tembakan sejenak saat panas meriam `> 92%` agar meriam tidak pernah terkunci *overheat*.
  - **Manuver Menghindar Rudal & Lead-Homing Missile**: AI melakukan manuver *break-turn jink* sambil melepas flare ketika rudal musuh mendekat `< 1,3 km`, dan rudal yang ditembakkan AI meneruskan target pilihan AI dengan *proportional lead homing* yang lebih tajam.

## [2.0.0] — Mode Edit Tombol Landscape & Portrait Terpisah, Ikon SVG Tombol, Hapus View Overhead, Kokpit Pesawat Tempur Asli
### Added
- **📱 PENYIMPANAN LAYOUT HUD LANDSCAPE & PORTRAIT TERPISAH (`src/hud/HUD.js`)**:
  - Mode edit tombol & HUD (**PENGATURAN → LETAK HUD → GESER**) kini mendeteksi orientasi layar secara otomatis (`getHudOrientation()`) dan menyimpan tata letak, ukuran, serta transparansi masing-masing ke `skybound.hudPos.landscape` dan `skybound.hudPos.portrait`.
  - Memutar perangkat antara *Landscape* dan *Portrait* otomatis menerapkan tata letak yang tersimpan untuk orientasi tersebut tanpa saling menimpa.
  - Panel editor menampilkan indikator orientasi aktif (`LANDSCAPE` / `PORTRAIT`), dan kedua *virtual joystick* (`JOYSTICK KIRI` & `JOYSTICK KANAN`) kini ikut terdaftar sebagai target yang bisa digeser, diperbesar/diperkecil, dan diatur transparansinya.
- **🎯 IKON GRAFIS SVG PADA SETIAP TOMBOL (`src/controls/MobileControls.js`, `src/styles.css`)**:
  - Kelima tombol aksi sentuh dilengkapi gambar ikon vektor SVG sesuai fungsinya: **GUN** (crosshair meriam), **MSL** (rudal pelacak), **FLR** (semburan bintang flare decoy), **BRK** (sirip rem udara/speedbrake), dan **AB** (semburan api afterburner), lengkap dengan aksen warna dan efek glow taktis.
  - Tombol aksi baris atas (`01`, `AI`, `LCK`, `FS`, `?`, `SND`, `PAUSE`) dipercantik dengan latar gradien kaca (*glassmorphism*), siluet ikon vektor, dan highlight neon.
- **🛩️ KOKPIT PESAWAT TEMPUR ASLI (`src/aircraft/Cockpit.js`)**:
  - **Optical HUD Combiner Glass 3D**: kaca reflektor HUD kolimasi transparan di atas *glare shield* lengkap dengan lensa proyektor optik dan proyeksi simbol penerbangan hijau menyala (crosshair, pita kecepatan/ketinggian, Mach, G-load, status kunci rudal).
  - **Artificial Horizon (ADI) & EICAS**: layar panel tengah kini memuat bola *Artificial Horizon* (langit biru / tanah cokelat, tangga pitch, indikator roll) di samping dial kecepatan, ketinggian, dan HSD radar; MFD kiri menampilkan halaman *EICAS Propulsion* lengkap dengan suhu gas buang (`EGT °C`).
  - **Interior Jet Tempur Lengkap**: *Upfront Control Panel* (UFC/ICP) dengan papan tombol & layar DED, sakelar *Master Arm* berpelindung merah, tuas *throttle* ganda yang bergerak maju-mundur mengikuti persentase mesin, tuas roda pendarat (*landing gear*), pedal *rudder* kaki, handel kursi lontar (*ejection seat*) kuning-hitam, tuas pengunci kanopi, kompas magnetik cadangan, dan 3 kaca spion kanopi.

### Removed
- **🎥 VIEW OVERHEAD DIHAPUS (`src/camera/ChaseCamera.js`, `src/core/Game.js`, `src/hud/HUD.js`)**:
  - Siklus kamera kini langsung berpindah bersih antara **01 · CHASE** dan **02 · COCKPIT** tanpa melewati tampilan atas (*Overhead*).

## [1.9.0] — Overhaul 4 Peta: KOTA bergaya New York dengan jalan & lalu lintas hidup, Oasis & Piramida GURUN, Danau Alpin GUNUNG, Mercusuar & Perahu CORAL
### Added
- **🗽 PETA KOTA GAYA NEW YORK (`src/world/CityGrid.js`, `src/world/cityLayout.js`)**:
  - **Grid Jalan Manhattan & Borough**: avenue utara-selatan berjarak 250 m (lebar 26 m) dan cross-street timur-barat berjarak 80 m (lebar 14 m) lengkap dengan tekstur aspal prosedural, garis lajur putus-putus, garis tepi parkir, stop bar, dan zebra cross di setiap persimpangan.
  - **Sungai & Jembatan Gantung**: Pulau Manhattan diapit **Hudson River**, **East River**, dan **Upper Bay** lengkap dengan dinding dermaga (seawall) serta **5 jembatan gantung** (*Brooklyn Bridge* bergaya batu gotik, *Manhattan*, *Williamsburg*, *Queensboro*, dan *George Washington Bridge*) lengkap dengan menara, kabel parabolik, suspender, dan ramp pendekatan.
  - **Lalu Lintas Hidup (Traffic System)**: ratusan kendaraan instanced (**taksi kuning NYC**, sedan warna-warni, dan bus kota biru-putih) bergerak mengikuti arah jalan satu-arah (*one-way*), menjaga jarak antarmobil (car-following), dan berhenti/melaju mengikuti siklus lampu lalu lintas 32 detik di sekitar pemain.
  - **Landmark Ikonik & Central Park**: **Empire State Building** tepat di pusat peta, **Chrysler Building** bergaya art-deco, **One World Trade Center**, **Times Square** dengan papan reklame neon menyala, **Statue of Liberty** di pulau bintang Upper Bay, tangki air kayu khas atap NYC, serta **Central Park** (lengkap dengan Reservoir, The Lake, Great Lawn, dinding keliling, dan ribuan pohon).
  - **Shader Fasad Jendela Prosedural**: gedung menggunakan shader world-space (`makeFacadeMaterial`) dengan tinggi lantai 3,6 m dan modul jendela 3,2 m yang bebas moiré di kejauhan.
- **🏜️ PETA GURUN (OASIS, PIRAMIDA & MESA)**:
  - **4 Oasis Air Jernih**: cekungan mata air yang dipahat otomatis ke terrain (`basins`), dikelilingi cincin rumput hijau subur dan puluhan pohon palem.
  - **Monumen & Formasi Batuan**: 3 piramida batu pasir bertingkat dan 6 bukit batu *mesa / butte* merah bergaya Monument Valley, ditambah pewarnaan lereng bukit pasir yang mulus.
- **🏔️ PETA GUNUNG (DANAU ALPIN & PINUS SALJU)**:
  - **4 Danau Alpin**: danau lembah pegunungan berair biru tua dengan pantai kerikil yang dikelilingi hutan pinus lebat.
  - **Pinus Bersalju (`snowpine`)**: vegetasi konifer bersalju di zona timberline atas sebelum batas salju abadi.
- **🏝️ PETA CORAL (MERCUSUAR, BUNGALOW & PERAHU LAYAR)**:
  - **Mercusuar Pantai**: menara mercusuar merah-putih dengan ruang lentera dan rumah penjaga di tanjung pulau-pulau utama.
  - **Bungalow Pantai & Perahu Layar**: deretan pondok kayu beratap rumbia di teluk teduh serta perahu layar bercadik yang berlabuh di laguna pirus.

## [1.8.1] — Peta GUNUNG lebih lebar, tidak runcing dan tidak berantakan
### Changed
- **⛰️ PROFIL GUNUNG BARU**: height field `mountain` sekarang dibangun dari massif fbm lebar (panjang gelombang ±2,8 km) plus satu crest ridged 1,6 km. Detail frekuensi tinggi 0,0034–0,0065 yang bertabrakan dengan ukuran triangle mesh (±400–600 m) dihapus atau diturunkan drastis, sehingga tidak lagi alias menjadi jarum. Lereng rata-rata turun dari ±1,34 (53°) menjadi ±0,30 (17°), area di atas 42° tinggal ±1%, dan puncak dijaga ±1.800 m agar tetap menjulang.
- **🎨 WARNA LERENG**: peta gunung tidak lagi mengundi warna palet per triangle. Warna diblend halus dari meadow → alpine grass → rock → snow berdasarkan ketinggian, kemiringan, dan patch noise 900 m; batu hanya muncul di muka curam, salju hanya di puncak. Mosaic warna di lereng besar hilang.
- **🌲 VEGETASI & BATU**: tree line mengikuti puncak baru (≤1.000 m), boulder dikurangi (rockScale 1,4), dan `maxSlope` 0,65 supaya pinus tidak menempel di tebing.
- **🧪 GUARD REGRESI**: `tests/test-maps.mjs` kini mengukur lereng dan gagal bila rata-rata >0,55 atau lebih dari 8% wilayah lebih curam dari 42°.

## [1.8.0] — Kampanye 8 misi, peta daratan Kota/Gurun/Gunung, AI pilot profesional, kokpit lega
### Added
- **📖 KAMPANYE CERITA 8 MISI**: menu utama mendapat item **DAFTAR MISI**. Layar kampanye menampilkan delapan kartu misi (BAB 01–08) dengan peta, sasaran, status **SELESAI / AKTIF / TERKUNCI**, progres `01 / 08`, panel cerita + brief, dan tombol **TERBANG / ULANG MISI**. Misi pertama **BADAI PERTAMA** meminta **12 bandit**; misi berikutnya berganti peta dan sasaran — LANGIT KOTA (14), PASIR BERDARAH (16), DINDING GUNUNG (12 + bertahan 90 dtk), PERTAHANAN IBU KOTA (10 + 120 dtk), JALUR PUNGGUNG GUNUNG (18), ARMADA GURUN (20), dan FAJAR TERAKHIR (24). Misi selesai tetap bisa diulang; misi terkunci tidak bisa dipilih.
- **🏁 DEBRIEF MISI**: begitu sasaran kill + waktu bertahan terpenuhi, sorti berhenti di layar debrief berisi nama misi, kill, skor, waktu, cerita bab berikutnya, hadiah airframe, dan tombol **MISI BERIKUTNYA** / **KEMBALI KE MENU**. Progres, airframe baru, dan `CONTINUE` disimpan saat itu juga.
- **🗺️ TIGA PETA DARATAN BARU**: **KOTA** — satu mainland raksasa dengan pusat kota, 1 supertower di titik nol, ratusan menara dan blok beton; **GURUN** — lautan dune dengan kaktus, semak, dan batu; **GUNUNG** — massif bergunung lebar, hutan pinus, dan puncak bersalju. Ketiganya **tanpa lautan**: mesh laut disembunyikan dan diganti ground sheet 80 km pada `y = -0,8`, jadi tidak ada air yang terlihat sampai horizon.
- **🔄 GANTI PETA TANPA RELOAD**: memilih peta di Setting, meluncurkan misi, atau menekan `CONTINUE` kini membangun `World` baru di luar layar, menukarnya ke scene yang sama, memindahkan pesawat/trail/misil/musuh, lalu membuang world lama. `state = 'transition'` + overlay progres kecil menjaga layar tetap hidup; tidak ada muat ulang halaman dan pilihan peta tetap tersimpan.
- **🧠 AI PILOT PROFESIONAL**: autopilot tidak lagi menahan throttle 100%. `AI_SPEED_BANDS` mengatur tenaga berdasarkan jarak, closure rate, sudut hidung, AGL, dan energi: afterburner hanya saat jauh/tertinggal/recovery, airbrake saat closure terlalu tinggi, throttle dinaikkan saat berbelok atau terbang rendah, dan AI tidak pernah membiarkan dirinya stall. Pilot AI kini terbang seperti pursuit pilot, bukan drag racer.

### Changed
- **🛩️ KOKPIT LEBIH LEGA**: FOV kokpit naik dari basis 68° ke **76°**, dan panel DOM radar/engine/weapon/key-hints/flight-status disembunyikan saat view 03 aktif (`.hud.cockpit-active`). Pandangan ke depan jadi bersih; instrumen tetap ada di panel 3D kokpit (MFD kiri/kanan, centre gauges, throttle, stick).
- **🏙️ SKYLINE KOTA**: gedung tinggi dibuat bertingkat (setback, pita jendela, mahkota menyala), menara landmark ditempatkan di ring downtown, dan scatter kota memusatkan 76% properti di radius inti. Batas bangunan naik ke ketinggian terrain 130 m dan kepadatan prop kota 2,4×.
- **⛰️ TERRAIN MAINLAND**: `createArchipelago` kini mengembalikan satu landmass untuk peta daratan; height field punya profil `city` (plateau datar), `desert` (dune band), dan `mountain` (ridged highland). Ring mesh dirapatkan ke pusat agar relief downtown/massif terbaca, sementara rim lebar tetap murah.
- **🧹 PEMBERSIHAN GPU**: `World.dispose()`, `IslandField.dispose()`, serta `Weapons.reattach()` / `Enemies.reattach()` memastikan geometri, material, dan mesh world lama benar-benar dilepas saat ganti peta.
- **📱 SPAWN AMAN**: pesawat selalu muncul minimal 380 m di atas permukaan lokal, sehingga peta gunung setinggi 2 km tidak pernah menjatuhkan jet ke dalam ridge.

### Fixed
- **📦 BUILD STANDALONE**: `scripts/build-standalone.mjs` memakai replacement function, bukan string, sehingga pola `$&` / `$'` di bundle minified tidak lagi menyuntikkan `<script src="dist/game.js">` ke tengah JavaScript. Build sekarang memverifikasi CSS/JS inline byte-for-byte dan gagal keras bila ada korupsi.
- **🌊 KOLISI & KAMERA DI PETA DARAT**: `getWaveHeightAt()` mengembalikan 0 di mainland; kamera chase, collision, dan terrain avoidance memakai sampler yang sama sehingga tidak ada "ombak" palsu atau kamera yang menukik ke ground sheet.
- **🎯 BADGE MISI**: badge HUD memakai misi yang benar-benar diterbangkan (termasuk saat mengulang misi lama), menampilkan `X / Y KILL` plus waktu bertahan bila ada, dan kembali ke **FREE FLIGHT** setelah debrief.

### Tests
- `tests/test-maps.mjs` (baru): membangun KOTA, GURUN, dan GUNUNG; memverifikasi mainland tunggal, laut tersembunyi, ground sheet 80 km, terrain kering di ring 2,2 km, spawn aman, 381 gedung kota + 1 supertower di pusat, 130 menara downtown, dune tanpa gedung, serta massif gunung >700 m dengan hutan pinus.
- `test-career.mjs`: 8 misi, target 12 kill, unlock berantai, replay tidak memundurkan progres, menu 6 item, kartu misi selesai/aktif/terkunci, dan label ULANG MISI.
- `test-game.mjs`: CONTINUE otomatis berganti ke peta misi tanpa reload, pemilihan peta in-place (KOTA/GURUN/CORAL), debrief 12 kill, dan reset HUD setelah debrief.
- `test-hud.mjs`: seluruh ID layar kampanye/debrief/loading memiliki elemen DOM.
- `npm test` (9 suite), `npm run test:world:high`, dan `test:game` sepuluh kali berturut-turut **hijau**.

## [1.7.1] — AI tidak lagi menukik ke ground saat mengejar target acak
### Fixed
- **💥 AI CRASH KE TERRAIN**: setelah target acak V1.7.0 diperluas ke seluruh area musuh, AI bisa memilih bandit yang terbang rendah lalu mengikuti jalurnya sampai menukik ke laut/lereng. Perlindungan lama hanya membaca AGL saat itu (<230 m), tanpa melihat ke depan, sehingga keputusan membelok datang terlambat.
- **🛰️ PREDIKSI LINTASAN 0,8–3,5 DETIK**: `_aiTerrainRisk()` sekarang memproyeksikan posisi jet pada 0,8 / 1,5 / 2,4 / 3,5 detik ke depan memakai velocity frame sebelumnya, mengambil selisih terendah terhadap terrain **dan** puncak ombak, lalu membandingkannya dengan margin aman. Bahaya terdeteksi ratusan meter sebelum kontak.
- **🚨 MODE RECOVERY STICKY**: saat bahaya, AI membatalkan pengejaran, menahan tembakan/misil, meratakan sayap, pitch-up penuh, throttle 1, dan afterburner. Mode ini tidak langsung lepas; ia baru berakhir setelah AGL >620 m **dan** seluruh lintasan prediksi >420 m, sehingga jet tidak langsung menukik lagi setelah satu frame aman. Bila posisi inverted, AI roll keras sambil tetap menarik pitch agar tidak jatuh terbalik.
- **📉 BATAS MENUKIK & MEMBELOK DEKAT TANAH**: di bawah 900 m AGL input pitch negatif dibatasi dan memudar sampai nol di 260 m; di bawah 600 m AGL bank dibatasi karena membelok mengorbankan lift. Lantai pitch juga dinaikkan dari 230 m ke 560 m AGL. Target acak tetap dikejar, tetapi pesawat tidak pernah mengikutinya sampai ground.

### Tests
- `test-game.mjs`: skenario dive buatan (pitch −1,15 rad, 820 m, target bandit di 220 m) membuktikan look-ahead menyalakan `_aiTerrainEvade`, AI menarik pitch >0,5, dan AGL minimum tetap >100 m selama 5 detik; seluruh state fisika/bandit dipulihkan setelah tes.
- `test-game.mjs`: uji nose-on kini diterbangkan di ketinggian aman dengan bandit diam di depan, sehingga perlindungan terrain tidak lagi membuat hasil tes acak.
- `test-combat.mjs`: uji engagement memarkir player proxy di dekat bandit terdekat, karena spawn ring V1.7.0 yang lebar memang bisa menahan semua bandit di luar `engageRange` selama beberapa detik.
- `npm test` (8 suite), `npm run test:world:high`, dan test-game tiga kali berturut-turut **hijau**.

## [1.7.0] — Area musuh lebih luas, AI target acak, misil instan saat lock, defense 30%, panel jeda rapi
### Added
- **🛡️ DEFENSE PESAWAT 30%**: seluruh damage masuk — misil musuh langsung (42), proximity (21), meriam musuh (8), dan splash misil (26) — kini dipotong **30%** di choke point `Game._drainCombatEvents` sebelum menyentuh hull. Misil langsung terasa 29,4 damage, proximity 14,7, dan meriam 5,6; nilai defense disimpan di `game.defense = 0.3` agar mudah diuji/di-tune.
- **⚙️ PENGATURAN DI PANEL JEDA**: panel jeda tidak lagi memuat daftar setting yang panjang. Empat tombol bersih: **RESUME FLIGHT**, **PENGATURAN**, **RESTART SORTIE**, dan **KEMBALI KE MENU**. Tombol PENGATURAN membuka layar Setting yang sama dengan menu utama (grafik, HUD side, skala UI, auto lock, tombol sentuh, giro + kalibrasi, peta, sensitivitas, keymapping) — ditambah baris **AUDIO**, **CAMERA**, dan **LETAK HUD** yang sebelumnya hanya ada di panel jeda. Tombol kembali berubah menjadi **← KEMBALI** dan mengembalikan pemain ke panel jeda, bukan ke kokpit; Esc/P juga menutup Setting dulu sebelum resume.
- **🏠 KEMBALI KE MENU SAAT PAUSE**: tombol baru memarkir sorti dan mengembalikan kamera ke attract-mode menu. Pointer lock dilepas, input dibersihkan, autopilot dimatikan, semua sub-screen ditutup, dan pemain bisa langsung memulai sorti baru dari menu.

### Changed
- **🌍 AREA TERBANG MUSUH DIPERLUAS**: spawn bandit bergeser dari ring 2,0–3,5 km ke **3,2–5,2 km**, waypoint patroli dari 1,5–3,9 km ke **2,4–5,4 km**, dan `engageRange` naik dari 2.800 m ke **3.600 m**. Musuh tetap terlihat di radar taktis 7,5 km, tetapi pertempuran tidak lagi dimulai dengan bandit menempel di hidung pesawat — pemain harus memburu kontak di sektor yang lebih luas.
- **🎲 AI TIDAK LAGI MENGUNCI SATU TARGET**: Auto Pilot kini memilih **bandit hidup secara acak** (bukan selalu yang paling dekat / yang ditunjuk panah ancaman), mempertahankannya 6–10 detik, lalu mengacak ulang. Steering tetap lead pursuit penuh ke target pilihan, jadi AI tetap agresif tanpa terpaku pada satu musuh.
- **🚀 MISIL AI LANGSUNG SAAT LOCK**: jeda tunggu `AI_LOCK_TIME = 0,55 dtk` dihapus. Begitu bandit masuk kerucut seeker (dot > 0,94 · < 2.600 m), lock tone berbunyi dan misil langsung dilepas pada frame yang sama — hanya jarak arming > 400 m dan cooldown rack 1,6 dtk yang membatasi. Cooldown mencegah spam, dan target baru tetap memicu tone baru.

### Tests
- `test-game.mjs`: pemilihan target AI acak (deterministik lewat stub `Math.random`, termasuk timer 6–10 dtk), misil instan pada frame lock + cooldown menahan tembakan kedua, defense 30% (hit 40 → hull −28), alur pause → PENGATURAN → kembali → KEMBALI KE MENU, serta regresi nose-on yang kini mengunci target AI yang sama.
- `test-hud.mjs`: panel jeda hanya berisi empat tombol dan tidak lagi memuat baris setting; Setting bisa dibuka dari pause, tombol kembali berlabel **← KEMBALI**, dan baris AUDIO/CAMERA/LETAK HUD ada di layar Setting.
- `npm test` (8 suite) dan `npm run test:world:high` **hijau**; test-game dijalankan tiga kali berturut-turut untuk memastikan tidak flaky setelah radius spawn diperbesar.

## [1.6.0] — Auto Lock berbunyi, AI tunggu lock sebelum tembak, auto flare, joystick ikut AI
### Added
- **🔊 SUARA AUTO LOCK AI**: saat bandit masuk **kerucut lock** AI (dot > 0,94 · jarak < 2600 m), pilot AI membunyikan **lock tone** (`lockTone`, chirp 880/1320 Hz) tepat saat akuisisi, lalu **tik `uiBlip(1150 Hz)` tiap 0,3 dtk** selama seeker menetap — pemain bisa mendengar proses penguncian sebelum misil dilepas.
- **🎯 AI HANYA MENEMBAK MISIL SETELAH LOCK TAHAN**: misil tidak lagi dilepas begitu bidikan di bore-sight. Kini AI menahan lock **0,55 dtk** (`AI_LOCK_TIME`) dengan jarak > 400 m dan cooldown ter-arm baru meluncurkan misil; setelah tembak state lock di-reset sehingga peluru berikutnya butuh akuisisi baru. Meriam tetap otomatis di bore-sight < 1500 m.
- **🛡️ AUTO FLARE MODE AI**: bila **missile musuh terdeteksi** (`getIncoming`) masuk dalam **1600 m** (`AI_FLARE_RANGE`) dan stok masih ada, AI otomatis menyalakan countermeasure — dikonsumsi lewat jalur `deployFlares` yang sama (cooldown 0,7 dtk, stok 15), jadi tekanan **V/FLR manual tetap berfungsi**. Berlaku **hanya di Mode AI**; terbang manual tetap memakai V.
- **🕹️ JOYSTICK IKUT GERAK AI (MODE AI)**: `MobileControls.setAutopilotDrive()` menggerakkan **knob kiri = pitch/roll** dan **knob kanan = yaw/throttle** (inverse pemetaan `setStick`) mengikuti perintah pilot AI, sehingga pemain bisa *melihat* AI menerbangkan stick. **Visual only** — penerbangan tetap memakai input AI langsung, dan **jari pemain menang** bila sedang memegang stik; knob kembali ke tengah saat AI dilepas atau kontrol disembunyikan.

### Tests
- `test-game.mjs`: siklus lock AI (tone bunyi dulu → misil tunggu lock hold → cooldown ter-arm), auto flare (tanpa inbound → senyap, inbound 900 m → satu salvo terpakai, langit bersih → senyap) dengan restore state, nose-on yang kini deterministik (sudut start dipilih, AI + fisika tanpa langkah combat, boost di-restore), dan setup impact terrain yang disikapkan agar tidak lagi tergantung sisa manuver.
- `test-mobile.mjs`: drive joystick AI (knob bergerak sesuai input AI, input ekstrem di-clamp ke dalam well, recentre saat AI lepas, jari menang saat stik dipegang).
- `npm test` (8 suite) dan `npm run test:world:high` **hijau**.

## [1.5.0] — Auto Pilot AI, panah ancaman menyeluruh, 3 peta baru
### Added
- **🤖 AUTO PILOT (AI · MODE AGGRESSIVE)**: tombol **AI** di baris aksi atas mengaktifkan pilot otomatis yang terbang agresif — **lead pursuit** ke bandit terdekat, **throttle penuh + afterburner**, **hindaran terrain** (otomatis naik bila AGL < 230 m), serta **tembak otomatis** (meriam saat bidikan di bore-sight < 1500 m, misil sesuai cooldown). Mode ini **hanya berlaku selama sorti** (tidak tersimpan), dianimasikan di tombolnya sendiri, dan bisa dilepas kapan saja untuk mengambil alih stick.
- **🧭 PANAH ANCAMAN UNTUK SEMUA MUSUH**: container `#threat-arrows` berisi **pool panah per bandit** — setiap musuh hidup mendapat chevron sendiri di cincin sekitar crosshair (heading-up), berlabel **jarak (KM/M)**, panah terdekat ditandai `nearest`, dan seluruh container disembunyikan saat langit bersih. Jumlah panah mengikuti kontak radar secara real-time.
- **🗺️ 3 PETA BARU + PETA CORAL**: baris **PETA DUNIA** di SETTING dan panel jeda memilih **CORAL** (bawaan), **KOTA** (skyline blok + jalan), **GURUN** (gurun pasir, kaktus, bukit), dan **GUNUNG** (puncak bersalju, hutan pinus, tebing). Pilihan tersimpan (`skybound.map`), bisa juga lewat `?map=`, dan menerapkan palet terrain/langit/laut, properti (gedung/kaktus/shrub), ambang kemiringan, garis salju serta statistik dunia yang berbeda; ganti peta memuat ulang dunia lewat pola quality yang sama.
- **📐 KALIBRASI GIRO DI MODE LANDSCAPE**: tombol **KALIBRASI** di SETTING dan panel jeda meng-ulang nol kemiringan giroskop; **kalibrasi menangkap offset SETELAH transformasi orientasi layar**, sehingga tetap akurat saat layar diputar ke landscape. Giroskop otomatis mengkalibrasi ulang pada `orientationchange` / `screen.orientation` dan pemetaan `β/γ` diputar sesuai sudut layar (identik pada θ=0, tanpa regresi portrait).

### Fixed
- **🖱️ Tombol editor HUD (UKURAN / TRANSPARAN / RESET / ×) kembali bisa diklik**: blok `.hud-editor` kini `pointer-events: auto` (sebelumnya tidak pernah menerima klik karena induk `.hud` memakai `pointer-events: none`), ditambah ukuran sentuh 32 px pada `@media (pointer: coarse)` — perubahan ini dijaga test regresi berbasis CSS.
- **🗺️ Toast peta memakai nama lokal** (`PETA KOTA`, bukan `PETA CITY`).
- **✈️ Sikap pesawat dinetralkan** saat Auto Pilot dilepas pada test integrasi, agar pemeriksaan kendali manual mengukur input pilot.

### Tests
- `test-game.mjs`: siklus Auto Pilot (aktivasi, input AI, tembak/misil di bore-sight, tarikan ke bandit, lantai terrain, pelepasan), satu panah per kontak + sorotan `nearest`, pemilih peta (persist + reload seam), tombol kalibrasi giro, dan regresi kendali terbang.
- `test-hud.mjs`: markup & state tombol AI, pool `#threat-arrows`, baris peta/kalibrasi, dan regresi CSS `pointer-events` editor HUD.
- `npm test` (8 suite) dan `npm run test:world:high` **hijau**.

## [1.4.0] — Kustomisasi HUD menyeluruh, Auto Lock View, Pointer Lock
### Added
- **🔍 SKALA UI (80–160 %)**: slider di layar SETTING dan panel jeda memperbesar/memperkecil seluruh HUD dan layar menu. Desktop memakai **110 %** sebagai default, layar sentuh tetap **100 %**; nilai tersimpan di `localStorage` (`skybound.uiScale`).
- **🎯 AUTO LOCK VIEW**: tombol **LCK** di baris kanan atas, tombol **L**, serta pilihan HIDUP/MATI di SETTING dan panel jeda. Kamera chase mengunci target senjata yang masih hidup atau bandit terdekat dalam **7 km**, lalu terus membingkainya; kotak lock HUD ikut target tersebut. Preferensi tersimpan (`skybound.autoLock`).
- **🖱️ Pointer Lock saat terbang**: klik kanan/kiri, mulai sorti, dan resume meminta pointer lock; gerakan mouse memakai delta mentah. Kursor otomatis dilepas saat jeda, crash, menu utama, atau keluar dari sorti, dan klik kanvas bisa mengunci ulang.
- **🧩 Editor HUD diperluas**: selain panel senjata/radar/ancaman/mesin/status dan tombol sentuh, kini pita kecepatan/ketinggian, tag kamera, petunjuk tombol, blok brand/misi, kompas, info atas, serta semua tombol aksi atas (**01, LCK, FS, ?, SND, jeda**) dapat digeser, diukur, dan diatur transparansinya sendiri-sendiri.
- **🛩️ Cockpit selalu menghadap depan**: view 03 mengabaikan input mouse dan mereset orbit, sehingga pandangan pilot tidak pernah melenceng dari hidung pesawat.

### Changed
- **🚀 Misil tanpa batas**: stok tidak lagi berkurang; setiap peluncuran memiliki **cooldown 1,5 detik** dan maksimal **6 misil** boleh berada di udara. Panel senjata menampilkan `∞`.
- **🛡️ Flare 15 kanister**: setiap tekan V/FLR memakai satu kanister (4 decoy), stok awal dan reset kembali ke **15**.
- Indikator panas meriam **HEAT/OVERHEAT** dihapus dari panel senjata HUD dan MFD kokpit; mekanik panas internal tetap ada sebagai pembatas tembakan.
- Keymap tetap **18 aksi**: slot `R / reset` diganti `L / AUTO LOCK`.

### Removed
- Shortcut **R** untuk reset/restart sorti dihapus sepenuhnya dari keymap dan penanganan keyboard, agar tidak ada reset tidak sengaja. Reset tetap tersedia lewat tombol eksplisit **RESTART SORTIE** di panel jeda.

### Fixed
- Kursor tidak lagi tersembunyi setelah jeda/crash/menu saat Pointer Lock dilepas.
- Kartu bantuan (**H**) ikut melepas Pointer Lock agar tombolnya bisa diklik, lalu mengunci ulang saat ditutup.
- Posisi/ukuran/transparansi widget HUD baru tetap konsisten saat skala UI diubah karena koordinat editor disimpan dalam ruang tak terskala.

### Tests
- `test-combat.mjs`: misil tak terbatas + cooldown 1,5 dtk, stok flare 15, dan pengosongan 15 salvo.
- `test-game.mjs`: persistensi skala UI & auto-lock, siklus Pointer Lock (mulai, pause, kursor, kartu bantuan), auto-lock target, cockpit yang mengabaikan mouse look, serta tidak ada binding/aksi reset **R**.
- `test-hud.mjs`: tidak ada elemen heat/OVERHEAT, tampilan `∞`, slider skala UI, toggle auto-lock, dan registrasi seluruh target editor HUD baru.
- `npm test` (8 suite) dan world test kualitas tinggi (`QUALITY=high`) **hijau**.

## [1.3.0] — Menu utama, hangar & misi, layar setting, radar ancaman
### Added
- **🏠 Menu utama 5 item**: **1 NEW GAME** (membuka hangar), **2 CONTINUE** (melanjutkan sorti tersimpan), **3 SETTING**, **4 ABOUT**, **5 EXIT** — dioperasikan lewat panah/Enter/Space/Esc maupun tap; **CONTINUE** otomatis nonaktif bila belum ada save.
- **✈️ Hangar 5 pesawat**: **F-31 WRAITH** dan **T-6 SPARROW** terbuka sejak awal; **A-14 THUNDERBOLT**, **F-40 GHOST**, **B-2 TITAN** terkunci sampai misinya selesai. Setiap kartu menampilkan statistik terbang (top speed, kelincahan, lambung, senjata) dan status kunci; Enter/Space = lepas landas.
- **🎯 Misi & unlock (karier)**: 3 misi berurutan berbasis kuota kill. Saat kuota tercapai: toast `MISI 0X SELESAI · <pesawat> TERBUKA`, pesawat terbuka, progres disimpan ke `localStorage`, dan **CONTINUE** menyala. Satu kuota = satu clear (tidak pernah dobel), badge misi di header kini menampilkan nama misi + `X / Y KILL` (hijau saat tuntas) lalu kembali ke `FREE FLIGHT`.
- **⚙️ Layar SETTING**: **GRAPHIC** (LOW/MED/HIGH), **HUD SIDE** (KIRI/KANAN), **TOMBOL** (KIRI/TENGAH/KANAN), **GIRO**, **SENSITIF GERAK** (slider 0.4–2.5 yang benar-benar mengubah redaman kendali & rentang giroskop) dan **KEY BUTTON** — keymapping **18 aksi** dengan keycap, klik untuk rebind (menolak duplikat dengan pesan `TIDAK BOLEH DUPLIKAT`, Esc membatalkan) plus tombol **reset**. Semua tersimpan per device dan tetap sinkron dengan panel jeda.
- **ℹ️ Layar ABOUT**: kredit pembuat **HeavyRain AKA Ziky Andeska**, ringkasan kontrol, dan kartu info build (`VERSION 1.3.0`).
- **🚪 Layar EXIT**: konfirmasi **TERIMA KASIH** + `window.close()` berjaga — bila browser menolak, muncul catatan “tutup tab ini secara manual”.
- **🎯 Panah arah lawan**: panah kecil mengitari reticle dan menunjuk bandit **terdekat** pada bingkai heading-up (0° = lurus di depan, +90° = kanan), lengkap dengan label jarak yang selalu tegak; otomatis hilang saat tidak ada kontak.
- **📡 Radar kecil “THREAT SCOPE” di sisi kiri**: kanvas bundar khusus bandit — ring jarak, silang kartinal, sapuan, penanda kapal sendiri, blip oranye (yang terdekat diberi sorot, kontak di luar range dijepit ke tepi) plus pembacaan jumlah & jarak terdekat. Tampil juga di layar sentuh tempat radar taktis disembunyikan di bawah stik, bisa diseret/diubah ukurannya lewat **LETAK HUD**, dan sengaja `pointer-events: none` agar tidak pernah menelan tap tombol.

### Changed
- `InputManager.clearKeys()` kini benar-benar mengosongkan aksi yang sedang aktif — tombol Escape dari menu tidak lagi membocorkan aksi **jeda** ke dalam penerbangan.
- Setelah rebind berhasil, HUD memperbarui pemetaan + keycap sehingga tombol langsung tercatat dan ter-*repaint* (sebelumnya keycap tidak ikut berubah).
- `package.json` dan seluruh penanda versi menyatu ke **1.3.0**.

### Tests
- Suite `test-career.mjs` diperluas: hangar/kunci pesawat, simpanan karier, badge misi, layar Setting/About/Exit, rebind (ok/konflik/batal) dan reset keymap.
- `test-game.mjs`: guard CONTINUE, peluncuran pesawat tersimpan, wiring sensitivitas/keymap ke `InputManager`, alur kredit About + Exit (`window.close` distub), hormati sub-screen saat Enter, **kuota misi membuka A-14 THUNDERBOLT**, dan **panah ancaman + radar kecil yang disuplai kontak bandit sungguhan**.
- `test-hud.mjs`: seluruh id baru ada di DOM, sudut panah diverifikasi lewat turunan bearing independen (lurus depan / di lambung), label jarak, sembunyi saat bersih, dan kontak yang benar-benar digambar ke kanvas radar kecil.
- `npm test` (**8 suite**) dan `npm run test:world:high` **hijau**.

## [1.2.0] — Flare anti-missile, tombol view, layar loading, fullscreen
### Added
- **🛡️ Flare anti-missile** (tombol **V** / tombol sentuh **FLR**): satu tekan melepas **4 decoy**, stok **6 salvo**, cooldown 0.7 dtk, decoy menyala ±7 dtk. Decoy dalam 1000 m **memikat** misil masuk → toast `MISSILE DECOYED · +50 PTS` (+50 skor), misil meledak tanpa membahayai; begitu decoy padam pencari **mengunci ulang** pesawat sehingga salvo berikutnya bisa memikat lagi.
- **🚀 Misil IR bandit**: bandit meluncurkan misil ke pemain hanya dari posisi ngejar rapi (jarak 380–1750 m, alignment > 0.985, cooldown 26–42 dtk). **Hit langsung −42 hull**, letusan proximity < 45 m **−21 hull**; misil permusuhan tidak pernah menyakiti bandit sendiri.
- **🔁 Tombol ganti view `01`** di baris tombol kanan atas (di depan `?`/SND/jeda): siklus **CHASE → OVERHEAD → COCKPIT**, labelnya ikut berubah dan sinkron dengan tombol **C** serta tombol view di layar jeda.
- **🎬 Layar loading baru**: sejak paint pertama sudah tampil wordmark SKYBOUND (outline), ring radar menyapu, **progress bar + label + persentase**, 3 tips pilot bergantian, spinner dan sudut-sudut HUD. Overlay memudar saat dunia siap, dan **membuka lagi sebagai panel error** kalau boot gagal (`BOOT FAILURE // …`).
- **⛶ Tombol fullscreen `FS`**: feature-detect (API normal + `webkit`), otomatis disembunyikan bila browser tidak mendukung; status tombol ikut sinkron saat keluar lewat ESC.
- **📊 Dua sel baru di panel senjata**: `FLARES` (sisa flare, merah saat habis) dan `INBOUND` (jarak misil masuk — `850M` / `1.5K` / `—`).
- **⚠️ Peringatan prioritas** `MISSILE INBOUND // FLARE NOW` (di atas PULL UP/STALL) plus toast `MISSILE LAUNCH DETECTED` + kilatan layar saat bandit meluncurkan misil.
- **🔊 Suara flare baru** `flareBurst()` — derau bandpass menyusut 3.2 kHz → 700 Hz selama 0.5 dtk.
- **🔘 Tombol touch FLR** (emas pucat) di antara MSL dan GUN, bisa digeser sendiri saat mode LETAK HUD; di layar portrait sempit cluster tombol jadi **grid 2 kolom** agar menumpuknya tidak menabrak bar status.
- Kunci **V** masuk daftar `GAME_KEYS` + baris bantuan keyboard (`V · Deploy flares`).

### Changed
- Overlay boot **tidak lagi dihapus** saat HUD dibangun — kini menjadi layar loading sungguhan yang digerakkan `setProgress()` / `setReady()`, dengan `showBootFailure()` untuk panel gagal-boot.
- Pool decoy dinaikkan menjadi **24** (6 salvo × 4) supaya seluruh stok bisa berada di udara sekaligus; salvo ditolak lebih dulu saat pool penuh sehingga stok tidak terpotong percuma.
- `SKYBOUND.html` (build standalone) kini **873 KB**.

### Tests
- Suite baru: peluru API misil permusuhan (hit langsung 42, proximity 21, splash ramah bandit), pemikatan decoy + penghabisan stok, peluncuran bandit paksa, tombol view/fullscreen, overlay loading & panel gagal-boot, peringatan inbound, tombol FLR.
- `npm test` (7 suite) dan `npm run test:world:high` **hijau**.

## [1.1.0] — Editor HUD per-panel, kokpit & stik kontrol
### Added
- **✏️ Editor HUD per-panel** (Pause → **LETAK HUD → GESER**): tiap panel (SENJATA, RADAR, MESIN, strip status) dan tiap tombol touch (GUN, MSL, AB, BRK) jadi panel terpisah — **seret** untuk memindah, **ketuk** untuk membuka editor: **UKURAN 50–200 %** dan **TRANSPARAN 20–100 %** (langkah 10 %), plus **RESET PANEL INI**.
- Semua penempatan/ukuran/transparansi **tersimpan per device** (`localStorage`) dan bertahan setelah reload; tombol yang belum disentuh ikut mengikuti preset tata letak tombol.
- **Panel senjata dipecah** jadi sel-sel kecil (HULL, HEAT, MISSILES, KILLS, SCORE, LOCK) agar muat di layar sempit.
- **Stik kontrol 3D di kokpit** (view 03) yang ikut miring mengikuti input pitch/roll live.

### Fixed
- Tampilan kokpit (view 03) dan visibilitas airframe diperbaiki — kini kokpit benar-benar menempel pada kamera (ikut getaran dan free look).

## [1.0.0] — Rilis awal
### Added
- **Dunia prosedural**: kepulauan koral 15 pulau (siluet, shelf pesisir, pantai, bukit, puncak), laut low-poly beranimasi (ombak, buih, pantulan langit), LOD pulau, hutan instanced broadleaf/pine/palm + bebatuan, awan kumulus, kubah langit dengan matahari bergerak.
- **Pesawat F-31 WRAITH** low-poly: permukaan kendali beranimasi (aileron, elevator, rudder, keluaran mesin), efek afterburner/shock diamond/uap sayap, bayangan tanah dinamis.
- **Model penerbangan kuaternion**: pitch/roll/yaw teredam, bank terkoordinasi, trading energi, **afterburner** dengan cadangan habis-regen, air brake, stall dan telemetri G.
- **Kamera**: chase damped, orbit mouse + zoom roda, **3 view** (CHASE / OVERHEAD / COCKPIT dengan interior 3D + MFD kanvas hidup), kamera sinematik di menu.
- **Combat**: skuadron bandit (patroli/engage/break, lead pursuit, hindar terrain, tembakan burst, respawn), meriam dengan panas/overheat, **6 misil homing** dengan kunci, fusi proximity & terrain, splash damage, sistem ledakan/partikel, kotak lock proyeksi dan radar kontak.
- **HUD militer**: pita IAS/ALT, Mach, radar altimeter, V/S, kompas geser, pitch ladder, flight-path marker, segmen boost, status mesin/diagnosis, jam misi, FPS/quality, layar jeda & layar kras dengan hitungan redeploy.
- **Tata letak responsif** desktop/tablet/phone + safe-area; kontrol sentuh (2 stik virtual, tombol aksi) dan **steering giroskop** (HP jadi yoke).
- **Audio WebAudio prosedural**: deru turbofan/jet/angin/afterburner, UI blip, retakan meriam, whoosh misil, ledakan, hit lambung, lock tone, impact kras.
- **Rendering pixel-art** opsional (render target rendah + nearest upscale, dither Bayer, kuantisasi warna) dengan 3 preset quality otomatis + adaptive clamp.
- **Satu file mandiri** `SKYBOUND.html` (CSS+JS ter-inline) — cukup dobel-klik, tanpa server.

---

## Rilis
- Build: `npm run build:all` → `dist/` + `SKYBOUND.html`
- Test: `npm test` (8 suite) dan `npm run test:world:high`
- Berkas akhir: `/storage/emulated/0/Download/HRAI/SKYBOUND/`
