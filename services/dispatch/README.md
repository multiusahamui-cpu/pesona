# @pesona/dispatch

Modul 5 — matching engine. Diekstrak karena stateful, indeks geo in-memory, target latensi <100 ms.

## Menjalankan

Dari **root monorepo**, bukan dari folder ini:

```bash
pnpm --filter @pesona/dispatch dev
```

Tidak perlu `cd` ke folder ini.

## Env

| Variabel | Wajib | Dibaca langsung dari `process.env`, bukan `platform/env.ts` |
|---|---|---|
| `LOCATION_URL` | tidak | sumber kandidat driver (`SupplyPort`). Kosong → `StaticSupplyClient` (kandidat kosong). |
| `CORE_API_URL` | tidak | tujuan callback assign/exhausted (`OrderPort`). Kosong → `RecordingOrderClient` (mencatat, tidak mengirim HTTP) — supaya layanan ini tetap bisa jalan berdiri sendiri di pengembangan. |

## Sambungan ke core-api

`POST /internal/dispatch/start` dipanggil core-api saat order naik ke PAID
(lihat `OrderFlow.onPaymentConfirmed` di `@pesona/core-api`). Sebaliknya,
dispatch memanggil balik core-api lewat `OrderPort`:

- Driver menerima tawaran → `POST {CORE_API_URL}/internal/orders/:orderId/assign`
- Kandidat habis di gelombang terakhir → `POST {CORE_API_URL}/internal/orders/:orderId/dispatch-exhausted`

## Scheduler kedaluwarsa tawaran

`sweepExpired()` di `domain/engine.ts` murni — sesuatu harus memanggilnya
berkala, kalau tidak tawaran yang lewat TTL (15 detik) tidak pernah
ditandai EXPIRED dan order menggantung selamanya. `src/scheduler.ts`
menyediakan itu: interval (default 2 detik) yang menyapu SELURUH sesi
`SEARCHING` di `SessionStore`, bukan endpoint HTTP per-offer
(`/internal/dispatch/offers/:offerId/expire`, yang tetap ada untuk
dipanggil klien yang menerima notifikasi kedaluwarsa spesifik).

Scheduler hanya menyala di `start()` (proses server sungguhan) — TIDAK
di `createApp()`, supaya test suite yang memanggil `createApp()`
berkali-kali tidak membocorkan timer. Berhenti rapi lewat `SIGTERM`/
`SIGINT`, bukan proses dibunuh mendadak.
