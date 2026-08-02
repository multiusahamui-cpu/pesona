# Modul 10 — Payout Mitra

Pencairan harian driver/merchant, hold, settlement.

## Asal migrasi dari garuda-superapp

Parsial: server/marketplace-settlement-service.ts, eod-standing-order.ts, bom-service.ts. PENTING: klaster GL-journal dipindah UTUH, tidak dipecah.

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
