/**
 * Port menuju core-api — melapor hasil dispatch.
 *
 * Sama seperti supply-client.ts: dispatch tidak pernah tahu bagaimana
 * core-api menyimpan atau memproses order, ia hanya melapor lewat port
 * ini. Itu yang membuat mesin dispatch bisa diuji tanpa menyalakan
 * layanan lain.
 */
export interface OrderPort {
  notifyAssigned(orderId: string, partnerId: string): Promise<void>;
  notifyExhausted(orderId: string): Promise<void>;
}

/** Klien HTTP ke core-api. */
export class HttpOrderClient implements OrderPort {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 3_000,
  ) {}

  private async post(path: string, body: unknown): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`core-api menjawab ${response.status} di ${path}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async notifyAssigned(orderId: string, partnerId: string): Promise<void> {
    await this.post(`/internal/orders/${orderId}/assign`, { partnerId });
  }

  async notifyExhausted(orderId: string): Promise<void> {
    await this.post(`/internal/orders/${orderId}/dispatch-exhausted`, {});
  }
}

/**
 * Implementasi in-memory untuk pengembangan dan tes.
 *
 * Mencatat panggilan alih-alih benar-benar mengirim HTTP — dipakai
 * sebagai default saat CORE_API_URL belum disetel, supaya layanan
 * dispatch tetap bisa dijalankan berdiri sendiri.
 */
export class RecordingOrderClient implements OrderPort {
  public readonly assigned: Array<{ orderId: string; partnerId: string }> = [];
  public readonly exhausted: string[] = [];

  async notifyAssigned(orderId: string, partnerId: string): Promise<void> {
    this.assigned.push({ orderId, partnerId });
  }

  async notifyExhausted(orderId: string): Promise<void> {
    this.exhausted.push(orderId);
  }
}
