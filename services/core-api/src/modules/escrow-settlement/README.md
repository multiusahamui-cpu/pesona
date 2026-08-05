# Modul 13 — Escrow & Settlement

Siklus dana: terbitkan QRIS dinamis, tangkap notifikasi bayar, kelola Dana Tertahan per order, alokasi saat selesai, refund penuh & sebagian, penyapuan komisi EOD, dan penjagaan invariant rekonsiliasi.

**Fase:** 1

## Asal migrasi dari garuda-superapp

BELUM ADA. Fondasi dari server/pg-service.ts, tripay-*, wallet-journal-service.ts, reconciliation-service.ts, eod-*.ts di garuda.

## Aturan khusus modul ini

1. Akuisitor WAJIB disembunyikan di balik antarmuka `AcquirerPort`. Modul lain tidak boleh tahu apakah yang dipakai PG atau bank langsung.
2. Invariant rekonsiliasi adalah **gerbang**, bukan laporan. Penyapuan komisi tidak boleh jalan bila selisih != 0.
3. Refund hanya ke sumber pembayaran asal, tidak pernah melebihi nominal asli.
4. MDR mengurangi komisi Pesona, tidak pernah mengurangi hak mitra.

## Aturan batas (berlaku untuk semua modul)

- `index.ts` adalah satu-satunya permukaan publik.
- Modul lain tidak boleh menyentuh `repo/` atau `schema/` di sini.
- Tabel milik modul ini tidak boleh di-join langsung oleh modul lain.
- Pelanggaran ditolak otomatis oleh CI.

## Struktur

| Folder | Isi |
|---|---|
| `routes/` | Handler HTTP |
| `service/` | Logika bisnis — `ledger.ts` (kontrak `Ledger`, jurnal JRN-P01..P05, `InMemoryLedger`) |
| `repo/` | Akses data — privat. `drizzle-ledger.ts` (produksi, Postgres) |
| `schema/` | Definisi tabel Drizzle — privat. `ledger.schema.ts` (`journal_entries` + `journal_lines`, append-only) |

`Ledger` (kontrak, service/ledger.ts) sekarang murni async — setiap
pemanggil WAJIB `await`, termasuk `InMemoryLedger`. Ini disengaja: kalau
kontraknya dibiarkan sinkron-atau-async, pemanggil yang lupa `await` pada
`DrizzleLedger` lolos dari compiler tapi kehilangan jurnal di produksi.
`createApp()` di `@pesona/core-api` memilih `DrizzleLedger` otomatis kalau
`DATABASE_URL` disetel dan tidak ada ledger yang disuntik lewat `AppDeps`.
