import { z } from 'zod';
import { defineEndpoint, ok } from './_endpoint.js';

/** Langkah 2 — Geo. Dicabut dari blok /api/maps/* di ride-hailing.ts garuda. */

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type LatLng = z.infer<typeof LatLngSchema>;

export const routePreview = defineEndpoint({
  method: 'POST',
  path: '/api/geo/route',
  summary: 'Hitung rute jalan antara dua titik',
  auth: 'consumer',
  idempotent: false,
  monetary: false,
  request: z.object({
    origin: LatLngSchema,
    destination: LatLngSchema,
  }),
  response: ok(
    z.object({
      distanceMeters: z.number().int().nonnegative(),
      durationSeconds: z.number().int().nonnegative(),
      /** Polyline terenkode untuk digambar di peta. */
      polyline: z.string(),
    }),
  ),
});
