/**
 * Tipe domain layanan location — modul 4, Supply State.
 *
 * Seperti dispatch, seluruh berkas di src/domain/ MURNI. Waktu masuk
 * sebagai parameter, tidak ada Redis, tidak ada jam sistem.
 *
 * Layanan ini diekstrak dari core-api karena profil tulisnya berbeda
 * total: ping GPS bisa mencapai ratusan ribu tulis per detik, dan
 * datastore-nya Redis, bukan PostgreSQL. Ping driver TIDAK PERNAH masuk
 * PostgreSQL — posisi terkini di Redis, riwayat untuk keperluan sengketa
 * di TimescaleDB.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Satu ping GPS dari aplikasi driver. */
export interface PositionPing {
  partnerId: string;
  position: LatLng;
  /** Cap waktu perekaman di perangkat, milidetik epoch. */
  recordedAt: number;
  /** Radius galat yang dilaporkan perangkat, dalam meter. */
  accuracyMeters: number;
  speedMps?: number;
}

export type PingRejection =
  | 'ACCURACY_TOO_POOR'
  | 'TIMESTAMP_IN_FUTURE'
  | 'TIMESTAMP_TOO_OLD'
  | 'OUT_OF_ORDER'
  | 'DUPLICATE'
  | 'IMPLAUSIBLE_SPEED'
  | 'INVALID_COORDINATE';

export interface PingAccepted {
  accepted: true;
  ping: PositionPing;
  /** Kecepatan terhitung dari posisi sebelumnya, bila ada. */
  derivedSpeedMps: number | null;
}

export interface PingRejected {
  accepted: false;
  reason: PingRejection;
  /**
   * true bila penolakan ini layak dilaporkan ke Trust & Safety.
   *
   * Akurasi buruk dan cap waktu kacau itu lumrah — sinyal lemah, jam
   * perangkat meleset. Lompatan kecepatan mustahil beda: itu penanda
   * pemalsuan lokasi, dan harus diteruskan.
   */
  suspicious: boolean;
}

export type PingResult = PingAccepted | PingRejected;

export type PresenceState = 'OFFLINE' | 'ONLINE' | 'BUSY';

export interface DriverPresence {
  partnerId: string;
  state: PresenceState;
  position: LatLng | null;
  /** Kapan ping terakhir yang sah diterima. */
  lastSeenAt: number;
  /** Sejak kapan menganggur — dipakai mesin peringkat Dispatch. */
  idleSince: number;
}

export interface LocationPolicy {
  /** Ping dengan akurasi lebih buruk dari ini dibuang. */
  maxAccuracyMeters: number;
  /** Ping yang lebih tua dari ini dianggap basi. */
  maxPingAgeMs: number;
  /** Toleransi cap waktu perangkat yang mendahului jam server. */
  clockSkewToleranceMs: number;
  /** Kecepatan di atas ini dianggap mustahil bagi kendaraan darat. */
  maxPlausibleSpeedMps: number;
  /** Tanpa ping selama ini, driver daring dianggap basi dan tidak ditawari. */
  presenceStaleAfterMs: number;
  /** Perpindahan di bawah ini dianggap diam, bukan gerak. */
  minMovementMeters: number;
}

export const DEFAULT_LOCATION_POLICY: LocationPolicy = {
  // 100 m. Lebih buruk dari ini tidak berguna untuk pencocokan.
  maxAccuracyMeters: 100,
  // 2 menit. Ping yang tertahan lebih lama dari ini tidak lagi
  // menggambarkan posisi sekarang.
  maxPingAgeMs: 2 * 60 * 1000,
  // Jam perangkat pengguna kerap meleset beberapa detik.
  clockSkewToleranceMs: 30 * 1000,
  // 40 m/s ≈ 144 km/jam. Di atas itu bukan sepeda motor di jalan kota.
  maxPlausibleSpeedMps: 40,
  // 60 detik. Aplikasi yang mati akan berhenti mengirim; tanpa ambang
  // ini, driver hantu terus ditawari order dan menghabiskan gelombang
  // dispatch tanpa pernah menjawab.
  presenceStaleAfterMs: 60 * 1000,
  minMovementMeters: 5,
};
