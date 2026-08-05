# Arsitektur Pesona SuperApp

**Status:** Draf untuk persetujuan
**Tanggal:** 2 Agustus 2026
**Penyusun:** Ulpermadi Ibrahim (arsitek/lead dev)
**Sumber regresi:** `garuda-superapp`
**Sasaran:** superapp multi-vertikal berbasis koperasi dengan inti operasi gaya ride-hailing, skala target 10 juta pengguna terdaftar

---

## 1. Ringkasan keputusan

| # | Keputusan | Pilihan |
|---|---|---|
| ADR-001 | Gaya arsitektur | Modular monolith + ekstraksi selektif (*service-based architecture*), **bukan** microservices |
| ADR-002 | Struktur repositori | Satu monorepo pnpm workspaces + Turborepo |
| ADR-003 | Framework `core-api` | Tetap Express + TypeScript (maksimalkan reuse dari garuda) |
| ADR-004 | Strategi migrasi | Salin penuh dari garuda-superapp, lalu refactor di tempat |
| ADR-005 | Runtime produksi | Kontainer sejak hari pertama; Kubernetes menyusul saat trafik ada |
| ADR-006 | Strategi PWA | PWA untuk konsumen dan merchant; driver **wajib native**. PWA offline bersifat baca-saja |
| ADR-007 | Pola navigasi | Bottom tab bar untuk permukaan konsumen dan mitra; sidebar hanya untuk back-office |

**Angka pokok:** 6 deliverable aplikasi (7 folder), 2 permukaan PWA (tanpa folder baru), 12 modul domain backend, 4 artefak backend yang dapat di-deploy, 16 paket workspace.

---

## 2. Architecture Decision Records

### ADR-001 — Modular monolith + ekstraksi selektif

**Konteks.** Pesona adalah sistem finansial: memposting jurnal GL, memutasi saldo dompet, menerbitkan KTA. Konsistensi dan auditabilitas lebih mahal daripada kecepatan rilis.

**Keputusan.** Sembilan dari dua belas modul domain hidup dalam satu proses `core-api` dengan satu database PostgreSQL dan transaksi ACID. Tiga modul diekstrak menjadi layanan terpisah **hanya karena profil beban kerjanya berbeda secara fisik**, bukan karena alasan organisasi.

| Layanan terekstrak | Alasan teknis |
|---|---|
| `dispatch` | Stateful, indeks geo in-memory, target latensi <100 ms, butuh partisi sticky per zona |
| `location` | 100k+ tulis/detik dari ping GPS; profil tulis dan datastore berbeda total (Redis, bukan Postgres) |
| `notification` | Bursty dan IO-bound; harus dapat di-scale sendiri saat broadcast massal |

**Konsekuensi.**
- Posting jurnal GL, mutasi saldo, dan settlement tetap dalam satu transaksi database. Ini keunggulan yang hilang kalau dipecah jadi microservices.
- Empat artefak backend dapat di-scale independen sesuai pemicunya masing-masing.
- Batas antar modul di dalam `core-api` **harus ditegakkan otomatis** oleh CI, bukan oleh niat baik. Tanpa ini, dalam 18 bulan strukturnya kembali menjadi monolit kusut.

**Penegasan istilah.** Kubernetes tidak mensyaratkan microservices. Modular monolith yang dikontainerisasi berjalan normal di K8s dengan HPA pada 20–50 pod. Untuk 10 juta pengguna terdaftar (realistis 100–300 ribu concurrent di puncak), leher botolnya adalah *write* PostgreSQL — dan memecah aplikasi menjadi microservices tidak menyelesaikan masalah itu.

---

### ADR-002 — Satu monorepo dengan pnpm workspaces

**Konteks.** Sebelas folder proyek dengan kontrak API dan design system yang sama. Pengalaman di garuda menunjukkan kesulitan mengontrol workspace ketika artefak tersebar.

**Keputusan.** Satu repositori `pesona/` dengan `pnpm-workspace.yaml`. Total 16 paket workspace: 7 aplikasi, 4 layanan, 5 paket bersama.

**Klarifikasi penting.** 12 modul domain **bukan** 12 paket workspace. Sembilan di antaranya adalah folder di dalam `services/core-api/src/modules/`, bukan paket npm terpisah.

**Monorepo bukan mono-deploy.** Satu repositori tetap menghasilkan artefak yang di-build dan di-deploy sendiri-sendiri ke host masing-masing. Turborepo `--filter=...[origin/main]` hanya membangun yang berubah.

