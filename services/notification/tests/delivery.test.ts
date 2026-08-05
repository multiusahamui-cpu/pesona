import { describe, it, expect } from 'vitest';
import {
  selectChannel,
  isChannelReliableForCritical,
  mayReceiveDispatchOffer,
  planDelivery,
  toInboxEntry,
  retryDelayMs,
  shouldRetry,
  defaultExpiryFor,
  priorityFor,
} from '../src/domain/delivery.js';
import {
  DEFAULT_NOTIFICATION_POLICY as POL,
  type DeviceRegistration,
  type NotificationMessage,
} from '../src/domain/types.js';

const T0 = 1_770_000_000_000;

function device(over: Partial<DeviceRegistration> = {}): DeviceRegistration {
  return {
    deviceId: 'dev-1',
    recipientId: 'user-1',
    shell: 'native-webview',
    platform: 'android',
    pushToken: 'token-abc',
    lastSeenAt: T0,
    ...over,
  };
}

function message(over: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    dedupeKey: 'key-1',
    recipientId: 'user-1',
    kind: 'ORDER_STATUS',
    priority: 'HIGH',
    title: 'Pesanan diterima',
    body: 'Driver sedang menuju lokasi Anda',
    createdAt: T0,
    expiresAt: null,
    ...over,
  };
}

describe('Pemilihan kanal', () => {
  it('native Android ke FCM, native iOS ke APNS', () => {
    expect(selectChannel(device({ platform: 'android' }))).toBe('FCM');
    expect(selectChannel(device({ platform: 'ios' }))).toBe('APNS');
  });

  it('PWA dan browser ke Web Push', () => {
    expect(selectChannel(device({ shell: 'pwa', platform: 'android' }))).toBe('WEB_PUSH');
    expect(selectChannel(device({ shell: 'browser', platform: 'web' }))).toBe('WEB_PUSH');
  });

  it('tanpa token push, native jatuh ke kotak masuk dan web ke WebSocket', () => {
    expect(selectChannel(device({ pushToken: null }))).toBe('INBOX_ONLY');
    expect(selectChannel(device({ pushToken: null, shell: 'pwa' }))).toBe('WEBSOCKET');
  });
});

describe('Keandalan kanal untuk pesan genting — dasar ADR-006', () => {
  it('hanya kanal native yang dianggap andal', () => {
    expect(isChannelReliableForCritical('FCM', 'android')).toBe(true);
    expect(isChannelReliableForCritical('APNS', 'ios')).toBe(true);
    expect(isChannelReliableForCritical('WEB_PUSH', 'android')).toBe(false);
    expect(isChannelReliableForCritical('WEB_PUSH', 'ios')).toBe(false);
    expect(isChannelReliableForCritical('WEBSOCKET', 'web')).toBe(false);
  });

  /**
   * Inilah pembuktian teknis kenapa aplikasi driver WAJIB native.
   * Bukan preferensi arsitektur — PWA memang tidak punya kanal yang
   * cukup andal untuk membangunkan perangkat saat order masuk.
   */
  it('driver PWA tidak boleh menerima tawaran dispatch', () => {
    expect(mayReceiveDispatchOffer(device({ shell: 'native-webview', platform: 'android' }))).toBe(true);
    expect(mayReceiveDispatchOffer(device({ shell: 'native-webview', platform: 'ios' }))).toBe(true);
    expect(mayReceiveDispatchOffer(device({ shell: 'pwa', platform: 'android' }))).toBe(false);
    expect(mayReceiveDispatchOffer(device({ shell: 'pwa', platform: 'ios' }))).toBe(false);
    expect(mayReceiveDispatchOffer(device({ shell: 'browser', platform: 'web' }))).toBe(false);
  });
});

describe('Kotak masuk adalah sumber kebenaran — ADR-006 pagar 5', () => {
  /**
   * Entri kotak masuk dibuat tanpa melihat hasil pengiriman sama sekali.
   * Itu ditegaskan lewat bentuk fungsinya: toInboxEntry hanya menerima
   * pesan, bukan hasil push.
   */
  it('entri kotak masuk tidak bergantung pada keberhasilan push', () => {
    const entry = toInboxEntry(message());
    expect(entry.dedupeKey).toBe('key-1');
    expect(entry.readAt).toBeNull();
    expect(toInboxEntry.length).toBe(1);
  });

  it('pesan genting ke kanal tidak andal tetap masuk kotak masuk, tidak diklaim terkirim', () => {
    const plan = planDelivery(
      message({ kind: 'DISPATCH_OFFER', priority: 'CRITICAL' }),
      device({ shell: 'pwa', platform: 'ios' }),
      new Set(),
      T0,
    );
    expect(plan.outcome).toBe('INBOX_ONLY');
  });
});

describe('Dedup dan kedaluwarsa', () => {
  it('kunci yang sudah pernah terkirim dilewati', () => {
    const plan = planDelivery(message(), device(), new Set(['key-1']), T0);
    expect(plan.outcome).toBe('SKIPPED_DUPLICATE');
  });

  it('pesan yang sudah lewat waktu tidak dikirim', () => {
    const plan = planDelivery(
      message({ expiresAt: T0 + 10_000 }),
      device(),
      new Set(),
      T0 + 11_000,
    );
    expect(plan.outcome).toBe('SKIPPED_EXPIRED');
  });

  it('pesan yang layak dikirim menghasilkan outcome null — perlu dicoba', () => {
    const plan = planDelivery(message(), device(), new Set(), T0);
    expect(plan.outcome).toBeNull();
    expect(plan.channel).toBe('FCM');
  });
});

describe('Masa berlaku menurut jenis pesan', () => {
  /**
   * Tawaran dispatch yang tiba terlambat bukan cuma tidak berguna — ia
   * berbahaya, karena driver bisa mengetuk terima atas order yang sudah
   * dikerjakan orang lain.
   */
  it('tawaran dispatch berumur sangat pendek', () => {
    const exp = defaultExpiryFor('DISPATCH_OFFER', T0);
    expect(exp).toBe(T0 + 20_000);
  });

  it('pengumuman tidak kedaluwarsa', () => {
    expect(defaultExpiryFor('ANNOUNCEMENT', T0)).toBeNull();
  });

  it('sisanya memakai TTL bawaan', () => {
    expect(defaultExpiryFor('PAYMENT_RECEIVED', T0)).toBe(T0 + POL.defaultTtlMs);
  });
});

describe('Prioritas', () => {
  it('hanya tawaran dispatch yang CRITICAL', () => {
    expect(priorityFor('DISPATCH_OFFER')).toBe('CRITICAL');
    const lain = (['ORDER_STATUS', 'PAYMENT_RECEIVED', 'PAYOUT_SETTLED', 'CHAT_MESSAGE', 'ANNOUNCEMENT'] as const);
    expect(lain.map(priorityFor)).not.toContain('CRITICAL');
  });
});

describe('Percobaan ulang', () => {
  it('mundur eksponensial', () => {
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(2)).toBe(4_000);
    expect(retryDelayMs(3)).toBe(8_000);
  });

  it('hanya kegagalan yang bisa diulang, dan tidak melewati batas', () => {
    expect(shouldRetry('FAILED_RETRYABLE', 1)).toBe(true);
    expect(shouldRetry('FAILED_RETRYABLE', POL.maxAttempts)).toBe(false);
    expect(shouldRetry('FAILED_PERMANENT', 1)).toBe(false);
    expect(shouldRetry('DELIVERED', 1)).toBe(false);
  });
});
