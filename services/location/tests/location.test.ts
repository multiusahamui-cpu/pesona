import { describe, it, expect } from 'vitest';
import { validatePing, processBatch, haversineMeters } from '../src/domain/position.js';
import {
  goOnline,
  goOffline,
  markBusy,
  markIdle,
  applyPosition,
  isStale,
  isDispatchable,
  findCandidates,
  recommendedPingIntervalSeconds,
} from '../src/domain/presence.js';
import {
  DEFAULT_LOCATION_POLICY as POL,
  type PositionPing,
  type LatLng,
} from '../src/domain/types.js';

const T0 = 1_770_000_000_000;
const BASE: LatLng = { lat: -6.2, lng: 106.816 };

function at(metersNorth: number): LatLng {
  return { lat: BASE.lat + metersNorth / 111_000, lng: BASE.lng };
}

function ping(over: Partial<PositionPing> = {}): PositionPing {
  return {
    partnerId: 'd1',
    position: BASE,
    recordedAt: T0,
    accuracyMeters: 10,
    ...over,
  };
}

describe('Validasi ping', () => {
  it('menerima ping pertama yang wajar', () => {
    const r = validatePing(ping(), null, T0);
    expect(r.accepted).toBe(true);
  });

  it('menolak koordinat tidak sah dan titik nol', () => {
    expect(validatePing(ping({ position: { lat: 999, lng: 0 } }), null, T0)).toMatchObject({
      accepted: false,
      reason: 'INVALID_COORDINATE',
    });
    // Titik nol di Teluk Guinea — untuk operasi di Indonesia selalu
    // berarti sensor gagal, bukan posisi sungguhan.
    expect(validatePing(ping({ position: { lat: 0, lng: 0 } }), null, T0)).toMatchObject({
      accepted: false,
      reason: 'INVALID_COORDINATE',
    });
  });

  it('menolak akurasi yang terlalu buruk', () => {
    const r = validatePing(ping({ accuracyMeters: POL.maxAccuracyMeters + 1 }), null, T0);
    expect(r).toMatchObject({ accepted: false, reason: 'ACCURACY_TOO_POOR', suspicious: false });
  });

  it('menoleransi jam perangkat yang meleset sedikit, menolak yang jauh ke depan', () => {
    expect(validatePing(ping({ recordedAt: T0 + 10_000 }), null, T0).accepted).toBe(true);
    expect(
      validatePing(ping({ recordedAt: T0 + POL.clockSkewToleranceMs + 5_000 }), null, T0),
    ).toMatchObject({ accepted: false, reason: 'TIMESTAMP_IN_FUTURE' });
  });

  it('menolak ping yang sudah basi', () => {
    const r = validatePing(ping({ recordedAt: T0 - POL.maxPingAgeMs - 1 }), null, T0);
    expect(r).toMatchObject({ accepted: false, reason: 'TIMESTAMP_TOO_OLD' });
  });

  it('membuang ping yang tiba tidak berurutan', () => {
    const prev = ping({ recordedAt: T0 });
    const r = validatePing(ping({ recordedAt: T0 - 5_000 }), prev, T0);
    expect(r).toMatchObject({ accepted: false, reason: 'OUT_OF_ORDER' });
  });

  it('menganggap perpindahan sangat kecil sebagai diam, bukan gerak', () => {
    const prev = ping({ recordedAt: T0 - 5_000 });
    const r = validatePing(ping({ position: at(2), recordedAt: T0 }), prev, T0);
    expect(r).toMatchObject({ accepted: false, reason: 'DUPLICATE', suspicious: false });
  });
});

describe('Deteksi lompatan — pemalsuan lokasi', () => {
  it('menandai perpindahan mustahil sebagai mencurigakan', () => {
    const prev = ping({ position: BASE, recordedAt: T0 - 2_000, accuracyMeters: 5 });
    // 5 km dalam 2 detik = 2500 m/detik.
    const r = validatePing(
      ping({ position: at(5_000), recordedAt: T0, accuracyMeters: 5 }),
      prev,
      T0,
    );
    expect(r).toMatchObject({ accepted: false, reason: 'IMPLAUSIBLE_SPEED', suspicious: true });
  });

  /**
   * Ini tes terpenting di berkas ini. Tanpa pengurangan galat akurasi,
   * driver yang berhenti di bawah jembatan layang — tempat GPS meleset
   * puluhan meter — akan dituduh memalsukan lokasi. Tuduhan palsu pada
   * driver jujur jauh lebih mahal daripada meloloskan sedikit pemalsu.
   */
  it('jitter GPS di titik sinyal buruk TIDAK dituduh memalsukan', () => {
    const prev = ping({ position: BASE, recordedAt: T0 - 1_000, accuracyMeters: 50 });
    const r = validatePing(
      ping({ position: at(90), recordedAt: T0, accuracyMeters: 50 }),
      prev,
      T0,
    );
    expect(r.accepted).toBe(true);
  });

  it('kecepatan sepeda motor di jalan kota diterima', () => {
    const prev = ping({ position: BASE, recordedAt: T0 - 10_000, accuracyMeters: 5 });
    // 250 m dalam 10 detik = 25 m/detik ≈ 90 km/jam.
    const r = validatePing(
      ping({ position: at(250), recordedAt: T0, accuracyMeters: 5 }),
      prev,
      T0,
    );
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.derivedSpeedMps).toBeGreaterThan(20);
  });
});

