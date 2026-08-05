/**
 * Tipe domain mesin dispatch.
 *
 * Seluruh berkas di src/domain/ MURNI: tanpa Redis, tanpa HTTP, tanpa jam
 * sistem. Waktu masuk sebagai parameter. Konsekuensinya, seluruh perilaku
 * yang paling sulit — balapan antar-driver, kedaluwarsa, penugasan ulang —
 * bisa diuji sampai tuntas tanpa menyalakan apa pun.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Kandidat driver yang dipasok layanan `location`. */
export interface DriverCandidate {
  partnerId: string;
  position: LatLng;
  online: boolean;
  /** true bila sedang mengerjakan order lain. */
  busy: boolean;
  /** Sejak kapan menganggur, dalam milidetik epoch. */
  idleSince: number;
  /** Rasio penerimaan 0..1, dipakai sebagai penyeimbang kecil. */
  acceptanceRate: number;
}

export interface RankedCandidate {
  partnerId: string;
  distanceMeters: number;
  etaSeconds: number;
  score: number;
}

export type OfferState =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  /** Gelombangnya kalah balapan — driver lain sudah menerima. */
  | 'SUPERSEDED';

export interface Offer {
  offerId: string;
  orderId: string;
  partnerId: string;
  state: OfferState;
  /** Gelombang keberapa. Dipakai untuk telemetri dan batas percobaan. */
  wave: number;
  createdAt: number;
  expiresAt: number;
}

export type SessionState =
  | 'SEARCHING'
  | 'ASSIGNED'
  /** Kandidat habis atau batas gelombang tercapai. */
  | 'EXHAUSTED';

export interface DispatchSession {
  orderId: string;
  pickup: LatLng;
  state: SessionState;
  /** Sisa kandidat yang belum pernah ditawari, sudah terurut. */
  queue: RankedCandidate[];
  offers: Offer[];
  wave: number;
  assignedTo: string | null;
}

export interface DispatchPolicy {
  /** Berapa detik driver punya waktu menjawab satu tawaran. */
  offerTtlSeconds: number;
  /** Berapa driver ditawari serentak dalam satu gelombang. */
  waveSize: number;
  /** Batas gelombang sebelum menyerah. */
  maxWaves: number;
  /** Radius pencarian maksimum dari titik jemput. */
  maxRadiusMeters: number;
  /** Kecepatan rata-rata untuk memperkirakan ETA, meter per detik. */
  averageSpeedMps: number;
}

export const DEFAULT_POLICY: DispatchPolicy = {
  // 15 detik. Lebih pendek terasa memburu dan menaikkan penolakan;
  // lebih panjang membuat konsumen menunggu tanpa kabar.
  offerTtlSeconds: 15,
  // Menawarkan ke tiga driver serentak. Satu per satu terlalu lambat di
  // jam sibuk; terlalu banyak membuat driver sering kalah balapan dan
  // berhenti menanggapi.
  waveSize: 3,
  maxWaves: 5,
  maxRadiusMeters: 5000,
  // ± 21 km/jam, mendekati laju sepeda motor di lalu lintas kota.
  averageSpeedMps: 6,
};
