import type { DeliveryChannel, DeviceRegistration, NotificationMessage } from './domain/types.js';

/**
 * Adaptor pengiriman push sungguhan — modul 9.
 *
 * `PushPort` sengaja HANYA punya tanggung jawab "coba kirim, laporkan
 * hasil". Ia tidak boleh tahu soal kotak masuk sama sekali — urutan
 * "kotak masuk dulu, baru push" (ADR-006 pagar 5) ditegakkan di
 * routes.ts, sebelum port ini pernah dipanggil.
 */
export interface PushPort {
  send(
    device: DeviceRegistration,
    message: NotificationMessage,
    channel: DeliveryChannel,
  ): Promise<'DELIVERED' | 'FAILED_RETRYABLE' | 'FAILED_PERMANENT'>;
}

/**
 * Fase 1: belum ada integrasi FCM/APNS/Web Push sungguhan.
 *
 * Selalu melaporkan DELIVERED — bukan karena push benar-benar terkirim,
 * tapi supaya alur end-to-end (kotak masuk + rute HTTP + status
 * pengiriman) bisa dites dan dipakai sekarang, dengan adaptor sungguhan
 * dipasang belakangan tanpa mengubah routes.ts sama sekali (itulah
 * gunanya PushPort sebagai batas).
 */
export class NoopPushAdapter implements PushPort {
  public readonly calls: Array<{
    deviceId: string;
    recipientId: string;
    dedupeKey: string;
    channel: DeliveryChannel;
  }> = [];

  async send(
    device: DeviceRegistration,
    message: NotificationMessage,
    channel: DeliveryChannel,
  ): Promise<'DELIVERED' | 'FAILED_RETRYABLE' | 'FAILED_PERMANENT'> {
    this.calls.push({
      deviceId: device.deviceId,
      recipientId: device.recipientId,
      dedupeKey: message.dedupeKey,
      channel,
    });
    return 'DELIVERED';
  }
}