describe('Kelompok ping', () => {
  it('mengurutkan berdasarkan waktu perekaman, bukan urutan kirim', () => {
    const batch = [
      ping({ position: at(200), recordedAt: T0 - 10_000 }),
      ping({ position: BASE, recordedAt: T0 - 20_000 }),
      ping({ position: at(400), recordedAt: T0 - 5_000 }),
    ];
    const r = processBatch(batch, null, T0);
    expect(r.accepted).toHaveLength(3);
    const waktu = r.accepted.map((p) => p.recordedAt);
    expect(waktu).toEqual([...waktu].sort((a, b) => a - b));
  });

  it('menerima yang sah dan melaporkan yang ditolak beserta alasannya', () => {
    const batch = [
      ping({ position: BASE, recordedAt: T0 - 20_000 }),
      ping({ position: at(300), recordedAt: T0 - 10_000, accuracyMeters: 500 }),
      ping({ position: at(500), recordedAt: T0 - 5_000 }),
    ];
    const r = processBatch(batch, null, T0);
    expect(r.accepted).toHaveLength(2);
    expect(r.rejections[0]?.reason).toBe('ACCURACY_TOO_POOR');
    expect(r.latest?.recordedAt).toBe(T0 - 5_000);
  });
});

describe('Kehadiran driver', () => {
  it('siklus daring, sibuk, menganggur, luring', () => {
    let p = goOnline('d1', BASE, T0);
    expect(p.state).toBe('ONLINE');
    expect(p.idleSince).toBe(T0);

    p = markBusy(p, T0 + 1_000);
    expect(p.state).toBe('BUSY');
    // Hitungan menganggur belum disetel ulang saat sedang mengantar.
    expect(p.idleSince).toBe(T0);

    p = markIdle(p, T0 + 60_000);
    expect(p.state).toBe('ONLINE');
    expect(p.idleSince).toBe(T0 + 60_000);

    p = goOffline(p, T0 + 61_000);
    expect(p.state).toBe('OFFLINE');
  });

  /**
   * Masalah "driver hantu": aplikasi mati atau baterai habis tanpa pernah
   * mengirim status luring. Tanpa ambang basi, mereka terus ditawari
   * order, tidak pernah menjawab, dan menghabiskan gelombang dispatch.
   */
  it('driver yang berhenti mengirim ping dianggap basi dan tidak ditawari', () => {
    const p = goOnline('hantu', BASE, T0);
    const lewat = T0 + POL.presenceStaleAfterMs + 1_000;

    expect(isStale(p, T0 + 10_000)).toBe(false);
    expect(isStale(p, lewat)).toBe(true);
    expect(isDispatchable(p, lewat)).toBe(false);
  });

  it('ping yang sah menyegarkan kembali driver yang hampir basi', () => {
    let p = goOnline('d1', BASE, T0);
    const hampir = T0 + POL.presenceStaleAfterMs - 1_000;
    p = applyPosition(p, at(100), hampir);
    expect(isDispatchable(p, hampir + 5_000)).toBe(true);
  });

  it('driver sibuk tidak ditawari order baru', () => {
    const p = markBusy(goOnline('d1', BASE, T0), T0);
    expect(isDispatchable(p, T0 + 1_000)).toBe(false);
  });
});

describe('Indeks supply — sumber kandidat Dispatch', () => {
  const rates = { dekat: 0.9, jauh: 1 };

  it('hanya mengembalikan driver dalam radius, terurut dari yang terdekat', () => {
    const list = [
      goOnline('jauh', at(2_000), T0),
      goOnline('dekat', at(200), T0),
      goOnline('luar-radius', at(8_000), T0),
    ];
    const c = findCandidates(list, BASE, 5_000, T0, rates);
    expect(c.map((x) => x.partnerId)).toEqual(['dekat', 'jauh']);
    expect(c[0]?.distanceMeters).toBeLessThan(c[1]!.distanceMeters);
  });

  it('menyingkirkan driver basi, sibuk, dan luring', () => {
    const lewat = T0 + POL.presenceStaleAfterMs + 1_000;
    const list = [
      goOnline('basi', at(100), T0),
      markBusy(goOnline('sibuk', at(150), lewat), lewat),
      goOffline(goOnline('luring', at(200), lewat), lewat),
      goOnline('layak', at(250), lewat),
    ];
    const c = findCandidates(list, BASE, 5_000, lewat);
    expect(c.map((x) => x.partnerId)).toEqual(['layak']);
  });

  it('bentuk keluarannya cocok dengan yang dibutuhkan mesin Dispatch', () => {
    const c = findCandidates([goOnline('d1', at(300), T0)], BASE, 5_000, T0, { d1: 0.8 });
    expect(c[0]).toMatchObject({
      partnerId: 'd1',
      online: true,
      busy: false,
      idleSince: T0,
      acceptanceRate: 0.8,
    });
    expect(c[0]?.position).toBeDefined();
  });
});

describe('Frekuensi ping', () => {
  it('lebih rapat saat mengantar, lebih jarang saat menganggur', () => {
    expect(recommendedPingIntervalSeconds('BUSY')).toBeLessThan(
      recommendedPingIntervalSeconds('ONLINE'),
    );
    expect(recommendedPingIntervalSeconds('OFFLINE')).toBe(0);
  });
});

describe('Haversine', () => {
  it('nol untuk titik yang sama, ~1 km untuk 0,009 derajat lintang', () => {
    expect(haversineMeters(BASE, BASE)).toBe(0);
    const d = haversineMeters(BASE, { lat: BASE.lat + 0.009, lng: BASE.lng });
    expect(d).toBeGreaterThan(950);
    expect(d).toBeLessThan(1_050);
  });
});
