import { z } from 'zod';
import { defineEndpoint, ok } from './_endpoint.js';
import { MoneySchema } from '../money.js';
import { OrderVerticalSchema } from '../order.js';
import { LatLngSchema } from './geo.js';

/**
 * Langkah 3 — Pricing. Diport dari server/ride-pricing.ts dan fees.ts.
 *
 * KEAMANAN: tarif TIDAK PERNAH datang dari klien. Server menerbitkan
 * quote bertanda waktu; order dibuat dengan menyebut quoteId, bukan
 * dengan mengirim nominal. Kalau nominal boleh dikirim klien, siapa pun
 * bisa memesan perjalanan seharga satu rupiah.
 */

export const QuoteIdSchema = z.string().uuid().brand<'QuoteId'>();
export type QuoteId = z.infer<typeof QuoteIdSchema>;

export const FareBreakdownSchema = z.object({
  baseFare: MoneySchema,
  distanceFare: MoneySchema,
  timeFare: MoneySchema,
  surgeMultiplierPerMille: z.number().int().min(1000).max(5000),
  platformCommission: MoneySchema,
  partnerShare: MoneySchema,
});

export const quote = defineEndpoint({
  method: 'POST',
  path: '/api/pricing/quote',
  summary: 'Terbitkan penawaran tarif yang mengikat',
  auth: 'consumer',
  idempotent: false,
  monetary: false,
  request: z.object({
    vertical: OrderVerticalSchema,
    origin: LatLngSchema,
    destination: LatLngSchema,
  }),
  response: ok(
    z.object({
      quoteId: QuoteIdSchema,
      grossFare: MoneySchema,
      breakdown: FareBreakdownSchema,
      /** Quote kedaluwarsa supaya tarif tidak bisa disimpan lalu dipakai ulang. */
      expiresAt: z.string().datetime(),
    }),
  ),
});
