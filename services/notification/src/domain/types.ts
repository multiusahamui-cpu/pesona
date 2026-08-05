/**
 * Tipe domain layanan notification — modul 9.
 *
 * Prinsip yang menentukan seluruh rancangan ini (ADR-006 pagar 5):
 *
 *   PUSH BUKAN JAMINAN PENGIRIMAN.
 *   Kotak masuk dalam aplikasi adalah sumber kebenaran; push hanya petunjuk.
 *
 * Konsekuensinya berurutan dan tidak boleh dibalik: pesan ditulis ke
 * kotak masuk LEBIH DULU, baru push dicoba. Kalau push gagal, pesannya
 * tetap ada dan bisa ditarik ulang. Kalau urutannya dibalik dan push
 * berhasil sementara penulisan kotak masuk gagal, pengguna melihat
 * notifikasi yang isinya tidak bisa dibuka lagi — dan klaim "saya tidak
 * pernah diberi tahu" jadi tidak bisa dibantah.
 */

export type ClientShell = 'browser' | 'pwa' | 'native-webview';
export type Platform = 'ios' | 'android' | 'web';

/**
 * Prioritas menentukan kanal dan perlakuan retry.
 *
 * CRITICAL dipakai sangat hemat: hanya untuk yang membangunkan perangkat
 * dan berbunyi keras. Kalau semua dianggap kritis, pengguna mematikan
 * notifikasi — dan yang benar-benar kritis ikut hilang.
 */
export type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export type NotificationKind =
  | 'DISPATCH_OFFER'      // tawaran order ke driver — paling genting
  | 'ORDER_STATUS'        // status berubah
  | 'PAYMENT_RECEIVED'
  | 'PAYOUT_SETTLED'
  | 'CHAT_MESSAGE'
  | 'ANNOUNCEMENT';

export interface NotificationMessage {
  /**
   * Kunci dedup, ditentukan pemanggil.
   *
   * Dua permintaan dengan kunci sama menghasilkan satu pesan. Ini yang
   * membuat pengiriman ulang akibat retry tidak berubah jadi tiga
   * notifikasi identik di layar pengguna.
   */
  dedupeKey: string;
  recipientId: string;
  kind: NotificationKind;
  priority: Priority;
  title: string;
  body: string;
  /** Muatan tambahan untuk penautan dalam aplikasi. */
  data?: Record<string, string>;
  createdAt: number;
  /** Setelah ini tidak berguna lagi dikirim. Tawaran dispatch kedaluwarsa cepat. */
  expiresAt: number | null;
}

export interface InboxEntry extends NotificationMessage {
  readAt: number | null;
}

export type DeliveryChannel = 'FCM' | 'APNS' | 'WEB_PUSH' | 'WEBSOCKET' | 'INBOX_ONLY';

export interface DeviceRegistration {
  deviceId: string;
  recipientId: string;
  shell: ClientShell;
  platform: Platform;
  pushToken: string | null;
  lastSeenAt: number;
}

export type DeliveryOutcome =
  | 'DELIVERED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT'
  | 'SKIPPED_EXPIRED'
  | 'SKIPPED_DUPLICATE'
  /** Perangkat tidak punya kanal push yang layak — kotak masuk saja. */
  | 'INBOX_ONLY';

export interface NotificationPolicy {
  maxAttempts: number;
  /** Jeda dasar mundur eksponensial, milidetik. */
  backoffBaseMs: number;
  /** Umur maksimum pesan tanpa expiresAt eksplisit. */
  defaultTtlMs: number;
}

export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = {
  maxAttempts: 3,
  backoffBaseMs: 2_000,
  defaultTtlMs: 24 * 60 * 60 * 1000,
};
