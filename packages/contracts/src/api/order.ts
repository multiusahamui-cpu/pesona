import { z } from 'zod';
import { defineEndpoint, ok } from './_endpoint.js';
import { OrderSchema, OrderVerticalSchema } from '../order.js';
import { OrderIdSchema } from '../ids.js';
import { QuoteIdSchema } from './pricing.js';
import { LatLngSchema } from './geo.js';

/** Langkah 4 dan 8 — Order. */

export const createOrder = defineEndpoint({
  method: 'POST',
  path: '/api/orders',
  summary: 'Buat order dari quote yang masih berlaku',
  auth: 'consumer',
  idempotent: true,
  monetary: true,
  request: z.object({
    /** Nominal TIDAK dikirim klien — diambil server dari quote ini. */
    quoteId: QuoteIdSchema,
    vertical: OrderVerticalSchema,
    origin: LatLngSchema,
    destination: LatLngSchema,
    note: z.string().max(500).optional(),
  }),
  response: ok(OrderSchema),
});

export const getOrder = defineEndpoint({
  method: 'GET',
  path: '/api/orders/:orderId',
  summary: 'Ambil satu order',
  auth: 'consumer',
  idempotent: false,
  monetary: false,
  request: z.object({ orderId: OrderIdSchema }),
  response: ok(OrderSchema),
});

/** Driver tiba di titik jemput: ASSIGNED -> IN_PROGRESS. */
export const startOrder = defineEndpoint({
  method: 'POST',
  path: '/api/orders/:orderId/start',
  summary: 'Mitra memulai pengantaran',
  auth: 'partner',
  idempotent: true,
  monetary: false,
  request: z.object({ orderId: OrderIdSchema }),
  response: ok(OrderSchema),
});

/**
 * Tap sampai: IN_PROGRESS -> COMPLETED.
 * Memicu alokasi JRN-P02 di modul 13.
 */
export const completeOrder = defineEndpoint({
  method: 'POST',
  path: '/api/orders/:orderId/complete',
  summary: 'Mitra menyelesaikan order, memicu alokasi dana',
  auth: 'partner',
  idempotent: true,
  monetary: true,
  request: z.object({
    orderId: OrderIdSchema,
    /** Posisi saat tap, disimpan sebagai bukti bila terjadi sengketa. */
    at: LatLngSchema,
  }),
  response: ok(OrderSchema),
});

/**
 * Pembatalan. Server yang menentukan JRN-P03 (refund penuh) atau
 * JRN-P04 (refund sebagian dengan biaya pembatalan) berdasarkan status
 * order saat dibatalkan — bukan klien.
 */
export const cancelOrder = defineEndpoint({
  method: 'POST',
  path: '/api/orders/:orderId/cancel',
  summary: 'Batalkan order',
  auth: 'consumer',
  idempotent: true,
  monetary: true,
  request: z.object({
    orderId: OrderIdSchema,
    reason: z.enum(['CHANGED_MIND', 'TOO_LONG', 'WRONG_ADDRESS', 'PARTNER_ISSUE']),
  }),
  response: ok(
    z.object({
      order: OrderSchema,
      /** Diisi server. Klien wajib menampilkannya di layar pembatalan. */
      refundNotice: z.object({
        refundAmount: z.number().int(),
        cancellationFee: z.number().int(),
        /** Refund QRIS sering 1–7 hari kerja, bukan seketika. */
        estimatedArrival: z.string(),
      }),
    }),
  ),
});
