# Modul 6 — Order Lifecycle

State machine order lintas vertikal + idempotensi.

## Asal migrasi dari garuda-superapp

Tersebar: routes/marketplace-orders.ts, blok /api/rides di ride-hailing.ts, idem-potensi.ts; server/order-stock.ts, shipping-service.ts

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
