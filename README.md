# Pesona SuperApp

Monorepo superapp multi-vertikal berbasis koperasi. Diregresi dari `garuda-superapp`.

Arsitektur lengkap dan seluruh ADR: [`docs/adr/ARSITEKTUR-PESONA-SUPERAPP.md`](docs/adr/ARSITEKTUR-PESONA-SUPERAPP.md)

---

## Prasyarat

| Alat | Versi |
|---|---|
| Node.js | 22 LTS (`.nvmrc`) — minimum 20 |
| pnpm | 9 (via Corepack: `corepack enable`) |
| Docker | untuk Postgres + Redis lokal |

```bash
corepack enable
pnpm install:backend      # services/* + packages/* — mulai dari sini
cp .env.example .env      # lalu isi
pnpm infra:up             # Postgres + Redis lokal
```

### Instalasi bertahap

Instalasi sekaligus untuk 17 proyek mengunduh sekitar 1,5–2 GB pada mesin yang store pnpm-nya masih kosong. Pada koneksi yang tidak stabil itu rawan `ECONNRESET`. Pasang bertahap sesuai kebutuhan kerja:

```bash
pnpm install:backend    # services/* + packages/*  — cukup untuk Fase 0
pnpm install:web        # apps/web-*
pnpm install:mobile     # apps/mobile-*  — paling berat (React Native ~24 MB)
pnpm install:all        # semuanya sekaligus
```

Setiap tahap menambah ke store yang sama, jadi tidak ada pekerjaan terbuang. Mengulang tahap yang gagal akan memakai kembali paket yang sudah terunduh (`reused`, bukan `downloaded`).

### Kalau instalasi macet

`.npmrc` sudah menurunkan `network-concurrency` ke 4 dan menaikkan batas waktu. Jika masih bermasalah:

```bash
pnpm store status                 # cek kesehatan store
pnpm install --prefer-offline     # pakai yang sudah ada di store dulu
pnpm install --network-concurrency=1   # paling lambat, paling tahan
```

Pada Windows, tambahkan folder proyek dan store pnpm (`pnpm store path`) ke pengecualian Microsoft Defender — pemindaian real-time pada ribuan berkas kecil dapat membuat instalasi tampak menggantung.

---

## Menjalankan — semua dari root

**Tidak perlu `cd` ke subfolder.** Semua paket dijalankan dari root dengan filter.

```bash
pnpm dev:core      # core-api + dispatch + location + notification
pnpm dev:admin     # web-admin + core-api
pnpm dev:ride      # core-api + dispatch + location + mobile-driver

pnpm --filter @pesona/core-api dev        # satu paket
pnpm --filter "./services/*" dev          # seluruh backend
pnpm --filter @pesona/mobile-driver start # Expo

pnpm --filter @pesona/core-api test
pnpm --filter @pesona/core-api add drizzle-orm   # tambah dependensi ke satu paket

pnpm build:affected                       # hanya yang berubah sejak origin/main
```

Menjalankan seluruh 16 paket sekaligus tidak realistis di satu mesin — pakai profil `dev:*` di atas.

---

## Struktur

```
apps/          7 folder → 6 deliverable (3 mobile, 4 web)
services/      4 artefak deployable
packages/      5 paket bersama
infra/         docker · k8s · terraform
docs/adr/      keputusan arsitektur
```

| Paket | Peran | Port dev |
|---|---|---|
| `@pesona/web-public` | Web publik + PWA Konsumen (Next.js) | 3000 |
| `@pesona/web-admin` | Back-office | 3001 |
| `@pesona/web-ops` | Live Ops, CS, payout | 3002 |
| `@pesona/web-merchant` | Dashboard merchant (PWA) | 3003 |
| `@pesona/mobile-consumer` | App Konsumen | Expo |
| `@pesona/mobile-driver` | App Driver — **wajib native** | Expo |
| `@pesona/mobile-merchant` | App Merchant | Expo |
| `@pesona/core-api` | 9 modul domain, satu DB, ACID | 5000 |
| `@pesona/dispatch` | Matching engine | 5001 |
| `@pesona/location` | Presence & ingest GPS | 5002 |
| `@pesona/notification` | Push & realtime | 5003 |
| `@pesona/contracts` | Skema zod → OpenAPI | — |
| `@pesona/sdk-client` | Client API ter-generate | — |
| `@pesona/ui-web` · `@pesona/ui-mobile` | Design system | — |
| `@pesona/config` | eslint, tsconfig, aturan batas modul | — |

---

## Bundler dan test runner

Berbeda per runtime — ini disengaja, bukan inkonsistensi. Tiap ekosistem dipakai dengan alat bakunya.

| Target | Bundler | Test runner |
|---|---|---|
| `web-public` | Next.js (Turbopack/webpack) | Vitest |
| `web-admin` · `web-ops` · `web-merchant` | **Vite** | Vitest |
| `mobile-*` (3 app) | **Metro** — Vite tidak dipakai di mobile | **Jest** (`jest-expo`) + React Native Testing Library |
| `services/*` | tsc / esbuild | Vitest |

Memaksa Vitest ke React Native tidak berhasil: Metro punya resolusi modul sendiri dan sumber RN masih ber-anotasi Flow. `jest-expo` adalah jalur yang didukung resmi.

