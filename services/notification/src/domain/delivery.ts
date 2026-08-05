import type {
  DeliveryChannel,
  DeliveryOutcome,
  DeviceRegistration,
  InboxEntry,
  NotificationMessage,
  NotificationPolicy,
  Priority,
} from './types.js';
import { DEFAULT_NOTIFICATION_POLICY } from './types.js';

/**
 * Pemilihan kanal dan aturan pengiriman.
 *
 * Seluruh fungsi di sini murni: tidak memanggil FCM, tidak menyentuh
 * Redis. Yang dihasilkan adalah *keputusan*; eksekusinya di adaptor.
 */

/**
 * Apakah kanal ini bisa diandalkan untuk pesan genting.
 *
 * Ini bukan sekadar penilaian teknis, ini menentukan apakah aplikasi
 * driver boleh berbentuk PWA — dan jawabannya tidak (ADR-006):
 *
 *   - FCM/APNS pada aplikasi native: andal, bisa membangunkan perangkat
 *   - Web Push di Android: lumayan, tapi mati kalau browser dibunuh
 *   - Web Push di iOS: baru ada sejak 16.4, HANYA bila PWA sudah
 *     ditambahkan ke layar utama, dan keandalannya tidak cukup untuk
 *     hal yang time-critical
 */
export function isChannelReliableForCritical(
  channel: DeliveryChannel,
  // Sengaja tidak dipakai: Web Push di Android memang lebih baik daripada
  // di iOS, tetapi untuk pesan genting KEDUANYA tidak memadai. Parameter
  // dipertahankan agar pemanggil tidak perlu berubah bila kelak
  // pembedaan per platform benar-benar dibutuhkan.
  _platform: string,
): boolean {
  return channel === 'FCM' || channel === 'APNS';
}

/** Pilih kanal untuk satu perangkat. */
export function selectChannel(device: DeviceRegistration): DeliveryChannel {
  if (!device.pushToken) {
    // Tidak ada token: pesan tetap tersimpan, hanya tidak ada dorongan.
    return device.shell === 'native-webview' ? 'INBOX_ONLY' : 'WEBSOCKET';
  }
  if (device.shell === 'native-webview') {
    return device.platform === 'ios' ? 'APNS' : 'FCM';
  }
  return 'WEB_PUSH';
}

/**
 * Tawaran dispatch hanya boleh dikirim lewat kanal yang andal.
 *
 * Mengirimkannya lewat Web Push berarti driver mungkin tidak pernah
 * mendengarnya, tawaran hangus, dan konsumen menunggu satu gelombang
 * lebih lama tanpa sebab. Lebih baik driver itu tidak ditawari sama
 * sekali daripada ditawari lewat kanal yang mungkin bisu.
 */
export function mayReceiveDispatchOffer(device: DeviceRegistration): boolean {
  const channel = selectChannel(device);
  return isChannelReliableForCritical(channel, device.platform);
}

export interface DeliveryPlan {
  message: NotificationMessage;
  device: DeviceRegistration;
  channel: DeliveryChannel;
  outcome: DeliveryOutcome | null;
}

/**
 * Rencanakan pengiriman satu pesan ke satu perangkat.
 *
 * Mengembalikan outcome final bila sudah bisa diputuskan tanpa jaringan
 * (kedaluwarsa, kembar), atau `null` bila pengiriman perlu dicoba.
 */
export function planDelivery(
  message: NotificationMessage,
  device: DeviceRegistration,
  alreadyDeliveredKeys: ReadonlySet<string>,
  now: number,
): DeliveryPlan {
  const channel = selectChannel(device);

  if (alreadyDeliveredKeys.has(message.dedupeKey)) {
    return { message, device, channel, outcome: 'SKIPPED_DUPLICATE' };
  }

  if (message.expiresAt !== null && now >= message.expiresAt) {
    return { message, device, channel, outcome: 'SKIPPED_EXPIRED' };
  }

  if (channel === 'INBOX_ONLY') {
    return { message, device, channel, outcome: 'INBOX_ONLY' };
  }

  if (message.priority === 'CRITICAL' && !isChannelReliableForCritical(channel, device.platform)) {
    // Tetap ditulis ke kotak masuk, tetapi tidak diklaim terkirim.
    return { message, device, channel, outcome: 'INBOX_ONLY' };
  }

  return { message, device, channel, outcome: null };
}

/**
 * Urutan yang tidak boleh dibalik.
 *
 * Kotak masuk ditulis lebih dulu, selalu, apa pun hasil push. Fungsi ini
 * menegaskannya dalam bentuk tipe: entri kotak masuk dihasilkan tanpa
 * melihat hasil pengiriman sama sekali.
 */
export function toInboxEntry(message: NotificationMessage): InboxEntry {
  return { ...message, readAt: null };
}

/** Jeda percobaan ulang, mundur eksponensial. Percobaan mulai dari 1. */
export function retryDelayMs(
  attempt: number,
  policy: NotificationPolicy = DEFAULT_NOTIFICATION_POLICY,
): number {
  return policy.backoffBaseMs * 2 ** Math.max(0, attempt - 1);
}

export function shouldRetry(
  outcome: DeliveryOutcome,
  attempt: number,
  policy: NotificationPolicy = DEFAULT_NOTIFICATION_POLICY,
): boolean {
  return outcome === 'FAILED_RETRYABLE' && attempt < policy.maxAttempts;
}

/**
 * Batas waktu hidup pesan menurut jenisnya.
 *
 * Tawaran dispatch yang tiba 30 detik terlambat bukan cuma tidak berguna
 * — ia berbahaya, karena driver bisa mengetuk terima atas order yang
 * sudah dikerjakan orang lain.
 */
export function defaultExpiryFor(
  kind: NotificationMessage['kind'],
  createdAt: number,
  policy: NotificationPolicy = DEFAULT_NOTIFICATION_POLICY,
): number | null {
  switch (kind) {
    case 'DISPATCH_OFFER':
      return createdAt + 20_000;
    case 'CHAT_MESSAGE':
      return createdAt + 60 * 60 * 1000;
    case 'ANNOUNCEMENT':
      return null;
    default:
      return createdAt + policy.defaultTtlMs;
  }
}

export function priorityFor(kind: NotificationMessage['kind']): Priority {
  switch (kind) {
    case 'DISPATCH_OFFER':
      return 'CRITICAL';
    case 'ORDER_STATUS':
    case 'PAYMENT_RECEIVED':
    case 'PAYOUT_SETTLED':
      return 'HIGH';
    case 'CHAT_MESSAGE':
      return 'NORMAL';
    case 'ANNOUNCEMENT':
      return 'LOW';
  }
}
