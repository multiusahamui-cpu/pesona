# Modul 8 — Payments & Wallet

Saldo, topup, transfer, payment gateway, refund.

## Asal migrasi dari garuda-superapp

Matang: routes/wallet.ts, xendit-pg.ts, duitku-pg.ts, ppob.ts, setor-manual.ts, exchanger.ts; server/pg-service.ts, tripay-*, wallet-journal-service.ts

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
