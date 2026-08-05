# @pesona/notification

Modul 9 — push & realtime. Diekstrak karena bursty dan IO-bound.

## Menjalankan

Dari **root monorepo**, bukan dari folder ini:

```bash
pnpm --filter @pesona/notification dev
```

Tidak perlu `cd` ke folder ini.

## Struktur

| Berkas | Isi |
|---|---|
| `domain/types.ts` | Tipe murni: `NotificationMessage`, `InboxEntry`, `DeviceRegistration`, dll. |
| `domain/delivery.ts` | Aturan murni: pemilihan kanal (`selectChannel`), rencana pengiriman (`planDelivery`), prioritas/kedaluwarsa per jenis pesan. Tidak menyentuh jaringan atau penyimpanan. |
| `store.ts` | `InboxStore`/`InMemoryInboxStore` (kotak masuk + dedup per penerima), `DeviceStore`/`InMemoryDeviceStore` (registrasi perangkat per penerima). |
| `push-client.ts` | `PushPort`/`NoopPushAdapter` — batas ke FCM/APNS/Web Push sungguhan. Fase 1 belum terhubung ke penyedia sungguhan; selalu melaporkan DELIVERED supaya alur ujung-ke-ujung bisa dites sekarang. |
| `routes.ts` | Handler HTTP tipis di atas `domain/delivery.ts` + `store.ts` + `push-client.ts`. |

## Urutan yang tidak boleh dibalik (ADR-006 pagar 5)

PUSH BUKAN JAMINAN PENGIRIMAN. `POST /internal/notifications/send`
SELALU menulis ke kotak masuk (`inbox.append()`) LEBIH DULU, baru
mencoba push per perangkat. Kalau push gagal, pesannya tetap ada dan
bisa ditarik ulang lewat `GET /api/notifications/inbox`. Urutan ini
ditegakkan secara struktural di `routes.ts` — `toInboxEntry()` di
`domain/delivery.ts` bahkan tidak melihat hasil pengiriman sama sekali.

Pesan dengan `dedupeKey` yang sudah ada di kotak masuk penerima
ditolak sebelum ditulis ulang atau didorong ulang (`SKIPPED_DUPLICATE`)
— ini yang membuat pemanggil (core-api lewat `NotificationPort`) aman
mengirim ulang permintaan yang sama berkali-kali (retry webhook, dll).

Tawaran dispatch (`DISPATCH_OFFER`, prioritas `CRITICAL`) hanya
dianggap terkirim lewat kanal andal (FCM/APNS). Perangkat yang cuma
punya Web Push tetap menerima entri kotak masuk, tapi hasilnya
`INBOX_ONLY` — push TIDAK dicoba sama sekali (lihat
`isChannelReliableForCritical()`), supaya driver tidak dianggap sudah
diberi tahu padahal push-nya mungkin tidak pernah berbunyi.

## Rute HTTP

- `POST /internal/notifications/send` — dipanggil core-api
  (`NotificationPort` milik modul Order, dan modul lain di masa depan).
- `POST /api/devices/register` — klien mendaftarkan perangkatnya.
- `GET /api/notifications/inbox` — daftar kotak masuk milik penerima
  (header `X-Pesona-Recipient-Id`).
- `POST /api/notifications/:id/read` — `:id` adalah `dedupeKey`, bukan
  id terpisah — kotak masuk tidak punya id lain.

## Fase 2 (belum dikerjakan)

- Adaptor push sungguhan (FCM/APNS/Web Push) menggantikan
  `NoopPushAdapter`, di belakang `PushPort` yang sama — `routes.ts`
  tidak perlu berubah.
- Antrean retry sungguhan memakai `retryDelayMs()`/`shouldRetry()` di
  `domain/delivery.ts` (sudah ada, belum dipakai) — fase 1 hanya
  mencoba sekali per perangkat per permintaan.
- `InMemoryInboxStore`/`InMemoryDeviceStore` diganti backend Redis,
  tanpa mengubah pemanggil (`InboxStore`/`DeviceStore` sudah jadi batas
  interface untuk itu).
