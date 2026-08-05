import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { PresenceStore } from './store.js';
import { processBatch } from './domain/position.js';
import {
  goOnline,
  goOffline,
  applyPosition,
  findCandidates,
  recommendedPingIntervalSeconds,
} from './domain/presence.js';
import { DEFAULT_LOCATION_POLICY, type PositionPing } from './domain/types.js';

/**
 * Handler HTTP layanan location.
 *
 * Handler sengaja tipis: parse, panggil domain, simpan, balas. Seluruh
 * aturan ada di src/domain/ dan sudah teruji di sana. Kalau ada logika
 * yang menyelinap ke berkas ini, itu tanda ia salah tempat.
 */

const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const PresenceBody = z.object({
  online: z.boolean(),
  position: LatLng,
});

const PositionsBody = z.object({
  points: z
    .array(
      z.object({
        position: LatLng,
        recordedAt: z.string().datetime(),
        accuracyMeters: z.number().nonnegative(),
        speedMps: z.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(60),
});

const CandidatesQuery = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusMeters: z.coerce.number().int().positive().max(50_000).default(5_000),
});

/**
 * Identitas mitra diambil dari header yang disetel gateway setelah
 * autentikasi. Layanan ini ClusterIP — tidak pernah diekspos ke internet,
 * jadi tidak memverifikasi token sendiri.
 */
function partnerIdOf(req: Request): string | null {
  const raw = req.header('X-Pesona-Partner-Id');
  return raw && raw.length > 0 ? raw : null;
}

function unauthorized(res: Response): void {
  res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Identitas mitra tidak ada' } });
}

export interface LocationDeps {
  store: PresenceStore;
  now?: () => number;
}

export function registerLocationRoutes(app: Express, deps: LocationDeps): void {
  const now = deps.now ?? (() => Date.now());
  const { store } = deps;

  app.post('/api/driver/presence', (req, res) => {
    void (async () => {
      const partnerId = partnerIdOf(req);
      if (!partnerId) return unauthorized(res);

      const parsed = PresenceBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'Bentuk permintaan tidak sah' },
        });
      }

      const t = now();
      const existing = await store.get(partnerId);

      const presence = parsed.data.online
        ? existing
          ? applyPosition({ ...existing, state: 'ONLINE' }, parsed.data.position, t)
          : goOnline(partnerId, parsed.data.position, t)
        : goOffline(
            existing ?? goOnline(partnerId, parsed.data.position, t),
            t,
          );

      await store.put(presence);

      res.json({
        data: {
          online: presence.state === 'ONLINE',
          since: new Date(presence.lastSeenAt).toISOString(),
          // Frekuensi ping dibedakan menurut keadaan — menyamakannya
          // menghabiskan baterai driver.
          pingIntervalSeconds: recommendedPingIntervalSeconds(presence.state),
        },
      });
    })();
  });

  app.post('/api/driver/positions', (req, res) => {
    void (async () => {
      const partnerId = partnerIdOf(req);
      if (!partnerId) return unauthorized(res);

      const parsed = PositionsBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'Bentuk permintaan tidak sah' },
        });
      }

      const t = now();
      const pings: PositionPing[] = parsed.data.points.map((p) => ({
        partnerId,
        position: p.position,
        recordedAt: Date.parse(p.recordedAt),
        accuracyMeters: p.accuracyMeters,
        speedMps: p.speedMps,
      }));

      const previous = await store.lastPing(partnerId);
      const result = processBatch(pings, previous, t, DEFAULT_LOCATION_POLICY);

      if (result.latest && result.latest !== previous) {
        await store.putLastPing(result.latest);
        const presence = await store.get(partnerId);
        if (presence) {
          await store.put(applyPosition(presence, result.latest.position, t));
        }
      }

      // Penolakan yang mencurigakan diteruskan ke Trust & Safety.
      // Untuk sekarang hanya dicatat; modul 12 belum ada.
      const suspicious = result.rejections.filter((r) => r.suspicious);
      if (suspicious.length > 0) {
        console.warn(
          `[location] ${partnerId}: ${suspicious.length} ping mencurigakan`,
          suspicious.map((s) => s.reason),
        );
      }

      res.json({
        data: {
          accepted: result.accepted.length,
          rejected: result.rejections.length,
          suspicious: suspicious.length,
        },
      });
    })();
  });

  /**
   * Sumber kandidat untuk mesin Dispatch.
   *
   * Internal: dipanggil layanan dispatch, tidak pernah dari internet.
   */
  app.get('/internal/supply/candidates', (req, res) => {
    void (async () => {
      const parsed = CandidatesQuery.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'Parameter pencarian tidak sah' },
        });
      }

      const t = now();
      const all = await store.all();
      const candidates = findCandidates(
        all,
        { lat: parsed.data.lat, lng: parsed.data.lng },
        parsed.data.radiusMeters,
        t,
      );

      res.json({ data: { candidates } });
    })();
  });
}