**Konsekuensi.**
- Tipe API tidak diduplikasi; `packages/contracts` menjadi satu-satunya sumber kebenaran.
- Risiko yang harus dimitigasi sejak awal adalah **waktu CI**, bukan skalabilitas produksi. Dengan 16 paket, CI naif akan membangun semuanya tiap commit. Wajib memakai Turborepo remote cache dan build *affected-only*.

---

### ADR-003 — `core-api` tetap memakai Express

**Konteks.** `garuda-superapp` memiliki ~51.000 baris route yang sudah teruji di 44 modul `server/routes/*.ts`, ditambah `routes.ts` sebesar 224 KB. Logika GL dan dompet di dalamnya adalah aset paling mahal di repositori ini.

**Keputusan.** Pertahankan Express + TypeScript. Batas modul ditegakkan oleh `eslint-plugin-boundaries` / `no-restricted-imports` di CI, bukan oleh framework.

**Alternatif yang ditolak.** NestJS memaksa batas modul lewat sistem modul dan DI — secara desain lebih cocok untuk modular monolith — tetapi menuntut penulisan ulang seluruh route. Biayanya tidak sebanding pada tahap ini. Keputusan ini dapat ditinjau ulang setelah Fase 2.

---

### ADR-004 — Salin penuh, lalu refactor di tempat

**Keputusan.** Salin `garuda-superapp` ke struktur Pesona apa adanya, kemudian pecah menjadi modul secara bertahap.

**Risiko yang harus dikelola.**
- Root `garuda-superapp` menyimpan ~200 MB artefak `.zip`, folder `backups/` dan `.backup_sys/`. **Penyalinan harus selektif** — jika ikut terbawa, repositori Pesona lahir sudah gemuk dan riwayat git-nya tidak dapat diperbaiki dengan mudah.
- `.env` (13 KB) sudah benar berada di `.gitignore` dan tidak ter-track di git. Jangan disalin apa adanya: seluruh kredensial harus dirotasi untuk lingkungan baru.
- Utang teknis ikut terbawa. Mitigasinya adalah menetapkan batas modul dan aturan CI **sebelum** kode pertama dipindahkan, bukan sesudahnya.

---

### ADR-005 — Kontainer sejak awal, Kubernetes menyusul

**Keputusan.** Semua layanan punya `Dockerfile` multi-stage sejak commit pertama. Manifest K8s (Helm) disiapkan di `infra/k8s/` tetapi tidak wajib dipakai sampai trafik membenarkannya.

**Alasan.** Kontainerisasi murah dan membuat lingkungan reprodusibel. Kubernetes pada 100 pengguna adalah biaya operasional tanpa manfaat. Yang penting adalah aplikasi *siap* dipindahkan, bukan sudah dipindahkan.

---

### ADR-006 — Strategi PWA

**Konteks.** Di pasar Indonesia, memaksa pemasangan aplikasi 60 MB adalah gesekan akuisisi yang nyata, terutama pada perangkat kelas bawah dengan penyimpanan sempit. Di sisi lain, Pesona adalah sistem finansial — permukaan tambahan berarti permukaan sengketa tambahan jika tidak dipagari.

**Keputusan.**

| Persona | PWA | Alasan |
|---|---|---|
| Konsumen | **Ya** | Order pertama dapat terjadi di browser tanpa instalasi; ajakan pasang muncul setelah order pertama selesai |
| Merchant | **Ya** | Kerap dipakai di tablet atau desktop dekat kasir; menambah push dan mode offline baca-saja |
| Driver | **Tidak** | Batas platform, bukan preferensi — lihat di bawah |

**Mengapa driver wajib native.**

| Kebutuhan | Status di web |
|---|---|
| Geolocation saat layar terkunci | Ditangguhkan browser begitu tab tidak aktif. Tidak ada solusi |
| Foreground service Android | Tidak dapat diakses dari web |
| Push prioritas tinggi yang membangunkan perangkat | Android memadai; iOS baru sejak 16.4, hanya bila sudah ditambahkan ke Home Screen, dan tidak cukup andal untuk hal yang time-critical |
| Pengecualian doze / optimasi baterai | Tidak tersedia bagi browser |

**Penempatan.** PWA konsumen **bukan folder baru**. `web-public` (Next.js) menjadi satu aplikasi dengan dua kelompok rute: rute publik untuk SEO dan rute terautentikasi untuk pemesanan. `web-merchant` cukup ditambahi manifest dan service worker. Jumlah folder tetap tujuh.

**Modal yang sudah ada di garuda.** `vite-plugin-pwa@1.2.0`, `workbox-build@7.4.0`, `display: "standalone"`, dan skrip `pwa:icons` — semuanya dapat diport langsung.

