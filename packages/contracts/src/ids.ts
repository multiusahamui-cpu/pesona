import { z } from 'zod';

/**
 * ID bertanda (branded) supaya OrderId tidak bisa tertukar dengan MemberId
 * secara diam-diam. Pada sistem yang memindahkan uang, tertukarnya dua ID
 * bertipe string adalah kelas bug yang mahal dan sulit terlihat di review.
 */

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Bukan ULID yang sah');

export const OrderIdSchema = ulid.brand<'OrderId'>();
export const MemberIdSchema = ulid.brand<'MemberId'>();
export const PartnerIdSchema = ulid.brand<'PartnerId'>();
export const PaymentIdSchema = ulid.brand<'PaymentId'>();
export const JournalIdSchema = ulid.brand<'JournalId'>();

export type OrderId = z.infer<typeof OrderIdSchema>;
export type MemberId = z.infer<typeof MemberIdSchema>;
export type PartnerId = z.infer<typeof PartnerIdSchema>;
export type PaymentId = z.infer<typeof PaymentIdSchema>;
export type JournalId = z.infer<typeof JournalIdSchema>;

/**
 * Nomor referensi transaksi dari akuisitor (RRN / transaction id).
 *
 * Inilah SATU-SATUNYA identitas pembayar yang Pesona simpan. QRIS dirancang
 * agar merchant tidak pernah menerima nomor akun pembayar; refund dilakukan
 * dengan "refund by reference" ke akuisitor. Jangan pernah menambahkan
 * kolom nomor dompet konsumen di sini.
 */
export const AcquirerReferenceSchema = z.string().min(1).max(64).brand<'AcquirerRef'>();
export type AcquirerReference = z.infer<typeof AcquirerReferenceSchema>;
