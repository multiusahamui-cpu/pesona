/**
 * Batas ke layanan notification (modul 9, terpisah).
 *
 * Bentuk `NotifyInput` sengaja mengikuti persis body yang diharapkan
 * `POST /internal/notifications/send` di @pesona/notification — lihat
 * services/notification/src/routes.ts. Tidak diimpor langsung sebagai
 * dependency lintas layanan (itu yang justru dihindari arsitektur
 * modular-monolith-plus-layanan-terpisah ini); disalin sebagai kontrak
 * HTTP, sama seperti DispatchPort/DispatchStartInput di dispatch-client.ts.
 */
export type NotificationKind =
  | 'DISPATCH_OFFER'
  | 'ORDER_STATUS'
  | 'PAYMENT_RECEIVED'
  | 'PAYOUT_SETTLED'
  | 'CHAT_MESSAGE'
  | 'ANNOUNCEMENT';

export interface NotifyInput {
  dedupeKey: string;
  recipientId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Kegagalan mengirim notifikasi TIDAK BOLEH menggagalkan alur order —
 * order sudah sah berpindah status lewat OrderService; kabar ke
 * pengguna adalah efek samping, bukan prasyarat. Pemanggil (OrderFlow)
 * membungkus setiap send() dengan try/catch yang hanya mencatat galat,
 * bukan melempar ulang. Lihat juga ADR-006 pagar 5: push bukan jaminan
 * pengiriman, jadi bahkan di sisi notification sendiri kegagalan push
 * tidak berarti pesan hilang (kotak masuk tetap tertulis).
 */
export interface NotificationPort {
  send(input: NotifyInput): Promise<void>;
}

/** Klien HTTP ke layanan notification. Pola sama dengan HttpDispatchClient. */
export class HttpNotificationClient implements NotificationPort {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 3_000,
  ) {}

  async send(input: NotifyInput): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/internal/notifications/send`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`notification menjawab ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Dipakai saat NOTIFICATION_URL tidak disetel (dev berdiri sendiri) atau di tes. */
export class StaticNotificationClient implements NotificationPort {
  public readonly calls: NotifyInput[] = [];

  async send(input: NotifyInput): Promise<void> {
    this.calls.push(input);
  }
}
