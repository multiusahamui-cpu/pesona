import type { DriverPresence, PositionPing } from './domain/types.js';

/**
 * Port penyimpanan presence.
 *
 * Antarmuka ini yang memungkinkan implementasi in-memory sekarang
 * digantikan Redis nanti tanpa menyentuh handler maupun domain. Redis
 * `GEOADD`/`GEOSEARCH` akan mengisi tempat yang sama — tes domain di
 * services/location/tests menjadi acuan kebenaran adaptor itu.
 */
export interface PresenceStore {
  get(partnerId: string): Promise<DriverPresence | null>;
  put(presence: DriverPresence): Promise<void>;
  /** Ping sah terakhir, dipakai validasi lompatan kecepatan. */
  lastPing(partnerId: string): Promise<PositionPing | null>;
  putLastPing(ping: PositionPing): Promise<void>;
  all(): Promise<DriverPresence[]>;
}

/**
 * Implementasi in-memory.
 *
 * Cukup untuk pengembangan dan tes integrasi. TIDAK untuk produksi:
 * satu proses saja, hilang saat restart, dan tidak dibagi antar replika.
 */
export class InMemoryPresenceStore implements PresenceStore {
  private presences = new Map<string, DriverPresence>();
  private pings = new Map<string, PositionPing>();

  async get(partnerId: string): Promise<DriverPresence | null> {
    return this.presences.get(partnerId) ?? null;
  }

  async put(presence: DriverPresence): Promise<void> {
    this.presences.set(presence.partnerId, presence);
  }

  async lastPing(partnerId: string): Promise<PositionPing | null> {
    return this.pings.get(partnerId) ?? null;
  }

  async putLastPing(ping: PositionPing): Promise<void> {
    this.pings.set(ping.partnerId, ping);
  }

  async all(): Promise<DriverPresence[]> {
    return [...this.presences.values()];
  }

  /** Hanya untuk tes. */
  clear(): void {
    this.presences.clear();
    this.pings.clear();
  }
}
