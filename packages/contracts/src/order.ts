import { z } from 'zod';
import { MoneySchema } from './money.js';
import { OrderIdSchema, MemberIdSchema, PartnerIdSchema } from './ids.js';

/**
 * State machine order — dipakai lintas vertikal: ride, kirim, belanja.
 *
 * Catatan penting dari ARSITEKTUR-KEUANGAN-PESONA.md §4.1:
 * PEMBAYARAN MENDAHULUI DISPATCH. QRIS dinamis dan deeplink kedaluwarsa
 * dalam 10–15 menit. Kalau pembayaran diletakkan setelah driver ditemukan,
 * QR bisa mati saat menunggu driver menerima order.
 */

export const OrderStatusSchema = z.enum([
  'DRAFT',            // dibuat, tarif dihitung, belum dibayar
  'AWAITING_PAYMENT', // QRIS terbit, menunggu konsumen bayar
  'PAID',             // dana masuk, dibukukan sebagai Dana Tertahan (JRN-P01)
  'DISPATCHING',      // dibroadcast ke mitra
  'ASSIGNED',         // mitra menerima
  'IN_PROGRESS',      // penjemputan / pengantaran berjalan
  'COMPLETED',        // mitra tap selesai — memicu alokasi (JRN-P02)
  'CANCELLED',        // batal sebelum dispatch — refund penuh (JRN-P03)
  'CANCELLED_FEE',    // batal setelah mitra jalan — refund sebagian (JRN-P04)
  'EXPIRED',          // QRIS kedaluwarsa tanpa pembayaran
  'FAILED',           // gagal teknis, perlu penanganan manual
]);

export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/**
 * Transisi yang diizinkan. Apa pun di luar ini ditolak.
 *
 * Status terminal (COMPLETED, CANCELLED, CANCELLED_FEE, EXPIRED) tidak
 * punya transisi keluar — order yang sudah selesai tidak boleh dihidupkan
 * lagi. Perbaikan atas order terminal dilakukan lewat order koreksi
 * tersendiri, bukan dengan mengubah status, supaya jejak audit utuh.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  DRAFT: ['AWAITING_PAYMENT', 'CANCELLED'],
  AWAITING_PAYMENT: ['PAID', 'EXPIRED', 'CANCELLED'],
  PAID: ['DISPATCHING', 'CANCELLED', 'FAILED'],
  DISPATCHING: ['ASSIGNED', 'CANCELLED', 'FAILED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED_FEE', 'FAILED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED_FEE', 'FAILED'],
  COMPLETED: [],
  CANCELLED: [],
  CANCELLED_FEE: [],
  EXPIRED: [],
  FAILED: ['CANCELLED', 'CANCELLED_FEE'],
} as const;

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const OrderVerticalSchema = z.enum(['RIDE', 'DELIVERY', 'MARKETPLACE', 'FOOD']);
export type OrderVertical = z.infer<typeof OrderVerticalSchema>;

/**
 * Rincian nilai order.
 *
 * `grossFare` adalah dasar hak mitra. `netReceived` adalah yang benar-benar
 * mendarat di R1 setelah MDR dipotong akuisitor. Selisihnya mengurangi
 * komisi Pesona, tidak pernah mengurangi hak mitra — lihat JRN-P01/P02.
 */
export const OrderAmountsSchema = z.object({
  grossFare: MoneySchema,
  mdr: MoneySchema,
  netReceived: MoneySchema,
  partnerShare: MoneySchema,
  platformCommission: MoneySchema,
});

export type OrderAmounts = z.infer<typeof OrderAmountsSchema>;

export const OrderSchema = z.object({
  id: OrderIdSchema,
  vertical: OrderVerticalSchema,
  status: OrderStatusSchema,
  consumerId: MemberIdSchema.nullable(), // null = konsumen non-anggota
  partnerId: PartnerIdSchema.nullable(), // null sebelum ASSIGNED
  amounts: OrderAmountsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Order = z.infer<typeof OrderSchema>;
