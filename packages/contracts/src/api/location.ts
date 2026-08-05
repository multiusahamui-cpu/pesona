import { z } from 'zod';
import { defineEndpoint, ok } from './_endpoint.js';
import { LatLngSchema } from './geo.js';

/**
 * Langkah 6 — Supply State (modul 4, layanan `location`).
 *
 * Frekuensi kirim posisi dibedakan: 3–5 detik saat ada order aktif,
 * 15–30 detik saat idle. Menyamakan keduanya menghabiskan baterai driver,
 * dan driver yang baterainya boros akan berhenti online.
 */

export const setPresence = defineEndpoint({
  method: 'POST',
  path: '/api/driver/presence',
  summary: 'Driver menyalakan atau mematikan status online',
  auth: 'partner',
  idempotent: true,
  monetary: false,
  request: z.object({
    online: z.boolean(),
    position: LatLngSchema,
  }),
  response: ok(z.object({ online: z.boolean(), since: z.string().datetime() })),
});

/**
 * Kiriman posisi dalam kelompok. Dikirim berkelompok, bukan satu per satu,
 * supaya hemat baterai dan tahan terhadap sinyal yang putus-nyambung —
 * posisi yang tertunda tetap terkirim dengan cap waktu aslinya.
 */
export const pushPositions = defineEndpoint({
  method: 'POST',
  path: '/api/driver/positions',
  summary: 'Kirim kelompok posisi GPS',
  auth: 'partner',
  idempotent: true,
  monetary: false,
  request: z.object({
    points: z
      .array(
        z.object({
          position: LatLngSchema,
          recordedAt: z.string().datetime(),
          accuracyMeters: z.number().nonnegative(),
          speedMps: z.number().nonnegative().optional(),
        }),
      )
      .min(1)
      .max(60),
  }),
  response: ok(z.object({ accepted: z.number().int() })),
});
