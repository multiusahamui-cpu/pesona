# Jurnal kerja — Pesona SuperApp

Catatan naratif berjalan, bukan dokumen keadaan-sekarang. Beda perannya
dari `CLAUDE.md` (root repo) dan `README.md`: kedua dokumen itu SELALU
ditulis ulang supaya mencerminkan keadaan terkini — begitu sesuatu
usang, isinya diganti. Jurnal ini sebaliknya: **append-only**, tidak
pernah ditimpa. Tiap sesi kerja baru menambah entri baru di bagian
paling bawah, entri lama tidak diedit kecuali salah fakta.

Gunanya: `CLAUDE.md` menjawab "apa aturan mainnya sekarang", jurnal ini
menjawab "kenapa aturan itu ada" dan "apa yang sudah dicoba dan gagal" —
konteks yang gampang hilang kalau cuma disimpan di ringkasan evergreen.

Kalau memulai sesi baru: baca `CLAUDE.md` dulu untuk aturan main
terkini, baru baca entri jurnal beberapa terakhir di sini untuk konteks
kenapa keadaan sekarang begini.

(Catatan lokasi: idealnya berkas ini ada di `.claude/JOURNAL.md` supaya
jelas ini catatan kerja Claude, tapi direktori `.claude/` diproteksi di
sandbox Claude — tidak bisa ditulis langsung. Ditaruh di `docs/` sebagai
gantinya.)

---

## 2 Agustus 2026 — Fase 0: scaffold monorepo

Arsitektur disetujui (`ARSITEKTUR-PESONA-SUPERAPP.md` ditulis hari ini).
Keputusan besar: modular monolith + ekstraksi selektif (ADR-001), bukan
microservices — dispatch/location/notification diekstrak duluan karena
stateful/bursty, sisanya tetap satu proses `core-api`.

Scaffold 16 paket workspace (pnpm + Turborepo), `packages/config`
(ESLint + aturan batas modul lewat `eslint-plugin-boundaries`),
`packages/contracts` (fondasi zod, tipe `Money`, state machine Order),
CI GitHub Actions, Dockerfile 4 service. 11 modul domain di core-api
dibuat kerangka kosong (`export {}`) sesuai peta 12(+2) modul di ADR.

Commit: `d7a442a` — scaffold monorepo Pesona SuperApp (Fase 0).

## 2–3 Agustus 2026 — Modul 13/14 dan model keuangan

Ditambahkan modul 13 (Escrow & Settlement) dan 14 (Communication) yang
belum ada di peta awal. Diskusi keuangan 2–3 Agustus dituangkan ke
dokumen terpisah `ARSITEKTUR-KEUANGAN-PESONA.md`: model peran berubah
dari berjenjang (gaya Garuda) jadi **sejajar** — konsumen TIDAK wajib
jadi anggota koperasi, mitra (driver/merchant) WAJIB anggota sebelum
pencairan pertama. Ini mengubah struktur modul 1 (Identity) dan modul 2
(Partner) secara struktural, jadi harus dipikirkan sebelum modul itu
dibangun, bukan sesudahnya.

Bagan jurnal JRN-P01–P09 dirancang di dokumen itu, plus struktur tiga
rekening (R1 operasional, R2 cash pool, R3 dana anggota) dan invariant
rekonsiliasi. Baru rancangan di atas kertas — belum ada baris kode.

Perbaikan konfigurasi pnpm/mobile juga masuk di rentang ini (jaringan
`network-concurrency`, instalasi bertahap, perbaikan Metro/Jest untuk
tiga app mobile).

Commit: `1400d5b` (konfigurasi mobile), `75662a6` (jaringan pnpm).

## 5 Agustus 2026 — Fase 1: alur inti ride-hailing hidup dan teruji

Sesi kerja panjang, satu commit besar di akhir (`11f4049`) mencakup
semuanya di bawah ini karena diminta jadi satu commit "total", bukan
per-domain (permintaan eksplisit Ulpermadi — beda dari kebiasaan
komit-per-domain di garuda-superapp).

**Dispatch & Matching (modul 5).** Mesin gelombang tawaran, terima/
tolak/kedaluwarsa, sudah ada dari sesi sebelumnya. Ditambah hari ini:
`scheduler.ts` — `sweepExpired()` di domain murni tidak pernah dipanggil
otomatis, jadi tawaran lewat TTL tidak pernah ditandai EXPIRED dan order
menggantung selamanya. `startExpirySweeper()` jadi jawabannya: interval
2 detik, hanya menyala di `start()` (bukan `createApp()`, supaya test
tidak membocorkan timer), berhenti rapi lewat SIGTERM/SIGINT.

**core-api ↔ dispatch tersambung lewat HTTP.** Pola port/adapter:
`DispatchPort`/`OrderPort` interface + `Http*Client` (aktif kalau env
var URL disetel) + `Static*Client`/`Recording*Client` (fallback). Order
naik ke PAID dulu (JRN-P01), baru dispatch dimulai — bukan sebaliknya,
karena QRIS dinamis kedaluwarsa 10–15 menit.

