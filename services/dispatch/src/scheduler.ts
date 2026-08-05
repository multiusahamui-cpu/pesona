import { randomUUID } from 'node:crypto';
import type { SessionStore } from './routes.js';
import { sweepExpired, type OfferIdGenerator } from './domain/engine.js';

/**
 * Penjadwal kedaluwarsa tawaran — modul 5.
 *
 * `sweepExpired()` di domain/engine.ts murni: sesi masuk, sesi baru
 * keluar, tidak menyentuh jam sistem atau penyimpanan sendiri. Sesuatu
 * HARUS memanggilnya secara berkala, kalau tidak tawaran yang lewat TTL
 * (15 detik, lihat DEFAULT_POLICY) tidak pernah ditandai EXPIRED —
 * gelombang berikutnya tidak pernah dibuka, order menggantung selamanya
 * menunggu driver yang sudah tidak akan menjawab.
 *
 * Berkas ini yang menyediakan "sesuatu" itu: interval yang menyapu
 * SELURUH sesi SEARCHING di SessionStore, bukan endpoint HTTP per-offer
 * (`/internal/dispatch/offers/:offerId/expire` di routes.ts) yang
 * mengharuskan pemanggil sudah tahu offerId mana yang kedaluwarsa lebih
 * dulu — cocok untuk dipanggil klien yang menerima notifikasi push
 * kedaluwarsa, TIDAK cocok sebagai satu-satunya jalan sesi maju sendiri.
 */

export interface SchedulerDeps {
  store: SessionStore;
  now?: () => number;
  newOfferId?: OfferIdGenerator;
  onExhausted?: (orderId: string) => void | Promise<void>;
  /** Seberapa sering menyapu, dalam milidetik. Default 2 detik. */
  intervalMs?: number;
  /** Dipanggil tiap kali satu putaran sapuan gagal, supaya tidak membekukan proses. */
  onSweepError?: (error: unknown) => void;
}

export interface Sweeper {
  stop(): void;
}

/**
 * Mulai penjadwal. Kembalikan `{ stop }` supaya proses bisa berhenti rapi
 * saat SIGTERM/SIGINT (lihat start() di index.ts) — mesin ride-hailing
 * yang setop mendadak di tengah sapuan bisa meninggalkan sesi di keadaan
 * antara, jadi berhenti selalu lewat `stop()`, bukan membunuh proses.
 */
export function startExpirySweeper(deps: SchedulerDeps): Sweeper {
  const now = deps.now ?? (() => Date.now());
  const newOfferId = deps.newOfferId ?? (() => randomUUID());
  const intervalMs = deps.intervalMs ?? 2_000;

  const timer = setInterval(() => {
    sweepOnce(deps.store, now, newOfferId, deps.onExhausted).catch((error: unknown) => {
      deps.onSweepError?.(error);
      console.error('[dispatch] sapuan kedaluwarsa gagal', error);
    });
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}

/**
 * Satu putaran sapuan. Diekspor terpisah supaya bisa dites langsung
 * tanpa menunggu interval sungguhan berjalan.
 */
export async function sweepOnce(
  store: SessionStore,
  now: () => number,
  newOfferId: OfferIdGenerator,
  onExhausted?: (orderId: string) => void | Promise<void>,
): Promise<void> {
  const sessions = await store.all();
  const t = now();

  for (const session of sessions) {
    if (session.state !== 'SEARCHING') continue;

    // Lewati sesi yang tidak punya tawaran PENDING kedaluwarsa — tidak
    // ada gunanya menulis ulang sesi yang tidak berubah tiap 2 detik.
    const hasExpiredPending = session.offers.some(
      (o) => o.state === 'PENDING' && t >= o.expiresAt,
    );
    if (!hasExpiredPending) continue;

    const next = sweepExpired(session, t, newOfferId);
    await store.put(next);

    if (next.state === 'EXHAUSTED') {
      await onExhausted?.(next.orderId);
    }
  }
}
