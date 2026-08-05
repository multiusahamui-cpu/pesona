import { z } from 'zod';
import { MoneySchema, add, type Money } from './money.js';

/**
 * Kontrak layar konfirmasi transaksi — ADR-007 pagar 2, 3, dan 4.
 *
 * Pagar 3: layar konfirmasi WAJIB menampilkan nominal, penerima, dan
 * biaya secara eksplisit sebelum dana bergerak. Dijadikan tipe, bukan
 * pedoman — menghilangkan salah satu field membuat kompilasi gagal,
 * bukan membuat layar tampil kurang lengkap.
 *
 * Ini bukan soal kerapian tampilan. Saat sengketa masuk, layar inilah
 * yang direkonstruksi untuk membuktikan apa yang dilihat pengguna
 * sebelum ia menyetujui.
 */

export const FeeLineSchema = z.object({
  label: z.string().min(1),
  amount: MoneySchema,
});

export const TransactionConfirmationSchema = z.object({
  /** Nominal pokok, sebelum biaya. */
  amount: MoneySchema,
  /** Kepada siapa dana akan bergerak. Wajib, tidak boleh kosong. */
  recipientName: z.string().min(1),
  /** Seluruh biaya dirinci satu per satu. Tidak ada biaya tersembunyi. */
  fees: z.array(FeeLineSchema),
  /** Yang benar-benar dibayar. Diverifikasi = amount + seluruh fees. */
  total: MoneySchema,
  reference: z.string().min(1),
});

export type TransactionConfirmation = z.infer<typeof TransactionConfirmationSchema>;

/**
 * Isyarat yang diizinkan untuk menyetujui transaksi — ADR-007 pagar 2 dan 4.
 *
 * Hanya 'tap'. TIDAK ADA 'swipe'.
 *
 * Sengketa yang paling sulit dibantah adalah "saya tidak merasa menekan
 * apa pun". Geseran mudah terjadi tanpa sengaja — di saku, di dudukan
 * motor, saat menggulir daftar. Ketukan yang disengaja pada tombol
 * berlabel jelas tidak punya kekaburan itu.
 */
export type ConfirmationGesture = 'tap';
export const CONFIRMATION_GESTURE: ConfirmationGesture = 'tap';

export class ConfirmationTotalMismatchError extends Error {
  constructor(expected: Money, got: Money) {
    super(`Total konfirmasi tidak cocok: seharusnya ${expected}, tertulis ${got}`);
    this.name = 'ConfirmationTotalMismatchError';
  }
}

/**
 * Bangun data konfirmasi sekaligus memverifikasi aritmetikanya.
 *
 * Total dihitung ulang di sini, tidak diterima begitu saja. Layar
 * konfirmasi yang menampilkan total tidak sesuai rinciannya adalah
 * cacat yang langsung berubah jadi komplain.
 */
export function buildConfirmation(input: {
  amount: Money;
  recipientName: string;
  fees: Array<{ label: string; amount: Money }>;
  total: Money;
  reference: string;
}): TransactionConfirmation {
  const expected = add(input.amount, ...input.fees.map((f) => f.amount));
  if (expected !== input.total) {
    throw new ConfirmationTotalMismatchError(expected, input.total);
  }
  return TransactionConfirmationSchema.parse(input);
}