#### Pagar pencegah sengketa

Ini syarat yang mengikat. PWA hanya boleh dirilis bila ketujuh pagar berikut sudah terpasang.

| # | Aturan | Alasan |
|---|---|---|
| 1 | **Mode offline bersifat baca-saja.** Tidak ada aksi finansial yang boleh diantrekan saat offline lalu dikirim belakangan | Antrean offline adalah sumber sengketa nomor satu: pengguna menekan bayar saat sinyal hilang, permintaan terkirim ulang saat kembali online, saldo terpotong dua kali |
| 2 | **Setiap permintaan yang mengubah state membawa `Idempotency-Key`** | Modul `idem-potensi.ts` di garuda sudah menyediakan pondasinya. Tanpa ini, retry service worker menjadi transaksi ganda |
| 3 | **Service worker tidak pernah menyimpan cache respons finansial.** `/api/wallet/*`, `/api/orders/*`, `/api/payments/*` memakai strategi NetworkOnly | Saldo atau status order basi yang tampil di layar akan dibaca pengguna sebagai fakta, lalu jadi dasar komplain |
| 4 | **Jenis shell dicatat pada setiap transaksi** (`browser`, `pwa`, `native-webview`) beserta ID perangkat dan versi klien | Saat sengketa masuk, CS harus dapat merekonstruksi persis dari permukaan mana aksi itu berasal |
| 5 | **Push bukan jaminan pengiriman.** Kotak masuk dalam aplikasi adalah sumber kebenaran; push hanya petunjuk | Mencegah klaim "saya tidak pernah diberi tahu" — pemberitahuan selalu dapat ditarik ulang dari server |
| 6 | **Versi klien basi ditolak server.** Respons `409` dengan `min-client-version` memaksa muat ulang | Service worker `autoUpdate` dapat meninggalkan pengguna pada bundel lama yang memakai kontrak API berbeda |
| 7 | **Waktu selalu dari server (WIB).** Cap waktu klien tidak pernah dipercaya untuk peristiwa finansial | `server/work-timezone.ts` sudah menjadi acuan; jam perangkat pengguna dapat salah atau dimanipulasi |

**Konsekuensi.** PWA menurunkan gesekan akuisisi tanpa menambah folder. Biayanya adalah tujuh pagar di atas yang harus terpasang sebelum rilis, dan pengujian regresi yang harus mencakup tiga shell sekaligus.

---

### ADR-007 — Pola navigasi

**Konteks.** Navigasi laci (drawer/hamburger) menyembunyikan menu, menurunkan penemuan fitur, dan menuntut jempol menjangkau pojok kiri atas — sulit pada layar 6,7 inci. Pada aplikasi bermuatan finansial, navigasi yang membingungkan juga berarti aksi yang tidak disengaja.

**Keputusan.** Tanpa sidebar pada seluruh permukaan konsumen dan mitra. Bottom tab bar, maksimal lima item.

| Permukaan | Tab |
|---|---|
| App Konsumen & PWA konsumen | Beranda · Pesanan · Chat · Dompet · Akun |
| App Driver | Beranda · Pesanan · Pendapatan · Akun — layar utama didominasi tombol online/offline; kartu order mengambil alih seluruh layar saat masuk |
| App & PWA Merchant | Pesanan · Produk · Laporan · Akun |
| PWA di viewport lebar | Top nav, **bukan** sidebar |
| `web-admin`, `web-ops` | **Sidebar dipertahankan** |

Pengecualian back-office disengaja: ada 156 halaman yang harus diport dari `client/src/pages`, dan memaksa itu ke bottom tab justru menyulitkan operator. Aturannya — sidebar buruk di mobile, wajar di desktop.

#### Pagar pencegah sengketa

| # | Aturan | Alasan |
|---|---|---|
| 1 | **Label dan urutan tab identik** antara app native dan PWA | Naskah CS dan penyelesaian sengketa bergantung pada "tekan tab Pesanan" yang berarti sama di semua permukaan |
| 2 | **Aksi finansial tidak boleh dapat dicapai secara tidak sengaja.** Tidak ada geser-untuk-bayar, tidak ada aksi destruktif di tepi layar | Sengketa yang paling sulit dibantah adalah "saya tidak merasa menekan apa pun" |
| 3 | **Layar konfirmasi menampilkan nominal, penerima, dan biaya secara eksplisit** sebelum dana bergerak | Menjadi bukti yang dapat direkonstruksi saat sengketa |
| 4 | **Driver menerima order lewat ketukan yang disengaja**, bukan geseran | Mencegah penerimaan tidak sengaja saat perangkat di saku atau dudukan motor |
| 5 | **Status order ditampilkan dari satu sumber**, tidak pernah dari cache lokal | Dua permukaan menampilkan status berbeda adalah pemicu komplain langsung |

