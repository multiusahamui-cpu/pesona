import type { DriverCandidate, LatLng } from './domain/types.js';

/**
 * Port menuju layanan `location`.
 *
 * Dispatch tidak pernah tahu bagaimana kandidat diperoleh — apakah dari
 * HTTP, Redis, atau tabel in-memory. Itu yang membuat mesin dispatch bisa
 * diuji penuh tanpa menyalakan layanan lain.
 */
export interface SupplyPort {
  findCandidates(pickup: LatLng, radiusMeters: number): Promise<DriverCandidate[]>;
}

/** Klien HTTP ke layanan location. */
export class HttpSupplyClient implements SupplyPort {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 3_000,
  ) {}

  async findCandidates(pickup: LatLng, radiusMeters: number): Promise<DriverCandidate[]> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/internal/supply/candidates`);
    url.searchParams.set('lat', String(pickup.lat));
    url.searchParams.set('lng', String(pickup.lng));
    url.searchParams.set('radiusMeters', String(radiusMeters));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`location menjawab ${response.status}`);
      }
      const payload = (await response.json()) as { data?: { candidates?: DriverCandidate[] } };
      return payload.data?.candidates ?? [];
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Implementasi in-memory untuk pengembangan dan tes.
 *
 * Ketiadaan kandidat BUKAN galat — itu keadaan yang sah dan harus
 * berakhir sebagai order tanpa driver, bukan sebagai kegagalan sistem.
 */
export class StaticSupplyClient implements SupplyPort {
  constructor(private candidates: DriverCandidate[] = []) {}

  setCandidates(candidates: DriverCandidate[]): void {
    this.candidates = candidates;
  }

  async findCandidates(): Promise<DriverCandidate[]> {
    return this.candidates;
  }
}
