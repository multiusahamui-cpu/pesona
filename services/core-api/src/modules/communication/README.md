# Modul 14 — Communication

Chat sementara antara konsumen dan mitra, serta panggilan suara dengan nomor tersamar.

**Fase:** 2

## Asal migrasi dari garuda-superapp

BELUM ADA. Sebagian pola dari server/websocket.ts dan routes/chat-quick-access.ts.

## Aturan khusus modul ini

1. Nomor telepon asli kedua pihak TIDAK BOLEH pernah terlihat satu sama lain.
2. Chat hilang dari tampilan setelah order selesai, tetapi diarsipkan terenkripsi untuk keperluan sengketa dengan retensi yang ditetapkan.
3. Belum dirinci — bentuknya bergantung pada state machine Order yang final.

## Aturan batas (berlaku untuk semua modul)

- `index.ts` adalah satu-satunya permukaan publik.
- Modul lain tidak boleh menyentuh `repo/` atau `schema/` di sini.
- Tabel milik modul ini tidak boleh di-join langsung oleh modul lain.
- Pelanggaran ditolak otomatis oleh CI.

## Struktur

| Folder | Isi |
|---|---|
| `routes/` | Handler HTTP |
| `service/` | Logika bisnis |
| `repo/` | Akses data — privat |
| `schema/` | Definisi tabel Drizzle — privat |
