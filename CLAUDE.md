# CLAUDE.md

Konteks untuk Claude sebelum bekerja di repo ini. Baca ini duluan setiap
memulai sesi baru — jangan percaya status di README.md/ADR begitu saja
tanpa mengecek `git log --oneline -15` dan task list dulu, keduanya bisa
lebih baru daripada dokumen ini.

## Apa proyek ini

**Pesona SuperApp** — superapp ride-hailing/delivery/marketplace
berbasis koperasi untuk Indonesia, diregresi dari `garuda-superapp`
(sebuah platform koperasi retail-core-banking-style) oleh Ulpermadi
Ibrahim (arsitek/lead dev, ex-CTO retail/consumer banking). Beda dari
garuda: intinya ride-hailing sungguhan (dispatch, matching, presence
GPS realtime) dengan domain koperasi/akuntansi garuda dipertahankan
sebagai aset yang dipindah belakangan (Fase 3), bukan dibuang.

Arsitektur lengkap dan seluruh ADR ada di dua dokumen — **baca
keduanya sebelum menyentuh alur uang atau dispatch**:

- `docs/adr/ARSITEKTUR-PESONA-SUPERAPP.md` — 14 modul domain, peta
  migrasi dari garuda, strategi PWA vs native, rencana skala.
- `docs/adr/ARSITEKTUR-KEUANGAN-PESONA.md` — model peran sejajar
  (konsumen TIDAK wajib anggota; mitra WAJIB anggota), struktur tiga
  rekening, bagan jurnal JRN-P01–P09, invariant rekonsiliasi.

Ini **sistem finansial**. Saldo dompet, jurnal GL, dan alur pembayaran
berstatus tinggi — benar dan bisa diaudit lebih penting daripada cepat
atau elegan. Sama seperti garuda-superapp, tapi dari nol dengan
disiplin yang lebih ketat sejak awal.

## Arsitektur dalam satu paragraf

Modular monolith (`services/core-api`, ADR-001) berisi mayoritas modul
domain, plus tiga layanan yang sengaja diekstrak karena stateful/bursty:
`services/dispatch` (matching engine, indeks geo in-memory, target
latensi <100ms), `services/location` (presence driver + ingest GPS),
`services/notification` (push & realtime, IO-bound/bursty). Komunikasi
antar layanan lewat HTTP interna, tidak pernah lewat DB bersama —
setiap layanan punya penyimpanannya sendiri (dispatch/location saat ini
in-memory, core-api Postgres via Drizzle).

**Pola port/adapter yang dipakai konsisten di mana pun ada dependensi
lintas layanan:** interface (`DispatchPort`, `NotificationPort`,
`OrderPort`, `SupplyPort`) + implementasi HTTP sungguhan
(`Http*Client`, aktif kalau env var seperti `DISPATCH_URL`/
`NOTIFICATION_URL`/`CORE_API_URL`/`LOCATION_URL` disetel) + fallback
in-memory/statis (`Static*Client`/`Recording*Client`, aktif kalau env
var itu kosong) — supaya tiap layanan bisa jalan berdiri sendiri saat
dev/test tanpa perlu menyalakan seluruh sistem. Lihat
`services/*/src/index.ts` masing-masing, fungsi `resolveDeps()`/logika
setara di `createApp()`.

## Tech stack

- **Backend**: Node.js + Express + TypeScript (ESM, `"type": "module"`)
- **Frontend web**: React + Vite (kecuali `web-public` pakai Next.js) + TypeScript, Tailwind
- **Mobile**: React Native + Expo (Metro, bukan Vite — lihat README §Bundler)
- **DB**: PostgreSQL + Drizzle ORM (`drizzle-orm/node-postgres` + `pg`, koneksi TCP/SSL biasa — bukan driver HTTP serverless Neon, karena core-api proses long-lived bukan serverless function)
- **Cache/geo/antrean** (direncanakan, **belum disambung**): Redis — dispatch (GEOSEARCH), location (presence), BullMQ (job antrean notification)
- **Tests**: Vitest untuk `services/*` dan `packages/*`, Jest (`jest-expo`) untuk mobile
- **Monorepo**: pnpm workspaces + Turborepo
- **Path**: setiap paket adalah package pnpm sendiri (`@pesona/core-api`, `@pesona/dispatch`, dst.) — tidak ada path alias lintas paket seperti garuda, impor lewat nama paket lewat `workspace:*`

