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
| `routes/` | Handler HTTP (`order-routes.ts`) |
| `service/` | Logika bisnis: `order-service.ts` (state machine), `order-flow.ts` (orkestrasi ke dispatch dan notification), `dispatch-client.ts` (port HTTP ke layanan dispatch), `notification-client.ts` (port HTTP ke layanan notification) |
| `repo/` | Akses data — privat untuk modul ini. `drizzle-order-repo.ts` (produksi) |
| `schema/` | Definisi tabel Drizzle — privat untuk modul ini. `order.schema.ts` (tabel `orders`) |

`InMemoryOrderRepo` (di `service/order-service.ts`) dan `DrizzleOrderRepo`
(di `repo/`) sama-sama memenuhi kontrak `OrderRepo` — `createApp()` di
`src/index.ts` memilih otomatis: `DrizzleOrderRepo` kalau `DATABASE_URL`
disetel dan tidak ada repo yang disuntik lewat `AppDeps`, kalau tidak
jatuh ke in-memory.

## Sambungan ke layanan `dispatch`

`OrderFlow` (di `service/order-flow.ts`) menjahit state machine order ke
mesin dispatch lewat `DispatchPort`:

- `POST /internal/payments/:orderId/confirmed` — dipanggil modul payment.
  Menaikkan order ke PAID (JRN-P01), lalu memanggil `dispatch.start()`.
  Kandidat habis di gelombang pertama → order dibatalkan otomatis dengan
  refund penuh (JRN-P03), bukan dibiarkan menggantung.
- `POST /internal/orders/:orderId/assign` — dipanggil layanan dispatch
  saat seorang driver menerima tawaran.
- `POST /internal/orders/:orderId/dispatch-exhausted` — dipanggil layanan
  dispatch saat seluruh kandidat habis tanpa ada yang menerima.

`DispatchPort` defaultnya `HttpDispatchClient` bila env `DISPATCH_URL`
disetel, kalau tidak jatuh ke `StaticDispatchClient` (in-memory, untuk
pengembangan dan tes) — pola yang sama seperti `SupplyPort` di layanan
dispatch sendiri.

Webhook pembayaran yang dikirim ulang akuisitor setelah order sudah
melangkah lebih jauh (mis. sudah DISPATCHING atau ASSIGNED) ditangani
sebagai idempotensi, bukan galat — lihat komentar di `onPaymentConfirmed`.

## Sambungan ke layanan `notification`

`OrderFlow` juga memanggil `NotificationPort` di tiap transisi yang
perlu diketahui pengguna: pembayaran diterima → mencari driver, driver
ditemukan, perjalanan dimulai, perjalanan selesai, dan pembatalan
(dengan atau tanpa biaya). Karena itu, `POST /internal/orders/:orderId/start`,
`.../complete`, dan `.../cancel` sekarang lewat `orderFlow.onTripStarted`
/ `onTripCompleted` / `onOrderCancelled` — BUKAN `orderService.start`/
`complete`/`cancel` langsung — supaya notifikasi tidak pernah terlewat
saat titik masuknya bertambah di masa depan.

Dua hal yang sengaja dijaga:

- **Kegagalan kirim notifikasi tidak pernah menggagalkan alur order.**
  Order sudah sah berpindah status lewat `OrderService` sebelum
  `NotificationPort.send()` dipanggil; kegagalan di sana hanya dicatat
  (`console.error`), tidak dilempar ulang. Lihat `OrderFlow.send()`.
- **Konsumen bisa tidak punya akun** (`consumerId: string | null` —
  konsumen TIDAK wajib jadi anggota koperasi). `notifyConsumer()`
  melewati pemanggilan sama sekali kalau `consumerId` null, di level
  `OrderFlow` — bukan didiamkan di layanan notification, yang tidak
  tahu apa-apa soal keanggotaan.

`dedupeKey` tiap notifikasi berbentuk `${orderId}:consumer:${event}` /
`${orderId}:partner:${event}` (mis. `ORD-1:consumer:assigned`) —
deterministik per order+peristiwa, jadi panggilan berulang (webhook
akuisitor dikirim ulang, retry HTTP dari dispatch) aman: layanan
notification sendiri yang menolak kunci kembar, `OrderFlow` tidak perlu
melacak status "sudah diberi tahu" sendiri.

`NotificationPort` defaultnya `HttpNotificationClient` bila env
`NOTIFICATION_URL` disetel, kalau tidak jatuh ke
`StaticNotificationClient` (in-memory, untuk pengembangan dan tes) —
pola yang identik dengan `DispatchPort`.
