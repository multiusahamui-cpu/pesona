import type {
  LatLng,
  LocationPolicy,
  PingResult,
  PositionPing,
} from './types.js';
import { DEFAULT_LOCATION_POLICY } from './types.js';

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

function isValidCoordinate(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180 &&
    // Titik nol di Teluk Guinea. Untuk operasi di Indonesia ini selalu
    // berarti sensor gagal, bukan posisi sungguhan.
    !(p.lat === 0 && p.lng === 0)
  );
}

/**
 * Validasi satu ping GPS terhadap ping sah sebelumnya.
 *
 * Urutan pemeriksaan disengaja: yang murah dan pasti lebih dulu,
 * pemeriksaan kecepatan terakhir karena ia yang paling mungkin salah
 * tuduh dan konsekuensinya paling berat — hasilnya diteruskan ke
 * Trust & Safety.
 */
export function validatePing(
  ping: PositionPing,
  previous: PositionPing | null,
  now: number,
  policy: LocationPolicy = DEFAULT_LOCATION_POLICY,
): PingResult {
  if (!isValidCoordinate(ping.position)) {
    return { accepted: false, reason: 'INVALID_COORDINATE', suspicious: false };
  }

  if (ping.accuracyMeters > policy.maxAccuracyMeters || ping.accuracyMeters < 0) {
    return { accepted: false, reason: 'ACCURACY_TOO_POOR', suspicious: false };
  }

  if (ping.recordedAt > now + policy.clockSkewToleranceMs) {
    return { accepted: false, reason: 'TIMESTAMP_IN_FUTURE', suspicious: false };
  }

  if (now - ping.recordedAt > policy.maxPingAgeMs) {
    return { accepted: false, reason: 'TIMESTAMP_TOO_OLD', suspicious: false };
  }

  if (!previous) {
    return { accepted: true, ping, derivedSpeedMps: null };
  }

  // Ping dikirim berkelompok dan bisa tiba tidak berurutan setelah sinyal
  // pulih. Yang lebih lama dari ping sah terakhir dibuang — memprosesnya
  // akan membuat jejak mundur ke belakang.
  if (ping.recordedAt < previous.recordedAt) {
    return { accepted: false, reason: 'OUT_OF_ORDER', suspicious: false };
  }

  const elapsedMs = ping.recordedAt - previous.recordedAt;
  const distance = haversineMeters(previous.position, ping.position);

  if (elapsedMs === 0) {
    return distance <= policy.minMovementMeters
      ? { accepted: false, reason: 'DUPLICATE', suspicious: false }
      : { accepted: false, reason: 'IMPLAUSIBLE_SPEED', suspicious: true };
  }

  if (distance <= policy.minMovementMeters) {
    return { accepted: false, reason: 'DUPLICATE', suspicious: false };
  }

  /**
   * Galat akurasi dikurangkan sebelum menghitung kecepatan.
   *
   * Tanpa ini, dua ping berjarak satu detik dengan galat GPS 50 m di
   * masing-masing titik akan tampak sebagai 100 m/detik — dan driver
   * yang sedang berhenti di bawah jembatan layang akan dituduh memalsukan
   * lokasi. Tuduhan palsu pada driver jujur jauh lebih mahal daripada
   * meloloskan sedikit pemalsu.
   */
  const errorMargin = previous.accuracyMeters + ping.accuracyMeters;
  const effectiveDistance = Math.max(0, distance - errorMargin);
  const derivedSpeedMps = effectiveDistance / (elapsedMs / 1000);

  if (derivedSpeedMps > policy.maxPlausibleSpeedMps) {
    return { accepted: false, reason: 'IMPLAUSIBLE_SPEED', suspicious: true };
  }

  return { accepted: true, ping, derivedSpeedMps: Math.round(derivedSpeedMps * 10) / 10 };
}

/**
 * Proses satu kelompok ping berurutan.
 *
 * Dikirim berkelompok, bukan satu per satu, supaya hemat baterai dan
 * tahan terhadap sinyal putus-nyambung — ping yang tertunda tetap
 * terkirim dengan cap waktu aslinya.
 */
export function processBatch(
  pings: readonly PositionPing[],
  previous: PositionPing | null,
  now: number,
  policy: LocationPolicy = DEFAULT_LOCATION_POLICY,
): {
  accepted: PositionPing[];
  rejections: Array<{ index: number; reason: string; suspicious: boolean }>;
  latest: PositionPing | null;
} {
  const sorted = [...pings].sort((a, b) => a.recordedAt - b.recordedAt);
  const accepted: PositionPing[] = [];
  const rejections: Array<{ index: number; reason: string; suspicious: boolean }> = [];
  let last = previous;

  sorted.forEach((ping, index) => {
    const result = validatePing(ping, last, now, policy);
    if (result.accepted) {
      accepted.push(result.ping);
      last = result.ping;
    } else {
      rejections.push({ index, reason: result.reason, suspicious: result.suspicious });
    }
  });

  return { accepted, rejections, latest: last };
}