## Perintah harian

Semua dari **root**, pakai `--filter`, jangan `cd` ke subfolder (lihat README §Menjalankan untuk daftar profil `dev:*`):

```bash
pnpm install                              # atau bertahap: install:backend / install:web / install:mobile
pnpm --filter @pesona/core-api dev        # satu layanan
pnpm dev:core                             # core-api + dispatch + location + notification sekaligus

pnpm --filter @pesona/core-api test       # vitest run, per paket
pnpm test                                 # semua paket lewat turbo

npx eslint <files> --max-warnings=0       # dari dalam folder paket yang bersangkutan
```

**Tidak ada pre-commit hook (belum ada husky) di repo ini** — beda dari
garuda-superapp. ESLint dan test TIDAK otomatis jalan saat commit;
jalankan manual sebelum bilang sebuah perubahan selesai.

### Migration database (`core-api`)

```bash
pnpm --filter @pesona/core-api db:generate   # bikin migration dari schema/*.ts
pnpm --filter @pesona/core-api db:migrate    # jalankan ke DATABASE_URL di .env
pnpm --filter @pesona/core-api db:studio     # UI eksplorasi data
pnpm --filter @pesona/core-api db:reset-dev  # DESTRUKTIF — lihat peringatan di bawah
```

**Sebelum menjalankan atau menyarankan `db:reset-dev` atau `DROP
TABLE`/`DROP SCHEMA` apa pun: konfirmasi dulu ke Ulpermadi bahwa
`DATABASE_URL` menunjuk ke database dev pesona yang terpisah, BUKAN ke
database garuda-superapp yang sama.** Kedua proyek sama-sama punya
tabel `orders` — pernah kejadian migration gagal dengan `relation
"orders" already exists` dan itu bisa berarti `.env` salah tunjuk ke
DB produksi garuda. Jangan asumsikan aman, tanya eksplisit lewat
`AskUserQuestion` seperti apa risikonya sebelum menjalankan apa pun
yang destruktif — Ulpermadi akan menjawab jelas begitu ditanya, dan
kalau memang database dev yang bersih/terisolasi dia akan mengizinkan
langsung.

## Keterbatasan sandbox — WAJIB dibaca sebelum coba jalankan sesuatu

Proyek ini ada di folder Windows yang di-mount ke sandbox Linux Claude.
Dua kelas operasi **tidak bisa diandalkan dari sandbox**:

1. **`pnpm`/`vitest`/`tsc` di direktori proyek ini** — `node_modules`
   pnpm memakai symlink agresif, dan membaca symlink lewat mount
   Windows→Linux ini sering melempar `Input/output error`. Sudah
   dicoba: copy ke `/tmp` lalu install ulang lewat corepack/npm — juga
   gagal (fetch jaringan gagal, 403 dari registry, atau
   `EUNSUPPORTEDPROTOCOL` karena npm tidak paham `workspace:*`).
2. **`git add`/`git commit`/apa pun yang menulis `.git/index.lock`** —
   sandbox bisa MEMBUAT file di mount ini tapi tidak bisa MENGHAPUSNYA
   (`Operation not permitted` pada `unlink`, bahkan untuk file yang
   sandbox sendiri baru buat). Ini berarti `git commit` dari sandbox
   berisiko meninggalkan `index.lock` yang menyumbat operasi git
   berikutnya.

**Alur kerja yang sudah terbukti:** edit file lewat `Read`/`Write`/`Edit`
seperti biasa (ini selalu bisa), lakukan reviu statis yang teliti
sendiri, lalu **suruh Ulpermadi menjalankan perintah `pnpm`/`vitest`/
`git` di PowerShell miliknya** dan minta dia tempel output verbatim.
Baca output itu dengan teliti untuk verifikasi sukses/gagal dan
diagnosis galat — jangan berasumsi sukses tanpa bukti output.

Membaca file (`Read`, `Glob`, `Grep`, dan `bash` untuk perintah
baca-saja seperti `git status`/`git log`/`git diff`) berjalan normal
dari sandbox lewat mount `/sessions/.../mnt/APP/pesona-superapp/`.

