import { z } from 'zod';

/**
 * Uang di Pesona SELALU integer rupiah. Tidak pernah float.
 *
 * Rupiah tidak punya satuan pecahan dalam praktik, jadi tidak ada
 * konversi minor unit. Yang dilarang keras adalah aritmetika desimal:
 * 0.1 + 0.2 !== 0.3 di IEEE-754, dan pada sistem yang memposting jurnal
 * GL selisih sekecil itu akan muncul sebagai rekonsiliasi yang tidak
 * pernah nol.
 *
 * Batas aman JavaScript adalah 2^53-1 ≈ Rp 9 kuadriliun — jauh di atas
 * kebutuhan, tetapi tetap divalidasi supaya kesalahan muncul saat parsing,
 * bukan saat pembukuan.
 */

export const MoneySchema = z
  .number()
  .int('Nominal harus bilangan bulat rupiah, bukan desimal')
  .safe('Nominal melampaui batas aman bilangan bulat')
  .brand<'Money'>();

export type Money = z.infer<typeof MoneySchema>;

/** Nominal yang tidak boleh negatif — tarif, saldo, setoran. */
export const PositiveMoneySchema = MoneySchema.pipe(
  z.number().nonnegative('Nominal tidak boleh negatif'),
);

export function money(value: number): Money {
  return MoneySchema.parse(value);
}

export function add(...values: Money[]): Money {
  return money(values.reduce<number>((sum, v) => sum + v, 0));
}

export function subtract(a: Money, b: Money): Money {
  return money(a - b);
}

/**
 * Perkalian persentase dengan pembulatan eksplisit.
 *
 * Pembulatan WAJIB disebut, tidak boleh implisit. Komisi dibulatkan ke
 * bawah agar platform tidak pernah mengambil lebih dari haknya; MDR
 * dibulatkan ke atas agar tidak pernah kurang menalangi biaya akuisitor.
 * Kalau dibiarkan default, selisih pembulatan akan terakumulasi dan
 * memunculkan break rekonsiliasi yang sulit dilacak.
 */
export function applyRate(
  amount: Money,
  ratePerMille: number,
  rounding: 'floor' | 'ceil',
): Money {
  const raw = (amount * ratePerMille) / 1000;
  return money(rounding === 'floor' ? Math.floor(raw) : Math.ceil(raw));
}

/** Tarif dalam per mille (per seribu) supaya tetap integer. 0,7% = 7. */
export const RatePerMilleSchema = z.number().int().min(0).max(1000);