**Persistensi Postgres.** Skema Drizzle untuk `orders` dan
`journal_entries`/`journal_lines` (append-only, tidak pernah UPDATE).
`Ledger` di-refactor dari class jadi interface — awalnya draf pertama
pakai `void | Promise<void>` union supaya minim perubahan, tapi
disadari itu bisa bikin `DrizzleLedger` lupa `await` dan diam-diam
kehilangan tulisan jurnal finansial tanpa galat apa pun. Diperbaiki
jadi `Promise<T>` penuh di semua method sebelum sempat jadi bug
produksi. `DrizzleOrderRepo`/`DrizzleLedger` diverifikasi dua lapis:
migration DDL (`db:migrate`) dan test integrasi DML sungguhan
(`drizzle-integration.test.ts`, `describe.skipIf` kalau `DATABASE_URL`
tidak ada).

**Insiden yang perlu diingat**: `db:migrate` sempat gagal dengan
`relation "orders" already exists` — kemungkinan `DATABASE_URL`
menunjuk ke database yang sama dengan garuda-superapp (yang juga punya
tabel `orders`). Bukannya langsung bikin script drop-table, ditanya
dulu eksplisit lewat `AskUserQuestion` apakah itu database dev pesona
yang terpisah. Ulpermadi konfirmasi database terpisah dan mengizinkan
drop. `scripts/reset-db.mjs` dibuat khusus untuk itu, dengan komentar
peringatan besar di puncaknya. **Pelajarannya bukan soal script-nya,
tapi urutannya: konfirmasi dulu, baru eksekusi destruktif** — lihat
aturan yang sama di `CLAUDE.md`.

**Notification (modul 9) dibangun dari nol.** Domain murni
(`types.ts`/`delivery.ts`) sudah ada dari sesi sebelumnya, tapi belum
ada `store.ts` maupun `routes.ts` sama sekali. Dibangun: `InboxStore`/
`DeviceStore` in-memory, `PushPort`/`NoopPushAdapter` (belum ke FCM/
APNS sungguhan — fase 2), rute HTTP. Aturan yang ditegakkan struktural,
bukan cuma didokumentasikan: kotak masuk WAJIB ditulis sebelum push
dicoba (ADR-006 pagar 5) — kalau dibalik, pengguna bisa mengaku "tidak
pernah diberi tahu" dan itu tidak bisa dibantah.

**core-api disambung ke notification.** `NotificationPort` + `OrderFlow`
diperluas: notifikasi otomatis di tiap transisi (dispatching, driver
ditemukan, perjalanan mulai/selesai, dibatalkan). Dua aturan dijaga
ketat: kegagalan kirim notifikasi TIDAK PERNAH menggagalkan alur order
(cuma dicatat), dan konsumen yang `consumerId`-nya null (non-anggota)
dilewati diam-diam di level `OrderFlow`, bukan di layanan notification
yang tidak tahu apa-apa soal keanggotaan.

Total test lolos di commit ini: 43 core-api → jadi 53 setelah
notification, 33 dispatch, 36 notification.

**Insiden git index.lock.** Sandbox Claude sempat menjalankan `git
status` langsung di folder ini (mount Windows→Linux) untuk verifikasi
setelah commit. Ternyata itu bisa meninggalkan `.git/index.lock`
SUNGGUHAN di disk (dikonfirmasi lewat `Test-Path` dari PowerShell =
`True`), karena sandbox bisa membuat file di mount ini tapi tidak bisa
menghapusnya sendiri (`Operation not permitted` pada unlink). Kalau
tidak dihapus manual, ini akan memblokir `git add`/`commit` berikutnya
dari CLI Windows manapun — nggak peduli sandbox atau bukan. **Sejak
insiden ini: Claude tidak menjalankan perintah `git` apa pun dari
sandbox di repo ini, termasuk yang read-only seperti `status`/`log`.**
Kalau butuh tahu state git, minta Ulpermadi jalankan dan tempel hasil.

Commit: `11f4049` — mencakup seluruh pekerjaan di atas.

**Dokumentasi.** `README.md` §Status dirombak dari "Fase 0 selesai"
(sudah usang jauh) jadi tabel progres per-modul akurat. `CLAUDE.md`
dibuat pertama kali. Kedua dokumen ADR diberi header status terkini
dan baris riwayat perubahan, tanpa dijadikan tracker progres dobel dari
README. Jurnal ini dibuat di penghujung sesi yang sama, atas permintaan
eksplisit Ulpermadi setelah menyadari belum ada catatan naratif
tersendiri di luar `CLAUDE.md` — awalnya dicoba di `.claude/JOURNAL.md`
tapi direktori itu terproteksi di sandbox, dipindah ke `docs/`.

---

## Rencana lanjutan (ringkas — detail terkini selalu di `README.md`)

Urutan yang disarankan untuk sisa Fase 1: **Identity & Membership →
Partner Lifecycle → Payment (integrasi akuisitor sungguhan) → Pricing
& Promo → Payout Mitra**. Identity duluan karena Partner dan Payment
sama-sama butuh fondasi autentikasi. Redis untuk dispatch/location
(masih in-memory) bisa disisipkan kapan saja sebelum beban produksi
sungguhan, tidak harus menunggu urutan modul di atas.

Fase 2 (Catalog, Trust & Safety — jangan molor lebih dari sini karena
risiko kebocoran finansial, Communication) baru setelah Fase 1 lengkap.
Fase 3 memindah domain koperasi/akuntansi dari garuda-superapp (EOD,
savings, nominatif, dst.) — sengaja ditunda karena tidak menghambat
jalannya ride-hailing inti. Fase 4 adalah keputusan skala (cloud
provider, PgBouncer, read replica) sebelum target 10 juta pengguna.