```bash
pnpm --filter @pesona/mobile-driver test
pnpm --filter @pesona/core-api test
pnpm test                                   # semua, lewat turbo
```

E2E mobile belum disiapkan. Untuk app driver — yang mengandalkan lokasi latar belakang — E2E di perangkat nyata (Maestro atau Detox) akan dibutuhkan sebelum rilis, karena unit test tidak dapat membuktikan perilaku saat layar terkunci.

### Catatan: pnpm + React Native

pnpm memakai symlink secara agresif dan Metro secara historis kurang ramah terhadapnya. `apps/mobile-*/metro.config.js` sudah mengaktifkan `unstable_enableSymlinks` dan menunjuk `watchFolders` ke root workspace. Jika tetap muncul galat resolusi modul saat build mobile, aktifkan `node-linker=hoisted` di `.npmrc` — barisnya sudah disiapkan sebagai komentar.

Ketiga paket mobile sengaja **tidak** memakai `"type": "module"`, karena `metro.config.js` dan `babel.config.js` harus CommonJS.

---

## Aturan yang tidak boleh dilanggar

1. **Batas modul.** Modul di `core-api/src/modules/` hanya boleh saling mengimpor lewat `index.ts`. Menyentuh `repo/` atau `schema/` modul lain ditolak CI.
2. **Tidak ada `.env` di produksi.** Rahasia dipasok External Secrets Operator + KMS.
3. **Tidak ada artefak biner di git.** `*.zip`, `backups/`, `repo/` sudah di-ignore — ini pelajaran langsung dari garuda.
4. **PWA offline bersifat baca-saja.** Tidak ada aksi finansial yang diantrekan offline (ADR-006 pagar 1).
5. **Driver tidak boleh PWA.** Background location dan foreground service tidak tersedia di web.
6. **Bundle ID mobile belum final.** Lihat `apps/mobile-*/BUNDLE-ID.md` — wajib diganti sebelum rilis store pertama.

---

## Status

**Fase 1 — alur inti ride-hailing berjalan end-to-end dan teruji.** Detail
lengkap: `CLAUDE.md` (konteks kerja) dan riwayat commit di `main`.

| Modul / komponen | Status |
|---|---|
| Struktur monorepo, `packages/config`, `packages/contracts`, CI, Dockerfile | Selesai (Fase 0) |
| **5 — Dispatch & Matching** | Selesai: gelombang tawaran, terima/tolak/hangus, scheduler `sweepExpired` (interval + graceful shutdown) |
| **4 — Supply State** (`location`) | Selesai: validasi GPS, presence, indeks kandidat |
| **6 — Order Lifecycle** | Selesai: state machine, idempotensi webhook, tersambung ke dispatch (`DispatchPort`) dan notification (`NotificationPort`) lewat `OrderFlow` |
| **13 — Escrow & Settlement** | Selesai untuk JRN-P01–P04 (bayar, selesai, refund penuh, refund sebagian). `Ledger` interface async penuh, `InMemoryLedger` + `DrizzleLedger`, diverifikasi ke Postgres nyata |
| **9 — Notification & Realtime** | Selesai: inbox + registrasi perangkat, `PushPort`/`NoopPushAdapter` (belum ke FCM/APNS sungguhan), urutan kotak-masuk-dulu-baru-push ditegakkan struktural |
| Persistensi Postgres (Drizzle) | Selesai: skema `orders`/`journal_entries`/`journal_lines`, migration + integration test ke DB nyata |
| **1 — Identity & Membership** | Belum — kerangka kosong |
| **2 — Partner Lifecycle** | Belum — kerangka kosong. Prioritas berikut, `partnerId` di order saat ini tidak diverifikasi |
| **3 — Geo & Maps** | Belum — kerangka kosong |
| **7 — Pricing & Promo** | Belum — MDR (7‰) dan bagian mitra (850‰) masih hardcode di `OrderService` |
| **8 — Payments & Wallet** | Belum — belum ada integrasi akuisitor sungguhan (Xendit/Duitku); webhook pembayaran saat ini dipicu manual/tes |
| **10 — Payout Mitra** | Belum — klaster GL-journal garuda (standing-order, BOM batch-pay) belum dipindah |
| **11 — Catalog**, **12 — Trust & Safety**, **14 — Communication** | Belum (Fase 2) |
| Redis adapter (dispatch GEOSEARCH, location presence) | Belum — keduanya masih in-memory |

Urutan yang direkomendasikan untuk lanjutan Fase 1: **Identity → Partner
Lifecycle → Payment**, karena Partner dan Payment sama-sama butuh fondasi
autentikasi dari Identity lebih dulu.

### Perintah verifikasi

```bash
pnpm install
pnpm --filter @pesona/contracts test        # termasuk uji aritmetika JRN-P01/P02
pnpm --filter @pesona/core-api lint         # gerbang batas modul
pnpm --filter @pesona/contracts gen:openapi

# Test per layanan (semua lolos per commit terakhir)
pnpm --filter @pesona/core-api test
pnpm --filter @pesona/dispatch test
pnpm --filter @pesona/location test
pnpm --filter @pesona/notification test

# Migration DB (butuh DATABASE_URL di .env — lihat CLAUDE.md untuk peringatan keamanannya)
pnpm --filter @pesona/core-api db:generate
pnpm --filter @pesona/core-api db:migrate
```