## Keputusan desain yang jangan diulangi kesalahannya

- **`Ledger` (di `escrow-settlement`) adalah interface, seluruh
  method-nya `Promise<T>` — TIDAK ADA union `void | Promise<void>`.**
  Ini keputusan sengaja, bukan kecelakaan: union itu memungkinkan kode
  lolos type-check tapi diam-diam lupa `await` di implementasi
  Postgres sungguhan (`DrizzleLedger`), yang berarti kehilangan tulisan
  jurnal finansial tanpa galat apa pun. `@typescript-eslint/no-floating-promises`
  aktif justru untuk mencegah kelas bug ini — jangan longgarkan jadi
  union lagi demi "mengurangi perubahan".
- **Uang sebagai bigint** (`bigint({ mode: 'number' })` di kolom
  Drizzle), cocok dengan tipe `Money` ber-merek di `@pesona/contracts`
  (aman sampai 2^53-1). Jangan pakai `numeric`/`decimal` Postgres untuk
  kolom uang tanpa alasan kuat — driver `pg` mengembalikan `NUMERIC`
  sebagai string kecuali type parser kustom didaftarkan, dan itu
  gotcha yang mudah lolos review.
- **Jangan pakai SQL `SUM()` untuk agregasi uang** kalau tidak
  didaftarkan type parser-nya — `DrizzleLedger.balance()` sengaja
  mengambil baris mentah dan menjumlahkan di JavaScript, persis
  algoritma `InMemoryLedger`, supaya kedua implementasi `Ledger`
  menghasilkan angka yang identik.
- **Tabel jurnal append-only** (`journal_entries`/`journal_lines`) —
  tidak pernah UPDATE. Koreksi selalu lewat entri jurnal pembalik baru.
- **`verbatimModuleSyntax: true`** di tsconfig — impor/ekspor type-only
  (interface, type alias) WAJIB pakai kata kunci `type` eksplisit.
  `import { SomeInterface }` polos untuk simbol type-only adalah galat
  kompilasi.
- **`eslint-plugin-boundaries`** menegakkan: modul di
  `core-api/src/modules/*/**` hanya boleh impor dari `index.ts` modul
  lain, tidak pernah `repo/`/`schema/`/`service/`/`routes/` milik modul
  lain secara langsung. Impor relatif dalam modul yang sama tidak
  masalah. Berkas di `tests/` TIDAK kena aturan ini (hanya
  `src/**/*.ts` yang masuk `boundaries/include`).
- **dotenv gotcha**: `pnpm --filter <pkg> <script>` men-set `cwd` ke
  folder paket itu sendiri, bukan root monorepo, jadi auto-discovery
  `.env` gagal diam-diam. Solusi yang sudah dipasang di keempat
  `services/*/src/index.ts` (dan `drizzle.config.ts`): hitung path
  `.env` root dari lokasi berkas itu sendiri
  (`fileURLToPath(import.meta.url)` + `dirname`/`resolve`), BUKAN dari
  `process.cwd()`. Di produksi tidak ada `.env` sama sekali (ADR-005,
  rahasia lewat External Secrets Operator/KMS/Vault) — `dotenv.config()`
  diam-diam no-op kalau filenya tidak ada, itu memang perilaku yang
  diinginkan.
- **ADR-006 pagar 5 (notification): PUSH BUKAN JAMINAN PENGIRIMAN.**
  Kotak masuk dalam aplikasi adalah sumber kebenaran; entri kotak masuk
  HARUS ditulis sebelum percobaan push apa pun, tidak pernah dibalik.
  Ditegakkan struktural di `services/notification/src/routes.ts` —
  `toInboxEntry()` bahkan tidak melihat hasil pengiriman push sama
  sekali.
- **Konsumen TIDAK wajib jadi anggota koperasi**
  (`consumerId: string | null` di `OrderRecord`); mitra (driver/merchant)
  SELALU anggota begitu ditugaskan (`partnerId` null hanya sebelum
  ASSIGNED). Kode apa pun yang menotifikasi/memproses berdasarkan
  `consumerId` wajib menangani null secara eksplisit — bukan
  mengasumsikan setiap order punya konsumen yang bisa dihubungi. Lihat
  `OrderFlow.notifyConsumer()` di core-api untuk pola yang benar.
