import type {
  DriverCandidate,
  DispatchPolicy,
  LatLng,
  RankedCandidate,
} from './types.js';

/**
 * Penyaringan dan pemeringkatan kandidat driver.
 *
 * Kenapa bukan sekadar "yang terdekat menang":
 *
 * Kalau peringkat hanya soal jarak, driver yang kebetulan berada di titik
 * ramai akan terus menerima order sementara yang di pinggiran tidak pernah
 * dapat sama sekali. Driver yang tidak pernah dapat order akan berhenti
 * online — dan kekurangan supply membunuh produk lebih cepat daripada
 * pencocokan yang kurang optimal beberapa ratus meter.
 *
 * Karena itu jarak tetap dominan, tetapi lama menganggur ikut diperhitungkan.
 */

const EARTH_RADIUS_M = 6_371_000;

/** Jarak lingkaran besar. Cukup akurat untuk radius beberapa kilometer. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

/** Batas lama menganggur yang masih menambah prioritas: 10 menit. */
const IDLE_CAP_MS = 10 * 60 * 1000;

/**
 * Skor lebih kecil berarti lebih diprioritaskan.
 *
 *   skor = ETA detik
 *        − bonus keadilan (maks 120 detik, dari lama menganggur)
 *        + penalti keandalan (maks 60 detik, dari rasio penerimaan rendah)
 *
 * Kedua penyesuaian dinyatakan dalam satuan detik supaya besarannya bisa
 * dinilai langsung: bonus keadilan maksimum setara dua menit perjalanan.
 * Itu cukup untuk menggeser urutan antar-driver yang berdekatan, tetapi
 * tidak akan pernah memenangkan driver yang benar-benar jauh.
 */
export function scoreCandidate(
  candidate: DriverCandidate,
  distanceMeters: number,
  now: number,
  policy: DispatchPolicy,
): { etaSeconds: number; score: number } {
  const etaSeconds = Math.round(distanceMeters / policy.averageSpeedMps);

  const idleMs = Math.max(0, now - candidate.idleSince);
  const fairnessBonus = Math.round(120 * Math.min(idleMs / IDLE_CAP_MS, 1));

  const reliabilityPenalty = Math.round(60 * (1 - clamp01(candidate.acceptanceRate)));

  return { etaSeconds, score: etaSeconds - fairnessBonus + reliabilityPenalty };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Saring lalu urutkan kandidat.
 *
 * Penyaringan dilakukan lebih dulu dan bersifat mutlak — driver luring,
 * driver yang sedang mengerjakan order lain, dan yang di luar radius
 * TIDAK PERNAH ditawari, seberapa pun bagus skornya.
 */
export function rankCandidates(
  candidates: readonly DriverCandidate[],
  pickup: LatLng,
  now: number,
  policy: DispatchPolicy,
): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];

  for (const c of candidates) {
    if (!c.online || c.busy) continue;

    const distanceMeters = haversineMeters(pickup, c.position);
    if (distanceMeters > policy.maxRadiusMeters) continue;

    const { etaSeconds, score } = scoreCandidate(c, distanceMeters, now, policy);
    ranked.push({ partnerId: c.partnerId, distanceMeters, etaSeconds, score });
  }

  // Urutan stabil: skor, lalu jarak, lalu partnerId. Tanpa pemecah seri
  // yang pasti, dua panggilan dengan data sama bisa menghasilkan urutan
  // berbeda — dan itu membuat kegagalan sulit direproduksi.
  ranked.sort(
    (a, b) =>
      a.score - b.score ||
      a.distanceMeters - b.distanceMeters ||
      a.partnerId.localeCompare(b.partnerId),
  );

  return ranked;
}
