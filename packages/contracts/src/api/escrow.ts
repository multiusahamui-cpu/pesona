import { z } from 'zod';
import { defineEndpoint, ok } from './_endpoint.js';
import { OrderIdSchema, AcquirerReferenceSchema } from '../ids.js';
import {
  DynamicQrisResponseSchema,
  ReconciliationSnapshotSchema,
} from '../escrow.js';
import { MoneySchema } from '../money.js';

/** Langkah 5, 9, dan 10 — Escrow & Settlement (modul 13). */

/**
 * Terbitkan QRIS dinamis untuk sebuah order.
 * PEMBAYARAN MENDAHULUI DISPATCH — QRIS berlaku 10–15 menit, jadi tidak
 * boleh menunggu driver ditemukan lebih dulu.
 */
export const issuePayment = defineEndpoint({
  method: 'POST',
  path: '/api/orders/:orderId/payment',
  summary: 'Terbitkan QRIS dinamis untuk order',
  auth: 'consumer',
  idempotent: true,
  monetary: true,
  request: z.object({ orderId: OrderIdSchema }),
  response: ok(DynamicQrisResponseSchema),
});

/**
 * Callback akuisitor. Memicu JRN-P01 dan menaikkan order ke PAID.
 *
 * Internal: tidak pernah diekspos ke internet tanpa verifikasi tanda tangan.
 * Idempoten karena akuisitor lazim mengirim ulang callback yang sama.
 */
export const acquirerWebhook = defineEndpoint({
  method: 'POST',
  path: '/internal/acquirer/webhook',
  summary: 'Notifikasi pembayaran dari akuisitor',
  auth: 'internal',
  idempotent: true,
  monetary: true,
  request: z.object({
    acquirerRef: AcquirerReferenceSchema,
    orderId: OrderIdSchema,
    /** Nilai yang benar-benar mendarat di R1, sudah dipotong MDR. */
    netReceived: MoneySchema,
    mdr: MoneySchema,
    paidAt: z.string().datetime(),
    signature: z.string().min(1),
  }),
  response: ok(z.object({ accepted: z.boolean() })),
});

/**
 * Potret rekonsiliasi. Ini GERBANG, bukan laporan — selisih bukan nol
 * membekukan penarikan dan penyapuan komisi.
 */
export const reconciliationSnapshot = defineEndpoint({
  method: 'GET',
  path: '/internal/reconciliation/snapshot',
  summary: 'Potret invariant rekonsiliasi R1',
  auth: 'internal',
  idempotent: false,
  monetary: false,
  request: z.object({}),
  response: ok(
    ReconciliationSnapshotSchema.extend({
      allowSweep: z.boolean(),
      allowWithdrawal: z.boolean(),
    }),
  ),
});