**Konsekuensi.** `packages/ui-web` dan `packages/ui-mobile` harus mengekspor komponen navigasi dan komponen konfirmasi transaksi yang sama, agar kelima pagar di atas ditegakkan oleh design system dan bukan oleh kedisiplinan tiap pengembang.

---

## 3. Arsitektur target

```
                    ┌─────────────────────────────────────────┐
   Konsumen  ──────▶│                                         │
   Driver    ──────▶│         Ingress / API Gateway           │
   Merchant  ──────▶│      (TLS, rate limit, WAF, authn)      │
   Admin/Ops ──────▶│                                         │
                    └────────────────────┬────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────┐
                    │             core-api  (Express)         │
                    │  9 modul domain · 1 DB · transaksi ACID │
                    │  identity · partner · geo · order       │
                    │  pricing · payment · payout · catalog   │
                    │  trust-safety                           │
                    └───┬──────────────┬──────────────┬───────┘
                        │              │              │
              ┌─────────▼───┐  ┌───────▼──────┐  ┌────▼─────────┐
              │  dispatch   │  │   location   │  │ notification │
              │  (matching) │  │ (GPS/presence│  │  (push/WS)   │
              └─────────┬───┘  └───────┬──────┘  └────┬─────────┘
                        │              │              │
        ┌───────────────▼──────────────▼──────────────▼─────────┐
        │  PostgreSQL (primary + read replica)   ·   Redis       │
        │  TimescaleDB (riwayat lokasi)          ·   S3/R2       │
        └────────────────────────────────────────────────────────┘
```

---

## 4. Struktur folder monorepo

```
pesona/
├─ pnpm-workspace.yaml
├─ turbo.json
├─ package.json
│
├─ apps/                              7 folder → 6 deliverable
│  ├─ web-public/                     Next.js 15 · publik, registrasi, lacak pesanan
│  ├─ web-admin/                      Vite+React · keanggotaan, konfigurasi bisnis
│  ├─ web-ops/                        Vite+React · live ops, CS, payout mitra
│  ├─ web-merchant/                   Vite+React · katalog, laporan
│  ├─ mobile-consumer/                Expo · anggota/konsumen
│  ├─ mobile-driver/                  Expo dev-client · background location
│  └─ mobile-merchant/                Expo · terima order
│
├─ services/                          4 artefak deployable
│  ├─ core-api/
│  │  ├─ src/
│  │  │  ├─ modules/
│  │  │  │  ├─ identity/              routes/ service/ repo/ schema/ index.ts
│  │  │  │  ├─ partner/
│  │  │  │  ├─ geo/
│  │  │  │  ├─ order/
│  │  │  │  ├─ pricing/
│  │  │  │  ├─ payment/
│  │  │  │  ├─ payout/
│  │  │  │  ├─ catalog/
│  │  │  │  └─ trust-safety/
│  │  │  ├─ platform/                 db, redis, config, logger, middleware
│  │  │  └─ index.ts                  aggregator
│  │  └─ Dockerfile
│  ├─ dispatch/                       modul 5 — matching engine
│  ├─ location/                       modul 4 — presence + ingest GPS
│  └─ notification/                   modul 9 — push & realtime
│
├─ packages/
│  ├─ contracts/                      zod + OpenAPI — sumber kebenaran tipe
│  ├─ sdk-client/                     client ter-generate dari contracts
│  ├─ ui-web/                         design system Pesona (web)
│  ├─ ui-mobile/                      design system Pesona (React Native)
│  └─ config/                         eslint, tsconfig, tailwind preset
│
├─ infra/
│  ├─ docker/
│  ├─ k8s/                            Helm chart per layanan, HPA, Ingress
│  └─ terraform/
│
└─ docs/
   ├─ adr/
   └─ runbook/
```

**Struktur wajib tiap modul domain.** Setiap folder di `src/modules/` mengekspor satu `index.ts` sebagai kontrak publiknya. Modul lain **hanya boleh** mengimpor dari `index.ts` tersebut — tidak boleh menyentuh `repo/` atau `schema/` milik modul lain. Aturan ini ditegakkan di CI.

---

## 5. Peta aplikasi

