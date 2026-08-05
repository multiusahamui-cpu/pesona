import { describe, it, expect } from 'vitest';
import {
  startDispatch,
  acceptOffer,
  rejectOffer,
  expireOffer,
  sweepExpired,
  currentOfferFor,
} from '../src/domain/engine.js';
import { rankCandidates, haversineMeters } from '../src/domain/ranking.js';
import { DEFAULT_POLICY, type DriverCandidate, type LatLng } from '../src/domain/types.js';

const T0 = 1_770_000_000_000;
const PICKUP: LatLng = { lat: -6.2, lng: 106.816 };

let counter = 0;
const newOfferId = () => `offer-${++counter}`;

/** Geser sekitar 111 m per 0,001 derajat lintang. */
function driverAt(id: string, metersNorth: number, extra: Partial<DriverCandidate> = {}): DriverCandidate {
  return {
    partnerId: id,
    position: { lat: PICKUP.lat + metersNorth / 111_000, lng: PICKUP.lng },
    online: true,
    busy: false,
    idleSince: T0,
    acceptanceRate: 1,
    ...extra,
  };
}

function start(candidates: DriverCandidate[], now = T0) {
  counter = 0;
  return startDispatch({ orderId: 'ORD-1', pickup: PICKUP, candidates, now, newOfferId });
}

describe('Pemeringkatan kandidat', () => {
  it('menyingkirkan driver luring, sibuk, dan di luar radius', () => {
    const ranked = rankCandidates(
      [
        driverAt('luring', 100, { online: false }),
        driverAt('sibuk', 150, { busy: true }),
        driverAt('jauh', 9000),
        driverAt('layak', 300),
      ],
      PICKUP,
      T0,
      DEFAULT_POLICY,
    );
    expect(ranked.map((r) => r.partnerId)).toEqual(['layak']);
  });

  it('yang lebih dekat lebih diprioritaskan bila kondisi lain sama', () => {
    const ranked = rankCandidates(
      [driverAt('jauh', 2000), driverAt('dekat', 200)],
      PICKUP,
      T0,
      DEFAULT_POLICY,
    );
    expect(ranked[0]?.partnerId).toBe('dekat');
  });

  it('driver yang lama menganggur naik peringkat saat jaraknya berdekatan', () => {
    const ranked = rankCandidates(
      [
        driverAt('baru-nganggur', 500, { idleSince: T0 }),
        driverAt('lama-nganggur', 800, { idleSince: T0 - 15 * 60 * 1000 }),
      ],
      PICKUP,
      T0,
      DEFAULT_POLICY,
    );
    expect(ranked[0]?.partnerId).toBe('lama-nganggur');
  });

  it('keadilan tidak pernah memenangkan driver yang benar-benar jauh', () => {
    const ranked = rankCandidates(
      [
        driverAt('dekat', 200, { idleSince: T0 }),
        driverAt('jauh-tapi-lama', 4500, { idleSince: T0 - 60 * 60 * 1000 }),
      ],
      PICKUP,
      T0,
      DEFAULT_POLICY,
    );
    expect(ranked[0]?.partnerId).toBe('dekat');
  });

  it('urutannya stabil untuk masukan yang sama', () => {
    const input = [driverAt('b', 500), driverAt('a', 500), driverAt('c', 500)];
    const a = rankCandidates(input, PICKUP, T0, DEFAULT_POLICY).map((r) => r.partnerId);
    const b = rankCandidates(input, PICKUP, T0, DEFAULT_POLICY).map((r) => r.partnerId);
    expect(a).toEqual(b);
  });

  it('haversine masuk akal', () => {
    expect(haversineMeters(PICKUP, PICKUP)).toBe(0);
    const d = haversineMeters(PICKUP, { lat: PICKUP.lat + 0.009, lng: PICKUP.lng });
    expect(d).toBeGreaterThan(950);
    expect(d).toBeLessThan(1050);
  });
});

describe('Gelombang tawaran', () => {
  it('gelombang pertama menawarkan sebanyak waveSize', () => {
    const s = start([driverAt('a', 100), driverAt('b', 200), driverAt('c', 300), driverAt('d', 400)]);
    expect(s.offers).toHaveLength(DEFAULT_POLICY.waveSize);
    expect(s.wave).toBe(1);
    expect(s.queue).toHaveLength(1);
  });

  it('tanpa kandidat langsung EXHAUSTED', () => {
    const s = start([]);
    expect(s.state).toBe('EXHAUSTED');
    expect(s.offers).toHaveLength(0);
  });
});