- **PEMBAYARAN MENDAHULUI DISPATCH.** Order naik ke PAID dulu
  (JRN-P01), baru dispatch dimulai. Ini bukan detail implementasi,
  ini aturan bisnis: QRIS dinamis kedaluwarsa 10-15 menit, kalau
  pembayaran diletakkan setelah driver ditemukan, QR bisa mati saat
  menunggu driver menjawab.
- **Idempotensi di mana pun ada webhook/retry lintas layanan**: webhook
  akuisitor pembayaran, callback dispatch→core-api, retry HTTP
  notification — semuanya dirancang aman dipanggil ulang (cek status
  saat ini sebelum transisi, atau `dedupeKey` yang ditolak layanan
  penerima kalau sudah pernah diproses). Pola baru yang menyentuh
  batas layanan harus mengikuti pola ini, bukan berasumsi tiap
  panggilan HTTP hanya terjadi sekali.

## Status implementasi (Fase 1)

Cek `README.md` §Status untuk tabel per-modul yang lebih detail — ini
cuma ringkasan cepat, dan **bisa sudah usang**, verifikasi lewat
`git log` dan task list kalau butuh kepastian:

**Selesai dan teruji** (semua test lolos per commit `11f4049`):
Dispatch & Matching (modul 5, termasuk scheduler `sweepExpired`),
Supply State/`location` (modul 4), Order Lifecycle (modul 6),
Escrow & Settlement (modul 13, JRN-P01–P04, Postgres+Drizzle
terverifikasi ke DB nyata), Notification & Realtime (modul 9, termasuk
wiring penuh ke `OrderFlow`).

**Belum dikerjakan**: Identity & Membership (modul 1, kerangka kosong —
prioritas berikutnya), Partner Lifecycle (modul 2), Geo & Maps (modul
3), Pricing & Promo (modul 7, MDR/bagian mitra masih hardcode),
Payments & Wallet (modul 8, belum ada integrasi akuisitor sungguhan),
Payout Mitra (modul 10), Catalog/Trust & Safety/Communication (modul
11/12/14, Fase 2), adaptor Redis untuk dispatch dan location (masih
in-memory), integrasi push sungguhan FCM/APNS (masih `NoopPushAdapter`),
antrean retry notification (fase 2, fungsi `retryDelayMs`/`shouldRetry`
sudah ada di `domain/delivery.ts` tapi belum dipakai).

Urutan yang disarankan untuk lanjutan: **Identity → Partner Lifecycle →
Payment**, karena Partner dan Payment sama-sama butuh fondasi
autentikasi dari Identity.

## Gaya kerja yang diharapkan Ulpermadi

- Menulis dalam Bahasa Indonesia santai ("bro", "Gaspollll" = lanjut
  penuh, "lanjutkan" = teruskan). Arsitek yang hands-on, bukan pemula —
  langsung ke inti, tapi tetap tandai risiko jelas untuk perubahan
  yang menyentuh alur finansial.
- **Konfirmasi dulu sebelum operasi destruktif/berisiko** (DB drop,
  reset, apa pun yang menyentuh data yang mungkin dibagi dengan
  garuda-superapp) — lihat contoh nyata di bagian migration di atas.
  Jangan berasumsi aman.
- **Commit lokal boleh digabung jadi satu ("total"), bukan wajib per
  domain** — beda dari kebiasaan di garuda-superapp. Tapi tetap tulis
  pesan commit yang jelas menyebutkan cakupan/fase, supaya sejarahnya
  tetap bisa ditelusuri meski satu commit besar.
- **Push ke `origin main` dilakukan Ulpermadi sendiri** dari
  PowerShell-nya, bukan diminta ke Claude untuk dieksekusi — sandbox
  ini toh tidak bisa menjalankan `git commit`/`push` yang andal (lihat
  §Keterbatasan sandbox).
- Setelah perubahan kode: tawarkan tugas verifikasi (jalankan test,
  bukan cuma asersi "sudah benar") sebelum menganggap task selesai.