| # | Deliverable | Folder | Stack | Host |
|---|---|---|---|---|
| 1 | Web publik **+ PWA Konsumen** | `web-public` | Next.js 15 App Router + PWA | `www.pesona.id` |
| 2 | App Konsumen | `mobile-consumer` | Expo + expo-router | Play Store / App Store |
| 3 | App Driver | `mobile-driver` | Expo dev-client | Play Store / App Store |
| 4 | Merchant | `mobile-merchant` + `web-merchant` **(PWA)** | Expo · Vite+React | Store · `merchant.pesona.id` |
| 5 | Admin & back-office | `web-admin` | Vite+React+Tailwind+shadcn/ui | `admin.pesona.id` |
| 6 | Live Ops + CS + Payout | `web-ops` | Vite+React | `ops.pesona.id` |

**Catatan keputusan:**
- Tiga binary mobile terpisah, bukan satu. Driver membutuhkan background location dan foreground service; konsumen dan merchant tidak. Satu binary untuk ketiganya memaksa semua pengguna menanggung izin lokasi latar belakang.
- Web publik memakai Next.js karena butuh SSR/SEO dan halaman lacak pesanan tanpa login. Tiga web lainnya di belakang autentikasi, jadi Vite SPA sudah cukup dan identik dengan `client/` di garuda sehingga dapat diport langsung.
- `web-admin` dan `web-ops` dipisah folder agar dapat di-deploy dan dibatasi akses sendiri-sendiri, meski di awal boleh dilayani satu tim.
- **PWA tidak menambah folder** (ADR-006). `web-public` menampung rute publik dan rute pemesanan terautentikasi dalam satu aplikasi Next.js; `web-merchant` cukup ditambahi manifest dan service worker. Tidak ada PWA untuk driver.
- **Deteksi shell** (`browser` · `pwa` · `native-webview`) disediakan sebagai satu utilitas bersama di `packages/ui-web`, dan hasilnya dikirim pada setiap permintaan yang mengubah state sebagai bahan rekonstruksi sengketa. Percabangan fitur dilakukan pada kemampuan shell, bukan pada nama sistem operasi.

---

## 6. Peta 12 modul domain

| # | Modul | Penempatan | Status di garuda | Fase |
|---|---|---|---|---|
| 1 | Identity & Membership | `core-api` | Matang | 1 |
| 2 | Partner Lifecycle | `core-api` | **Belum ada** | 1 |
| 3 | Geo & Maps | `core-api` | Menempel di `ride-hailing.ts` | 1 |
| 4 | Supply State | `location` | Parsial | 1 |
| 5 | Dispatch & Matching | `dispatch` | **Belum ada** | 1 |
| 6 | Order Lifecycle | `core-api` | Tersebar | 1 |
| 7 | Pricing & Promo | `core-api` | Ada | 1 |
| 8 | Payments & Wallet | `core-api` | Matang | 1 |
| 9 | Notification & Realtime | `notification` | Campur di `wallet.ts` | 1 |
| 10 | Payout Mitra | `core-api` | Parsial | 1–2 |
| 11 | Catalog & Merchant Ops | `core-api` | Ada | 2 |
| 12 | Trust & Safety | `core-api` | **Belum ada** | 2 |
| 13 | **Escrow & Settlement** | `core-api` | **Belum ada** | **1** |
| 14 | Communication (chat & voice) | `core-api` | Belum ada | 2 |

> **Modul 13 ditambahkan 3 Agustus 2026.** Rinciannya — struktur tiga rekening, bagan jurnal JRN-P01–P09, invariant rekonsiliasi, jalur refund, dan disiplin batch EOD — ada di dokumen terpisah: [`ARSITEKTUR-KEUANGAN-PESONA.md`](ARSITEKTUR-KEUANGAN-PESONA.md).
>
> Dokumen itu juga memuat perubahan penting pada §6 di bawah: **model peran berubah dari berjenjang (seperti Garuda) menjadi sejajar.** Konsumen dapat memakai layanan tanpa menjadi anggota; driver dan merchant wajib anggota sebelum pencairan pertama. Modul 1 (Identity) dan modul 2 (Partner Lifecycle) terpengaruh secara struktural.

Empat modul belum ada sama sekali atau baru sebagian: **2, 5, 12, dan sebagian 10**. Salah satunya — Dispatch — adalah jantung yang membedakan ride-hailing dari sekadar pencatatan perjalanan.

---

## 7. Peta migrasi dari garuda-superapp

### 7.1 Modul yang tinggal dipindahkan

