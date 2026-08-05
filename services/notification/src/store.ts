import type { DeviceRegistration, InboxEntry } from './domain/types.js';

/**
 * Penyimpanan kotak masuk — modul 9.
 *
 * Kotak masuk adalah sumber kebenaran (ADR-006 pagar 5), jadi
 * `append()` HARUS sukses sebelum pengiriman push dicoba sama sekali —
 * lihat urutan pemanggilan di routes.ts, bukan di sini. Store ini tidak
 * tahu apa-apa soal push; ia cuma menyimpan dan membaca.
 */
export interface InboxStore {
  append(recipientId: string, entry: InboxEntry): Promise<void>;
  listForRecipient(recipientId: string): Promise<readonly InboxEntry[]>;
  /** Kunci dedup yang sudah ada di kotak masuk penerima ini. */
  dedupeKeysForRecipient(recipientId: string): Promise<ReadonlySet<string>>;
  /** true kalau entrinya ditemukan dan berhasil ditandai dibaca. */
  markRead(recipientId: string, dedupeKey: string, readAt: number): Promise<boolean>;
}

export class InMemoryInboxStore implements InboxStore {
  private byRecipient = new Map<string, InboxEntry[]>();

  async append(recipientId: string, entry: InboxEntry): Promise<void> {
    const list = this.byRecipient.get(recipientId) ?? [];
    list.push(entry);
    this.byRecipient.set(recipientId, list);
  }

  async listForRecipient(recipientId: string): Promise<readonly InboxEntry[]> {
    return this.byRecipient.get(recipientId) ?? [];
  }

  async dedupeKeysForRecipient(recipientId: string): Promise<ReadonlySet<string>> {
    const list = this.byRecipient.get(recipientId) ?? [];
    return new Set(list.map((e) => e.dedupeKey));
  }

  async markRead(recipientId: string, dedupeKey: string, readAt: number): Promise<boolean> {
    const list = this.byRecipient.get(recipientId);
    const entry = list?.find((e) => e.dedupeKey === dedupeKey);
    if (!entry) return false;
    entry.readAt = readAt;
    return true;
  }

  clear(): void {
    this.byRecipient.clear();
  }
}

/**
 * Registrasi perangkat — dipakai `selectChannel()` di domain/delivery.ts
 * untuk memutuskan kanal push seorang penerima.
 *
 * Satu penerima bisa punya beberapa perangkat (HP lama + baru, tablet).
 * Registrasi ulang `deviceId` yang sama menimpa yang lama — perangkat
 * dianggap satu identitas tetap, bukan tumbuh tak terbatas.
 */
export interface DeviceStore {
  register(device: DeviceRegistration): Promise<void>;
  listForRecipient(recipientId: string): Promise<readonly DeviceRegistration[]>;
}

export class InMemoryDeviceStore implements DeviceStore {
  private byRecipient = new Map<string, Map<string, DeviceRegistration>>();

  async register(device: DeviceRegistration): Promise<void> {
    const devices = this.byRecipient.get(device.recipientId) ?? new Map();
    devices.set(device.deviceId, device);
    this.byRecipient.set(device.recipientId, devices);
  }

  async listForRecipient(recipientId: string): Promise<readonly DeviceRegistration[]> {
    return [...(this.byRecipient.get(recipientId)?.values() ?? [])];
  }

  clear(): void {
    this.byRecipient.clear();
  }
}
