import { z } from 'zod';
import { defineEndpoint, ok } from './_endpoint.js';
import { OrderIdSchema, PartnerIdSchema } from '../ids.js';
import { MoneySchema } from '../money.js';
import { LatLngSchema } from './geo.js';

/**
 * Langkah 7 — Dispatch (modul 5).
 *
 * Ini modul yang SAMA SEKALI belum ada padanannya di garuda. Di sana
 * `PATCH /api/rides/:id` mengubah status secara manual — tidak ada
 * broadcast, tidak ada terima/tolak, tidak ada timeout, tidak ada
 * penugasan ulang. Tanpa siklus itu, yang ada baru pencatatan perjalanan,
 * bukan ride-hailing.
 */

export const OfferIdSchema = z.string().uuid().brand<'OfferId'>();
export type OfferId = z.infer<typeof OfferIdSchema>;

/**
 * Tawaran yang dikirim ke driver. Punya masa berlaku pendek — kalau
 * lewat, tawaran hangus dan order ditawarkan ke driver berikutnya.
 */
export const DispatchOfferSchema = z.object({
  offerId: OfferIdSchema,
  orderId: OrderIdSchema,
  pickup: LatLngSchema,
  dropoff: LatLngSchema,
  distanceToPickupMeters: z.number().int().nonnegative(),
  tripDistanceMeters: z.number().int().nonnegative(),
  /** Bagian yang diterima driver, bukan tarif kotor. Driver melihat
   *  penghasilannya, bukan angka yang dibayar konsumen. */
  partnerEarning: MoneySchema,
  expiresAt: z.string().datetime(),
});

export type DispatchOffer = z.infer<typeof DispatchOfferSchema>;

export const currentOffer = defineEndpoint({
  method: 'GET',
  path: '/api/dispatch/offers/current',
  summary: 'Tawaran yang sedang berlaku untuk driver ini',
  auth: 'partner',
  idempotent: false,
  monetary: false,
  request: z.object({}),
  response: ok(DispatchOfferSchema.nullable()),
});

/**
 * Terima tawaran. Wajib idempoten: sinyal driver kerap putus-nyambung
 * dan aplikasi akan mengulang. Percobaan kedua dengan kunci yang sama
 * harus mengembalikan hasil yang sama, bukan menugaskan dua kali.
 *
 * Balapan antar-driver diselesaikan di sisi server — hanya satu yang
 * menang, yang lain menerima OFFER_TAKEN.
 */
export const acceptOffer = defineEndpoint({
  method: 'POST',
  path: '/api/dispatch/offers/:offerId/accept',
  summary: 'Driver menerima tawaran',
  auth: 'partner',
  idempotent: true,
  monetary: false,
  request: z.object({
    offerId: OfferIdSchema,
    position: LatLngSchema,
  }),
  response: ok(
    z.object({
      result: z.enum(['ASSIGNED', 'OFFER_TAKEN', 'OFFER_EXPIRED']),
      orderId: OrderIdSchema.nullable(),
    }),
  ),
});

export const rejectOffer = defineEndpoint({
  method: 'POST',
  path: '/api/dispatch/offers/:offerId/reject',
  summary: 'Driver menolak tawaran',
  auth: 'partner',
  idempotent: true,
  monetary: false,
  request: z.object({
    offerId: OfferIdSchema,
    reason: z.enum(['TOO_FAR', 'BREAK', 'WRONG_DIRECTION', 'OTHER']).optional(),
  }),
  response: ok(z.object({ acknowledged: z.boolean() })),
});

/**
 * Dipanggil penjadwal saat tawaran lewat masa berlaku tanpa jawaban.
 * Menugaskan ulang ke kandidat berikutnya, atau membatalkan order bila
 * kandidat habis.
 */
export const expireOffer = defineEndpoint({
  method: 'POST',
  path: '/internal/dispatch/offers/:offerId/expire',
  summary: 'Tandai tawaran hangus dan tugaskan ulang',
  auth: 'internal',
  idempotent: true,
  monetary: false,
  request: z.object({ offerId: OfferIdSchema }),
  response: ok(
    z.object({
      reassignedTo: PartnerIdSchema.nullable(),
      exhausted: z.boolean(),
    }),
  ),
});
