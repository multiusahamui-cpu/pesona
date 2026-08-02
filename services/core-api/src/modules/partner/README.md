# Modul 2 — Partner Lifecycle

Onboarding & verifikasi driver/merchant, dokumen kendaraan, status aktif-suspend.

## Asal migrasi dari garuda-superapp

BELUM ADA di garuda. Pola awal dari routes/community-partner.ts, mobile-trader.ts, content-creator.ts

## Aturan batas

- `index.ts` adalah satu-satunya permukaan publik modul ini.
- Modul lain tidak boleh menyentuh `repo/` atau `schema/` di sini.
- Tabel milik modul ini tidak boleh di-join langsung oleh modul lain.
- Pelanggaran ditolak otomatis oleh CI, bukan oleh reviu manual.

## Struktur

| Folder | Isi |
|---|---|
| `routes/` | Handler HTTP |
| `service/` | Logika bisnis |
| `repo/` | Akses data — privat untuk modul ini |
| `schema/` | Definisi tabel Drizzle — privat untuk modul ini |
