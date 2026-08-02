# Modul 3 — Geo & Maps

Geocoding, routing, geofence, zona operasi.

## Asal migrasi dari garuda-superapp

Menempel di routes/ride-hailing.ts (blok /api/maps/*); server/rajaongkir-service.ts; locations.csv

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
