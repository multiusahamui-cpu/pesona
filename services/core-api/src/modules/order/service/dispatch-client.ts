/**
 * Port menuju layanan `dispatch`.
 *
 * Sama seperti pola SupplyPort di dispatch: order tidak pernah tahu
 * bagaimana driver dicari — HTTP, in-memory, atau apa pun. Itu yang
 * membuat OrderFlow bisa diuji penuh tanpa menyalakan layanan dispatch.
 */

export interface DispatchStartResult {
  state: 'SEARCHING' | 'ASSIGNED' | 'EXHAUSTED';
  wave: number;
}

export interface DispatchStartInput {
  orderId: string;
  pickup: { lat: number; lng: number };
}

export interface DispatchPort {
  start(input: DispatchStartInput): Promise<DispatchStartResult>;
}

/** Klien HTTP ke layanan dispatch. */
export class HttpDispatchClient implements DispatchPort {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 3_000,
  ) {}

  async start(input: DispatchStartInput): Promise<DispatchStartResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/internal/dispatch/start`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: input.orderId, pickup: input.pickup }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`dispatch menjawab ${response.status}`);
      }
      const payload = (await response.json()) as { data?: DispatchStartResult };
      if (!payload.data) {
        throw new Error('dispatch tidak mengembalikan data');
      }
      return payload.data;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Implementasi in-memory untuk pengembangan dan tes.
 *
 * Default-nya SEARCHING — mengasumsikan kandidat ditemukan. Tes yang
 * ingin membuktikan jalur EXHAUSTED memasang hasil itu lewat konstruktor
 * atau `setResult`.
 */
export class StaticDispatchClient implements DispatchPort {
  public readonly calls: DispatchStartInput[] = [];

  constructor(private result: DispatchStartResult = { state: 'SEARCHING', wave: 1 }) {}

  setResult(result: DispatchStartResult): void {
    this.result = result;
  }

  async start(input: DispatchStartInput): Promise<DispatchStartResult> {
    this.calls.push(input);
    return this.result;
  }
}
