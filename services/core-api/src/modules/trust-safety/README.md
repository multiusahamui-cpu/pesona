# Modul 12 — Trust & Safety

Rating, komplain, blacklist, deteksi GPS spoof & order fiktif.

## Asal migrasi dari garuda-superapp

BELUM ADA. Pondasi dari routes/support.ts, observability.ts; server/rate-limit-middleware.ts, sla-service.ts

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
