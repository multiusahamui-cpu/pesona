import type {
  DriverPresence,
  LatLng,
  LocationPolicy,
  PresenceState,
} from './types.js';
import { DEFAULT_LOCATION_POLICY } from './types.js';
import { haversineMeters } from './position.js';

/**
 * Kehadiran driver dan indeks supply.
 *
 * Inilah sumber kandidat yang dikonsumsi mesin Dispatch. Bentuk keluaran
 * `findCandidates` sengaja dibuat cocok dengan `DriverCandidate` milik
 * dispatch — kedua layanan berbicara lewat kontrak, bukan lewat struktur
 * data yang kebetulan mirip.
 */

export function goOnline(
  partnerId: string,
  position: LatLng,
  now: number,
): DriverPresence {
  return {
    partnerId,
    state: 'ONLINE',
    position,
    lastSeenAt: now,
    idleSince: now,
  };
}

export function goOffline(presence: DriverPresence, now: number): DriverPresence {
  return { ...presence, state: 'OFFLINE', lastSeenAt: now };
}

/**
 * Driver menerima order: ONLINE -> BUSY.
 * `idleSince` sengaja tidak diubah di sini — ia baru disetel ulang saat
 * driver kembali menganggur, karena itulah titik awal antrean keadilan.
 */
export function markBusy(presence: DriverPresence, now: number): DriverPresence {
  return { ...presence, state: 'BUSY', lastSeenAt: now };
}

/** Order selesai: BUSY -> ONLINE, dan hitungan menganggur dimulai ulang. */
export function markIdle(presence: DriverPresence, now: number): DriverPresence {
  return { ...presence, state: 'ONLINE', lastSeenAt: now, idleSince: now };
}

/** Perbarui posisi dari ping yang sudah lolos validasi. */
export function applyPosition(
  presence: DriverPresence,
  position: LatLng,
  at: number,
): DriverPresence {
  return { ...presence, position, lastSeenAt: at };
}

/**
 * Driver basi: masih tercatat daring, tetapi sudah lama tidak mengirim ping.
 *
 * Ini masalah "driver hantu". Aplikasi yang mati, baterai habis, atau
 * kehilangan sinyal berhenti mengirim tanpa pernah mengirim status luring.
 * Tanpa ambang ini, mereka terus ditawari order, tidak pernah menjawab,
 * dan menghabiskan gelombang dispatch — konsumen menunggu lama padahal
 * ada driver sungguhan di sekitarnya.
 */
export function isStale(
  presence: DriverPresence,
  now: number,
  policy: LocationPolicy = DEFAULT_LOCATION_POLICY,
): boolean {
  return now - presence.lastSeenAt > policy.presenceStaleAfterMs;
}

/** Apakah driver ini layak ditawari order sekarang. */
export function isDispatchable(
  presence: DriverPresence,
  now: number,
  policy: LocationPolicy = DEFAULT_LOCATION_POLICY,
): boolean {
  return (
    presence.state === 'ONLINE' &&
    presence.position !== null &&
    !isStale(presence, now, policy)
  );
}

/** Bentuk kandidat yang dikonsumsi Dispatch. */
export interface SupplyCandidate {
  partnerId: string;
  position: LatLng;
  online: boolean;
  busy: boolean;
  idleSince: number;
  acceptanceRate: number;
  distanceMeters: number;
}

/**
 * Cari kandidat dalam radius dari titik jemput.
 *
 * Ini implementasi acuan in-memory. Di produksi digantikan adaptor Redis
 * `GEOSEARCH`, tetapi perilakunya harus tetap sama — dan tes di sini yang
 * menjadi acuan kebenaran adaptor itu.
 */
export function findCandidates(
  presences: readonly DriverPresence[],
  pickup: LatLng,
  radiusMeters: number,
  now: number,
  acceptanceRates: Readonly<Record<string, number>> = {},
  policy: LocationPolicy = DEFAULT_LOCATION_POLICY,
): SupplyCandidate[] {
  const out: SupplyCandidate[] = [];

  for (const p of presences) {
    if (!isDispatchable(p, now, policy)) continue;
    if (!p.position) continue;

    const distanceMeters = haversineMeters(pickup, p.position);
    if (distanceMeters > radiusMeters) continue;

    out.push({
      partnerId: p.partnerId,
      position: p.position,
      online: true,
      busy: false,
      idleSince: p.idleSince,
      acceptanceRate: acceptanceRates[p.partnerId] ?? 1,
      distanceMeters,
    });
  }

  out.sort(
    (a, b) => a.distanceMeters - b.distanceMeters || a.partnerId.localeCompare(b.partnerId),
  );
  return out;
}

/**
 * Frekuensi ping yang disarankan bagi driver, dalam detik.
 *
 * Dibedakan menurut keadaan. Menyamakannya menghabiskan baterai driver,
 * dan driver yang baterainya boros akan berhenti online — kerugian yang
 * jauh lebih besar daripada penghematan bandwidth.
 */
export function recommendedPingIntervalSeconds(state: PresenceState): number {
  switch (state) {
    case 'BUSY':
      // Konsumen sedang menonton posisi driver bergerak di peta.
      return 4;
    case 'ONLINE':
      return 20;
    case 'OFFLINE':
      return 0;
  }
}