| Modul Pesona | Asal di garuda-superapp |
|---|---|
| **identity** | `routes/auth.ts`, `mobile-auth.ts`, `security.ts`, `role-management.ts`, `user-management.ts`, `resignation.ts`; `server/mobile-auth-tokens.ts`, `pin-verification.ts`, `active-users-tracker.ts` |
| **geo** | Blok `/api/maps/*` di `routes/ride-hailing.ts`; `server/rajaongkir-service.ts`; `locations.csv` |
| **order** | `routes/marketplace-orders.ts`, blok `/api/rides` di `ride-hailing.ts`, `idem-potensi.ts`; `server/order-stock.ts`, `shipping-service.ts`, `shipping-webhook-service.ts` |
| **pricing** | `server/fees.ts`, `ride-pricing.ts`, `shipping-settings.ts` |
| **payment** | `routes/wallet.ts`, `xendit-pg.ts`, `duitku-pg.ts`, `ppob.ts`, `setor-manual.ts`, `exchanger.ts`; `server/pg-service.ts`, `tripay-*.ts`, `bayarind-onepay-*.ts`, `duitku-pg-service.ts`, `wallet-journal-service.ts`, `wallet-transaction-standards.ts`, `wallet-journal-policy.ts`, `wallet-lock-audit.ts` |
| **payout** | `server/marketplace-settlement-service.ts`, `eod-standing-order.ts`, `bom-service.ts`; sebagian `routes/nominatif.ts` |
| **catalog** | `routes/marketplace-catalog.ts`, `marketplace-operations.ts` |
| **location** | `/api/rides/drivers/nearby` dan `/api/rides/driver/presence` di `ride-hailing.ts`; sebagian `server/websocket.ts` |
| **notification** | Blok notifikasi/inbox/broadcast di `routes/wallet.ts`; `server/websocket.ts` |

### 7.2 Modul yang harus dibangun baru

| Modul | Cakupan |
|---|---|
| **partner** | Onboarding dan verifikasi driver/merchant, dokumen kendaraan, SIM/STNK, status aktif–suspend. Sebagian pola dapat diambil dari `routes/community-partner.ts`, `mobile-trader.ts`, `content-creator.ts` |
| **dispatch** | Broadcast order, accept/reject oleh driver, timeout, reassign, antrean per zona. **Tidak ada padanannya di garuda** — saat ini `PATCH /api/rides/:id` mengubah status secara manual |
| **trust-safety** | Rating, komplain, blacklist, deteksi GPS spoof, order fiktif. Pondasi awal dari `routes/support.ts`, `observability.ts`, `server/rate-limit-middleware.ts`, `sla-service.ts` |

### 7.3 Di luar lingkup Fase 1

Domain koperasi dan akuntansi **tidak dibuang** — ini aset yang membedakan Pesona dari ride-hailing biasa, dan akan dibutuhkan begitu operasi inti jalan. Untuk sementara tetap di garuda dan dipindahkan pada Fase 3:

`routes/`: `eod.ts`, `eom-eoy.ts`, `savings.ts`, `koperasi.ts`, `investor.ts`, `nominatif.ts`, `personalia.ts`, `sirapan.ts`, `accounting-fixed-assets.ts`, `meeting.ts`, `content.ts`, `community.ts`, `digicoop-connect*.ts`, `sk-verify.ts`, `backup-system.ts`, `system-config.ts`, `internal-staff.ts`, `coordinator.ts`, `google-calendar-admin.ts`, `chat-quick-access.ts`

`server/`: seluruh `eod-*.ts`, `eom-*.ts`, `accounting*.ts`, `reconciliation-service.ts`, `reports-service.ts`, `certificate-render.ts`, `sk-document-render.ts`

**Klaster GL-journal** yang sengaja dipertahankan di `routes.ts` garuda (standing-order, BOM batch-pay, JRN-014/015, `pay-standing-order`) dipindahkan **utuh sebagai satu unit** ke modul `payout`, tanpa dipecah. Memecahnya adalah pekerjaan tersendiri dengan reviu sendiri.

### 7.4 Frontend

`client/src/pages` berisi **156 halaman** yang harus dipilah ke empat aplikasi web. Ini pekerjaan mekanis tetapi memakan waktu, dan harus dilakukan setelah `packages/ui-web` berdiri agar tidak menyalin komponen dua kali.

`mobile/app` saat ini satu binary Expo dengan grup `(auth)`, `(kyc)`, `(member)`, `(mitra)/{driver,merchant,trader}`. Pemecahan menjadi tiga binary dilakukan **setelah** backend punya batas modul — memecah app lebih dulu hanya menggandakan integrasi ke kode yang sama kusutnya.

---

## 8. Data layer dan rencana skala

### 8.1 Penyimpanan

