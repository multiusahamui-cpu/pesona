import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemorySessionStore } from '../src/routes.js';
import { startDispatch } from '../src/domain/engine.js';
import type { DriverCandidate } from '../src/domain/types.js';
import { startExpirySweeper, sweepOnce } from '../src/scheduler.js';

/**
 * Scheduler yang menyapu tawaran kedaluwarsa — lihat komentar di
 * src/scheduler.ts untuk kenapa ini perlu ada sama sekali: tanpa ini,
 * order menggantung selamanya menunggu driver yang sudah tidak akan
 * menjawab.
 *
 * Sengaja memakai DEFAULT_POLICY (TTL 15 detik, gelombang 3 driver) di
 * seluruh berkas ini, bukan policy custom — sweepOnce() (lewat
 * sweepExpired() di domain/engine.ts) selalu memakai DEFAULT_POLICY
 * persis seperti routes.ts, karena DispatchSession tidak menyimpan
 * policy mana yang dipakai saat sesi dibuat. Memakai policy custom di
 * sini akan menguji skenario yang tidak pernah terjadi di produksi.
 */

const T0 = 1_770_000_000_000;
const PICKUP = { lat: -6.2, lng: 106.816 };
const TTL_MS = 15_000;

function candidate(id: string): DriverCandidate {
  return {
    partnerId: id,
    position: { lat: -6.2005, lng: 106.8165 },
    online: true,
    busy: false,
    idleSince: T0 - 60_000,
    acceptanceRate: 0.9,
  };
}

let counter = 0;
function newOfferId(): string {
  counter += 1;
  return `offer-${counter}`;
}

describe('sweepOnce', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
    counter = 0;
  });

  it('melewati sesi yang belum punya tawaran kedaluwarsa', async () => {
    const session = startDispatch({
      orderId: 'ORD-1',
      pickup: PICKUP,
      candidates: [candidate('DRV-1')],
      now: T0,
      newOfferId,
    });
    await store.put(session);

    await sweepOnce(store, () => T0 + 1_000, newOfferId);

    const after = await store.byOrder('ORD-1');
    expect(after).toEqual(session);
  });

  it('membuka gelombang berikutnya saat tawaran gelombang berjalan kedaluwarsa', async () => {
    // 5 kandidat, waveSize default 3 -> gelombang 1 menawari 3, sisa 2
    // di antrean. Setelah gelombang 1 kedaluwarsa, sweep harus membuka
    // gelombang 2.
    const session = startDispatch({
      orderId: 'ORD-2',
      pickup: PICKUP,
      candidates: ['A', 'B', 'C', 'D', 'E'].map((s) => candidate(`DRV-${s}`)),
      now: T0,
      newOfferId,
    });
    await store.put(session);
    expect(session.wave).toBe(1);

    await sweepOnce(store, () => T0 + TTL_MS + 1, newOfferId);

    const after = await store.byOrder('ORD-2');
    expect(after?.state).toBe('SEARCHING');
    expect(after?.wave).toBe(2);
    expect(after?.offers.filter((o) => o.wave === 2)).toHaveLength(2);
    // Tawaran gelombang 1 ditandai EXPIRED, bukan dibiarkan PENDING.
    expect(after?.offers.filter((o) => o.wave === 1).every((o) => o.state === 'EXPIRED')).toBe(
      true,
    );
  });

  it('menandai EXHAUSTED dan memanggil onExhausted saat antrean habis', async () => {
    // Cuma 1 kandidat: begitu tawaran gelombang 1 kedaluwarsa, antrean
    // sudah kosong -> EXHAUSTED, tanpa perlu menunggu 5 gelombang.
    const session = startDispatch({
      orderId: 'ORD-3',
      pickup: PICKUP,
      candidates: [candidate('DRV-1')],
      now: T0,
      newOfferId,
    });
    await store.put(session);

    const onExhausted = vi.fn();
    await sweepOnce(store, () => T0 + TTL_MS + 1, newOfferId, onExhausted);

    const after = await store.byOrder('ORD-3');
    expect(after?.state).toBe('EXHAUSTED');
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(onExhausted).toHaveBeenCalledWith('ORD-3');
  });

  it('tidak memanggil onExhausted untuk sesi yang masih SEARCHING setelah sapuan', async () => {
    const session = startDispatch({
      orderId: 'ORD-4',
      pickup: PICKUP,
      candidates: ['A', 'B', 'C', 'D'].map((s) => candidate(`DRV-${s}`)),
      now: T0,
      newOfferId,
    });
    await store.put(session);

    const onExhausted = vi.fn();
    await sweepOnce(store, () => T0 + TTL_MS + 1, newOfferId, onExhausted);

    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('mengabaikan sesi yang sudah ASSIGNED atau EXHAUSTED', async () => {
    const assigned = startDispatch({
      orderId: 'ORD-5',
      pickup: PICKUP,
      candidates: [candidate('DRV-1')],
      now: T0,
      newOfferId,
    });
    await store.put({ ...assigned, state: 'ASSIGNED', assignedTo: 'DRV-1' });

    await sweepOnce(store, () => T0 + TTL_MS + 1, newOfferId);

    const after = await store.byOrder('ORD-5');
    // Statusnya tetap ASSIGNED, bukan diutak-atik jadi EXHAUSTED.
    expect(after?.state).toBe('ASSIGNED');
  });
});

describe('startExpirySweeper', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
    counter = 0;
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('interval sungguhan memicu sapuan dan memanggil onExhausted', async () => {
    const session = startDispatch({
      orderId: 'ORD-X',
      pickup: PICKUP,
      candidates: [candidate('DRV-1')],
      now: T0,
      newOfferId,
    });
    await store.put(session);

    const onExhausted = vi.fn();
    const sweeper = startExpirySweeper({ store, intervalMs: 1_000, onExhausted, newOfferId });

    // Majukan jam lewat tick sungguhan (bukan lompat lewat setSystemTime),
    // supaya interval-nya benar-benar berdetak berkali-kali seperti di
    // produksi — bukan cuma satu lompatan yang tidak jelas apakah dihitung
    // sebagai satu tick oleh fake timer.
    await vi.advanceTimersByTimeAsync(TTL_MS + 1_000);

    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(onExhausted).toHaveBeenCalledWith('ORD-X');
    const after = await store.byOrder('ORD-X');
    expect(after?.state).toBe('EXHAUSTED');

    sweeper.stop();
  });

  it('stop() menghentikan sapuan berikutnya', async () => {
    const session = startDispatch({
      orderId: 'ORD-Y',
      pickup: PICKUP,
      candidates: [candidate('DRV-1')],
      now: T0,
      newOfferId,
    });
    await store.put(session);

    const onExhausted = vi.fn();
    const sweeper = startExpirySweeper({ store, intervalMs: 1_000, onExhausted, newOfferId });
    sweeper.stop();

    await vi.advanceTimersByTimeAsync(TTL_MS + 5_000);

    expect(onExhausted).not.toHaveBeenCalled();
  });
});
