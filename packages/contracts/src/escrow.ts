import { z } from 'zod';
import { MoneySchema } from './money.js';
import { OrderIdSchema, MemberIdSchema, AcquirerReferenceSchema } from './ids.js';

/**
 * Kontrak modul 13 — Escrow & Settlement.
 * Rujukan lengkap: docs/adr/ARSITEKTUR-KEUANGAN-PESONA.md
 */

/** Tiga rekening bank terpisah — §3 dokumen keuangan. */
export const AccountBucketSchema = z.enum([
  'R1_ESCROW',      // dana konsumen masuk, dana tertahan, simpanan anggota
  'R2_CASH_POOL',   // modal buffer, tanpa QRIS
  'R3_OPERATIONAL', // kas usaha setelah komisi disapu
]);
export type AccountBucket = z.infer<typeof AccountBucketSchema>;

/** Kode jurnal — sesuai §6 dokumen keuangan. */
export const JournalCodeSchema = z.enum([
  'JRN-P01', // konsumen membayar
  'JRN-P02', // mitra tap selesai, alokasi
  'JRN-P03', // batal sebelum dispatch, refund penuh
  'JRN-P04', // batal setelah mitra jalan, refund sebagian
  'JRN-P05', // penyapuan komisi EOD
  'JRN-P06', // pengakuan pendapatan & PPN di buku operasional
  'JRN-P07', // anggota topup simpanan via VA
  'JRN-P08', // anggota menarik simpanan
  'JRN-P09', // injeksi buffer dari Cash Pool
]);
export type JournalCode = z.infer<typeof JournalCodeSchema>;

/**
 * Invariant rekonsiliasi — §7 dokumen keuangan.
 *
 *   Saldo Bank R1 = Σ Simpanan + Σ Dana Tertahan
 *                 + Komisi Terutang + Utang Refund
 *
 * Ini GERBANG, bukan laporan. Toleransi nol.
 */
export const ReconciliationSnapshotSchema = z.object({
  asOf: z.string().datetime(),
  bankBalanceR1: MoneySchema,
  totalMemberSavings: MoneySchema,
  totalHeldFunds: MoneySchema,
  totalUnsweptCommission: MoneySchema,
  totalPendingRefund: MoneySchema,
  /** bankBalanceR1 dikurangi jumlah keempat komponen di atas. */
  variance: MoneySchema,
});

export type ReconciliationSnapshot = z.infer<typeof ReconciliationSnapshotSchema>;

export function isBalanced(s: ReconciliationSnapshot): boolean {
  return s.variance === 0;
}

/**
 * Gerbang operasional. Selisih berapa pun — bahkan satu rupiah — membekukan
 * penarikan dan menghentikan penyapuan komisi. Pada sistem finansial, selisih
 * satu rupiah bukan pembulatan; ia gejala cacat logika yang akan membesar.
 */
export function settlementGate(s: ReconciliationSnapshot): {
  allowSweep: boolean;
  allowWithdrawal: boolean;
} {
  const ok = isBalanced(s);
  return { allowSweep: ok, allowWithdrawal: ok };
}

/** Dana tertahan per order — buku pembantu akun 2-2102. */
export const HeldFundSchema = z.object({
  orderId: OrderIdSchema,
  acquirerRef: AcquirerReferenceSchema,
  amount: MoneySchema,
  heldAt: z.string().datetime(),
  releasedAt: z.string().datetime().nullable(),
});

/** Perintah refund. Hanya ke sumber asal — §8 dokumen keuangan. */
export const RefundCommandSchema = z.object({
  orderId: OrderIdSchema,
  /** Wajib: refund by reference. Tidak ada tujuan lain yang diizinkan. */
  acquirerRef: AcquirerReferenceSchema,
  amount: MoneySchema,
  reason: z.enum(['CANCELLED_BY_CONSUMER', 'CANCELLED_BY_PARTNER', 'NO_PARTNER_FOUND', 'DISPUTE']),
  /** true = JRN-P04, sebagian ditahan sebagai biaya pembatalan. */
  partial: z.boolean(),
});

export type RefundCommand = z.infer<typeof RefundCommandSchema>;

export const MemberWithdrawalSchema = z.object({
  memberId: MemberIdSchema,
  amount: MoneySchema,
  /** Sudah tervalidasi cocok dengan nama KYC — §11 dokumen keuangan. */
  verifiedBankAccountId: z.string().min(1),
});

/**
 * Antarmuka akuisitor — ADR modul 13.
 *
 * Modul lain TIDAK BOLEH tahu apakah di baliknya payment gateway atau bank
 * langsung. Inilah yang memungkinkan peluncuran dengan PG lalu berpindah ke
 * bank langsung sebagai optimasi biaya, tanpa menyentuh modul Order,
 * Dispatch, atau Identity.
 */
export const AcquirerKindSchema = z.enum(['PG', 'BANK_DIRECT']);

export const DynamicQrisRequestSchema = z.object({
  orderId: OrderIdSchema,
  amount: MoneySchema,
  expiresInSeconds: z.number().int().min(60).max(900),
});

export const DynamicQrisResponseSchema = z.object({
  acquirerRef: AcquirerReferenceSchema,
  qrPayload: z.string(),
  /** Diisi bila akuisitor mendukung pembayaran satu perangkat. */
  deeplinkUrl: z.string().url().nullable(),
  expiresAt: z.string().datetime(),
});