| Komponen | Teknologi | Peran |
|---|---|---|
| Database utama | PostgreSQL (managed, + read replica) | Sumber kebenaran; ACID untuk GL, dompet, order |
| Cache & geo | Redis | Presence driver, indeks `GEOSEARCH`, rate limit, sesi |
| Riwayat lokasi | TimescaleDB | Jejak GPS untuk audit dan sengketa |
| Objek | S3 / Cloudflare R2 | Dokumen KYC, foto, bukti |
| Antrean | BullMQ (Redis) | Notifikasi, payout, pekerjaan latar |

### 8.2 Jalur menuju 10 juta pengguna

10 juta pengguna terdaftar **bukan** 10 juta concurrent. Asumsi kerja: 1–3% concurrent di puncak = 100–300 ribu koneksi aktif.

| Lapisan | Strategi |
|---|---|
| Aplikasi | Horizontal scale + HPA. `core-api` 20–50 pod; `dispatch`, `location`, `notification` di-scale menurut pemicunya masing-masing |
| Koneksi DB | PgBouncer wajib — tanpa ini pod bertambah justru mematikan Postgres |
| Baca | Read replica untuk laporan, dashboard, dan riwayat |
| Tulis | Partisi tabel besar (`rides`, `transactions`, `wallet_ledger`) per bulan |
| Beban tulis panas | Ping GPS **tidak masuk Postgres**. Redis untuk posisi terkini, TimescaleDB untuk riwayat |
| Realtime | WebSocket dipisah ke `notification` dengan sticky session di Ingress |

**Yang perlu dijaga:** urutan pemecahan masalah skala adalah indeks → query → cache → replica → partisi → shard. Melompat ke sharding sebelum PgBouncer dan indeks beres adalah kesalahan yang mahal dan sulit dibatalkan.

---

## 9. Keamanan dan kepatuhan

### 9.1 Rahasia dan konfigurasi

- Tidak ada file `.env` di produksi. External Secrets Operator + KMS/Vault.
- Seluruh kredensial yang dibawa dari garuda **dirotasi** untuk lingkungan Pesona.
- `.gitignore` diverifikasi sebelum commit pertama. (Pada garuda, `.env` sudah benar di-ignore dan tidak ter-track — pertahankan disiplin ini.)

### 9.2 Perlindungan data pribadi

UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi sudah berlaku penuh; masa transisinya berakhir 17 Oktober 2024. Badan PDP sebagai lembaga pengawas independen sampai pertengahan 2026 belum terbentuk, dan pengawasan masih berada di Kemkomdigi — tetapi kewajiban pengendali data sudah berjalan terlepas dari itu.

Implikasi yang harus masuk desain sejak awal, bukan ditambal belakangan:

| Kewajiban | Implementasi |
|---|---|
| Data residency | Seluruh data pribadi dan backup berada di wilayah Indonesia |
| Enkripsi at-rest | KTP, selfie KYC, dokumen mitra — enkripsi kolom, kunci di KMS |
| Pemisahan PII | Tabel PII terpisah dari tabel transaksi, diakses lewat modul `identity` saja |
| Retensi | Kebijakan retensi eksplisit per kategori data, dengan job penghapusan |
| Jejak audit | Catat siapa membaca data anggota. Disiplin audit yang sudah ada di sisi GL diperluas ke PII |
| Hak subjek data | Endpoint ekspor dan penghapusan data atas permintaan anggota |

### 9.3 Keamanan aplikasi

- Rate limit dan WAF di Ingress, bukan di aplikasi.
- Layanan internal (`dispatch`, `location`, `notification`) memakai ClusterIP — tidak pernah diekspos ke internet.
- `admin.pesona.id` dan `ops.pesona.id` di belakang IP allowlist dan MFA wajib.
- Pemindaian dependensi dan SBOM di CI.
- Untuk kartu, seluruh data kartu tetap di sisi payment gateway; Pesona tidak pernah menyimpannya sehingga cakupan PCI-DSS tetap minimal.

---

## 10. Roadmap

| Fase | Isi | Keluaran |
|---|---|---|
| **0 — Fondasi** | Scaffold monorepo, `packages/contracts` dan `config`, aturan batas modul di CI, Dockerfile, pipeline | Repo Pesona berdiri, CI hijau |
| **1 — Inti operasi** | Modul 1, 3, 6, 7, 8 diport; modul 4, 9 diekstrak; modul 2 dan 5 dibangun baru | Order dapat dibuat, di-dispatch, diselesaikan, dan dibayar |
| **2 — Mitra & aplikasi** | Modul 10, 11, 12; pemecahan tiga binary mobile; `web-ops` | Mitra dapat onboarding mandiri dan menerima pencairan |
| **3 — Koperasi** | Migrasi domain akuntansi, simpanan, keanggotaan koperasi dari garuda | Pesona menggantikan garuda sepenuhnya |
| **4 — Skala** | K8s produktif, read replica, partisi tabel, remote cache CI | Siap untuk beban puncak |

