import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { SupplyPort } from './supply-client.js';
import type { DispatchSession } from './domain/types.js';
import { DEFAULT_POLICY } from './domain/types.js';
import {
  startDispatch,
  acceptOffer,
  rejectOffer,
  expireOffer,
  currentOfferFor,
} from './domain/engine.js';

/**
 * Handler HTTP mesin dispatch.
 *
 * Sama seperti location: handler tipis, seluruh aturan di src/domain/.
 */

const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const StartBody = z.object({
  orderId: z.string().min(1),
  pickup: LatLng,
  dropoff: LatLng.optional(),
});

const AcceptBody = z.object({ position: LatLng });
const RejectBody = z.object({
  reason: z.enum(['TOO_FAR', 'BREAK', 'WRONG_DIRECTION', 'OTHER']).optional(),
});

export interface SessionStore {
  byOrder(orderId: string): Promise<DispatchSession | null>;
  byOffer(offerId: string): Promise<DispatchSession | null>;
  put(session: DispatchSession): Promise<void>;
  all(): Promise<DispatchSession[]>;
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, DispatchSession>();

  async byOrder(orderId: string): Promise<DispatchSession | null> {
    return this.sessions.get(orderId) ?? null;
  }

  async byOffer(offerId: string): Promise<DispatchSession | null> {
    for (const s of this.sessions.values()) {
      if (s.offers.some((o) => o.offerId === offerId)) return s;
    }
    return null;
  }

  async put(session: DispatchSession): Promise<void> {
    this.sessions.set(session.orderId, session);
  }

  async all(): Promise<DispatchSession[]> {
    return [...this.sessions.values()];
  }

  clear(): void {
    this.sessions.clear();
  }
}

function partnerIdOf(req: Request): string | null {
  const raw = req.header('X-Pesona-Partner-Id');
  return raw && raw.length > 0 ? raw : null;
}

function unauthorized(res: Response): void {
  res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Identitas mitra tidak ada' } });
}

export interface DispatchDeps {
  store: SessionStore;
  supply: SupplyPort;
  now?: () => number;
  newOfferId?: () => string;
  /** Dipanggil saat order mendapat driver atau kehabisan kandidat. */
  onAssigned?: (orderId: string, partnerId: string) => void | Promise<void>;
  onExhausted?: (orderId: string) => void | Promise<void>;
}

export function registerDispatchRoutes(app: Express, deps: DispatchDeps): void {
  const now = deps.now ?? (() => Date.now());
  const newOfferId = deps.newOfferId ?? (() => randomUUID());
  const { store, supply } = deps;

  /** Dipanggil core-api saat order naik ke PAID. */
  app.post('/internal/dispatch/start', (req, res) => {
    void (async () => {
      const parsed = StartBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'Bentuk permintaan tidak sah' },
        });
      }

      // Idempoten: order yang sudah punya sesi tidak dimulai ulang.
      const existing = await store.byOrder(parsed.data.orderId);
      if (existing) {
        return res.json({ data: { state: existing.state, wave: existing.wave } });
      }

      const candidates = await supply.findCandidates(
        parsed.data.pickup,
        DEFAULT_POLICY.maxRadiusMeters,
      );

      const session = startDispatch({
        orderId: parsed.data.orderId,
        pickup: parsed.data.pickup,
        candidates,
        now: now(),
        newOfferId,
      });

      await store.put(session);

      // Kandidat habis sejak awal adalah keadaan yang sah, bukan galat.
      // Order harus dibatalkan, bukan dibiarkan menggantung.
      if (session.state === 'EXHAUSTED') {
        await deps.onExhausted?.(session.orderId);
      }

      res.json({
        data: {
          state: session.state,
          wave: session.wave,
          offered: session.offers.length,
        },
      });
    })();
  });

  app.get('/api/dispatch/offers/current', (req, res) => {
    void (async () => {
      const partnerId = partnerIdOf(req);
      if (!partnerId) return unauthorized(res);

      const t = now();
      for (const session of await store.all()) {
        const offer = currentOfferFor(session, partnerId, t);
        if (offer) {
          return res.json({
            data: {
              offerId: offer.offerId,
              orderId: offer.orderId,
              expiresAt: new Date(offer.expiresAt).toISOString(),
            },
          });
        }
      }
      res.json({ data: null });
    })();
  });

  app.post('/api/dispatch/offers/:offerId/accept', (req, res) => {
    void (async () => {
      const partnerId = partnerIdOf(req);
      if (!partnerId) return unauthorized(res);

      const parsed = AcceptBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'Bentuk permintaan tidak sah' },
        });
      }

      const offerId = req.params.offerId ?? '';
      const session = await store.byOffer(offerId);
      if (!session) {
        return res.json({ data: { result: 'OFFER_EXPIRED', orderId: null } });
      }

      // Tawaran hanya boleh diterima oleh mitra yang ditawari.
      const offer = session.offers.find((o) => o.offerId === offerId);
      if (!offer || offer.partnerId !== partnerId) {
        return res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Tawaran ini bukan milik Anda' },
        });
      }

      const outcome = acceptOffer(session, offerId, now());
      await store.put(outcome.session);

      if (outcome.result === 'ASSIGNED' && outcome.session.assignedTo) {
        await deps.onAssigned?.(outcome.session.orderId, outcome.session.assignedTo);
      }

      res.json({
        data: {
          result: outcome.result,
          orderId: outcome.result === 'ASSIGNED' ? outcome.session.orderId : null,
        },
      });
    })();
  });

  app.post('/api/dispatch/offers/:offerId/reject', (req, res) => {
    void (async () => {
      const partnerId = partnerIdOf(req);
      if (!partnerId) return unauthorized(res);

      const parsed = RejectBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'Bentuk permintaan tidak sah' },
        });
      }

      const offerId = req.params.offerId ?? '';
      const session = await store.byOffer(offerId);
      if (!session) return res.json({ data: { acknowledged: true } });

      const next = rejectOffer(session, offerId, now(), newOfferId);
      await store.put(next);

      if (next.state === 'EXHAUSTED') {
        await deps.onExhausted?.(next.orderId);
      }

      res.json({ data: { acknowledged: true } });
    })();
  });

  /** Dipanggil penjadwal saat tawaran lewat masa berlaku tanpa jawaban. */
  app.post('/internal/dispatch/offers/:offerId/expire', (req, res) => {
    void (async () => {
      const offerId = req.params.offerId ?? '';
      const session = await store.byOffer(offerId);
      if (!session) {
        return res.json({ data: { reassignedTo: null, exhausted: false } });
      }

      const before = session.wave;
      const next = expireOffer(session, offerId, now(), newOfferId);
      await store.put(next);

      const exhausted = next.state === 'EXHAUSTED';
      if (exhausted) await deps.onExhausted?.(next.orderId);

      const reassignedTo =
        next.wave > before
          ? (next.offers.find((o) => o.wave === next.wave)?.partnerId ?? null)
          : null;

      res.json({ data: { reassignedTo, exhausted } });
    })();
  });
}