describe('Balapan penerimaan', () => {
  it('hanya satu driver yang menang, sisanya SUPERSEDED', () => {
    const s = start([driverAt('a', 100), driverAt('b', 200), driverAt('c', 300)]);
    const menang = s.offers[0]!;
    const out = acceptOffer(s, menang.offerId, T0 + 1000);

    expect(out.result).toBe('ASSIGNED');
    expect(out.session.state).toBe('ASSIGNED');
    expect(out.session.assignedTo).toBe(menang.partnerId);

    const lain = out.session.offers.filter((o) => o.offerId !== menang.offerId);
    expect(lain.every((o) => o.state === 'SUPERSEDED')).toBe(true);
  });

  it('driver yang kalah mendapat OFFER_TAKEN, bukan galat', () => {
    const s = start([driverAt('a', 100), driverAt('b', 200)]);
    const menang = acceptOffer(s, s.offers[0]!.offerId, T0 + 1000);
    const kalah = acceptOffer(menang.session, s.offers[1]!.offerId, T0 + 1100);
    expect(kalah.result).toBe('OFFER_TAKEN');
  });

  /**
   * Ini yang paling penting. Sinyal driver kerap putus-nyambung dan
   * aplikasi akan mengulang. Menjawab "sudah diambil orang lain" atas
   * tawaran miliknya sendiri akan membuat driver kehilangan order yang
   * sudah sah jadi haknya.
   */
  it('penerimaan yang diulang oleh pemenang tetap ASSIGNED', () => {
    const s = start([driverAt('a', 100), driverAt('b', 200)]);
    const id = s.offers[0]!.offerId;
    const pertama = acceptOffer(s, id, T0 + 1000);
    const kedua = acceptOffer(pertama.session, id, T0 + 3000);
    expect(kedua.result).toBe('ASSIGNED');
    expect(kedua.session.assignedTo).toBe(pertama.session.assignedTo);
  });

  it('tawaran yang sudah lewat waktu tidak bisa diterima', () => {
    const s = start([driverAt('a', 100)]);
    const lewat = T0 + (DEFAULT_POLICY.offerTtlSeconds + 1) * 1000;
    const out = acceptOffer(s, s.offers[0]!.offerId, lewat);
    expect(out.result).toBe('OFFER_EXPIRED');
  });

  it('offerId tak dikenal ditolak', () => {
    const s = start([driverAt('a', 100)]);
    expect(acceptOffer(s, 'tidak-ada', T0).result).toBe('OFFER_UNKNOWN');
  });
});

describe('Penolakan dan kedaluwarsa memicu gelombang berikutnya', () => {
  it('gelombang baru dibuka hanya setelah semua tawaran terjawab', () => {
    const s = start([
      driverAt('a', 100), driverAt('b', 200), driverAt('c', 300),
      driverAt('d', 400), driverAt('e', 500),
    ]);
    let cur = rejectOffer(s, s.offers[0]!.offerId, T0 + 100, newOfferId);
    expect(cur.wave).toBe(1);

    cur = rejectOffer(cur, s.offers[1]!.offerId, T0 + 200, newOfferId);
    expect(cur.wave).toBe(1);

    cur = rejectOffer(cur, s.offers[2]!.offerId, T0 + 300, newOfferId);
    expect(cur.wave).toBe(2);
    expect(cur.offers.filter((o) => o.wave === 2)).toHaveLength(2);
  });

  it('sweepExpired menandai yang lewat waktu lalu memajukan gelombang', () => {
    const s = start([driverAt('a', 100), driverAt('b', 200), driverAt('c', 300), driverAt('d', 400)]);
    const lewat = T0 + (DEFAULT_POLICY.offerTtlSeconds + 1) * 1000;
    const cur = sweepExpired(s, lewat, newOfferId);

    expect(cur.offers.filter((o) => o.wave === 1).every((o) => o.state === 'EXPIRED')).toBe(true);
    expect(cur.wave).toBe(2);
  });

  it('kandidat habis berakhir EXHAUSTED, tidak menggantung di SEARCHING', () => {
    const s = start([driverAt('a', 100), driverAt('b', 200)]);
    let cur = expireOffer(s, s.offers[0]!.offerId, T0 + 100, newOfferId);
    cur = expireOffer(cur, s.offers[1]!.offerId, T0 + 200, newOfferId);
    expect(cur.state).toBe('EXHAUSTED');
    expect(cur.offers.some((o) => o.state === 'PENDING')).toBe(false);
  });

  it('menyerah setelah batas gelombang tercapai', () => {
    const many = Array.from({ length: 30 }, (_, i) => driverAt(`d${i}`, 100 + i * 10));
    let cur = start(many);
    const lewat = (w: number) => T0 + w * (DEFAULT_POLICY.offerTtlSeconds + 1) * 1000;
    for (let w = 1; w <= DEFAULT_POLICY.maxWaves + 1; w++) {
      cur = sweepExpired(cur, lewat(w), newOfferId);
    }
    expect(cur.state).toBe('EXHAUSTED');
    expect(cur.wave).toBeLessThanOrEqual(DEFAULT_POLICY.maxWaves);
  });
});

describe('Tawaran berjalan milik driver', () => {
  it('mengembalikan tawaran yang masih berlaku, dan null setelah lewat waktu', () => {
    const s = start([driverAt('a', 100)]);
    const partner = s.offers[0]!.partnerId;
    expect(currentOfferFor(s, partner, T0 + 1000)).not.toBeNull();

    const lewat = T0 + (DEFAULT_POLICY.offerTtlSeconds + 1) * 1000;
    expect(currentOfferFor(s, partner, lewat)).toBeNull();
  });
});