Urutan yang ditegaskan: **cabut modul 3, 4, 6, 9 menjadi modul berdiri sendiri → bangun modul 5 (Dispatch) → baru pecah binary mobile.**

---

## 11. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Batas modul tidak ditegakkan | Dalam 18 bulan kembali jadi monolit kusut | `eslint-plugin-boundaries` di CI sejak Fase 0, bukan nanti |
| Repo lahir gemuk karena salin penuh | Riwayat git tidak dapat diperbaiki | Penyalinan selektif; `.zip`, `backups/`, `.backup_sys/`, `node_modules` dikecualikan |
| Waktu CI meledak | Rilis melambat, disiplin tes runtuh | Turborepo remote cache + build affected-only sejak Fase 0 |
| Dispatch diremehkan | Produk tidak berfungsi sebagai ride-hailing | Diperlakukan sebagai proyek tersendiri dengan reviu sendiri, bukan satu tiket |
| Klaster GL-journal pecah saat migrasi | Kesalahan pembukuan, sulit dilacak | Dipindahkan utuh sebagai satu unit; reviu terpisah; uji regresi jurnal wajib hijau |
| Kredensial garuda terbawa | Insiden keamanan | Rotasi seluruh kredensial sebelum lingkungan Pesona menyala |
| Trust & Safety ditunda terlalu lama | Kebocoran finansial di bulan-bulan awal | Deteksi dasar (GPS spoof, order fiktif) masuk Fase 2, tidak lebih lambat |
| **Aksi finansial diantrekan saat PWA offline** | Transaksi ganda, saldo terpotong dua kali, sengketa yang sulit dibantah | Offline baca-saja + `Idempotency-Key` wajib + NetworkOnly untuk rute finansial (ADR-006 pagar 1–3) |
| **Pengguna mengaku tidak menerima notifikasi** | Sengketa pembatalan dan keterlambatan | Push diperlakukan sebagai petunjuk, bukan jaminan; kotak masuk dalam aplikasi menjadi sumber kebenaran (ADR-006 pagar 5) |
| **Klien basi karena service worker** | Klien memakai kontrak API lama, hasil tidak konsisten antar permukaan | Server menolak dengan `409` + `min-client-version` (ADR-006 pagar 6) |
| **Perilaku berbeda antara PWA dan app native** | Naskah CS tidak berlaku, penyelesaian sengketa melambat | Label dan urutan navigasi identik; komponen konfirmasi transaksi berasal dari design system yang sama (ADR-007) |

---

## 12. Yang belum diputuskan

1. **Bahasa `dispatch`.** Node/TS untuk konsistensi tim, atau Go untuk konkurensi. Rekomendasi: mulai dengan Node/TS dan jaga batas modulnya cukup bersih agar dapat ditulis ulang tanpa menyentuh pemanggilnya.
2. **Penyedia infrastruktur.** Hostinger VPS saat ini memadai untuk Fase 0–1, tetapi tidak untuk 10 juta pengguna. Keputusan cloud perlu diambil sebelum Fase 4.
3. **Event backbone.** Kafka atau NATS untuk komunikasi antar layanan. Belum dibutuhkan sampai Fase 2; HTTP internal cukup untuk sekarang.
4. **Nasib garuda-superapp.** Dibekukan setelah Fase 3, atau tetap jalan sebagai sistem koperasi terpisah.

---

## Lampiran — inventaris garuda-superapp

Diambil dari pembacaan repositori pada 2 Agustus 2026.

| Aspek | Angka |
|---|---|
| Modul route | 44 file di `server/routes/`, ~51.000 baris |
| Aggregator | `server/routes.ts`, 224 KB |
| Lapisan data | `storage.ts` 92 KB + `database-storage.ts` 150 KB; `IStorage` dengan 216 metode |
| Skema | `shared/schema.ts`, 5.983 baris, 135 tabel |
| Layanan tingkat atas | 60 file `server/*.ts` |
| Halaman frontend | 156 file di `client/src/pages` |
| Mobile | Satu binary Expo, grup `(auth)`, `(kyc)`, `(member)`, `(mitra)` |
| Endpoint ride-hailing | 11 rute, 23 handler — tanpa accept/reject driver |
| Deployment saat ini | Satu proses PM2, `dist/server.mjs`, port 5000 |
