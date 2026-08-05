import { money, add, subtract, applyRate, type Money } from '@pesona/contracts';

/**
 * Buku besar escrow — modul 13.
 *
 * Rujukan: docs/adr/ARSITEKTUR-KEUANGAN-PESONA.md §5, §6, §7.
 *
 * Kunci yang membuat seluruh rekonsiliasi mengunci ada di penempatan MDR:
 * akuisitor menyetorkan SUDAH DIPOTONG. Kalau kewajiban dicatat sebesar
 * nilai kotor, saldo bank akan selamanya kurang dari total kewajiban dan
 * selisihnya tidak akan pernah nol.
 *
 * Jalan keluarnya: catat kewajiban sebesar yang benar-benar diterima, dan
 * biarkan MDR mengurangi komisi Pesona — tidak pernah mengurangi hak mitra.
 */

export type AccountCode =
  | '1-1101' // Bank R1 — Kolekting/Escrow
  | '1-1102' // Bank R2 — Cash Pool
  | '1-1103' // Bank R3 — Operasional
  | '2-2101' // Simpanan Sukarela Anggota
  | '2-2102' // Dana Tertahan — Order Berjalan
  | '2-2103' // Komisi Terutang
  | '2-2104' // Utang Refund
  | '4-4101' // Pendapatan Komisi
  | '4-4102' // Pendapatan Biaya Pembatalan
  | '5-5101'; // Beban MDR

export type JournalCode =
  | 'JRN-P01'
  | 'JRN-P02'
  | 'JRN-P03'
  | 'JRN-P04'
  | 'JRN-P05';

export interface JournalLine {
  account: AccountCode;
  debit: Money;
  credit: Money;
  /** Buku pembantu: nomor order atau ID anggota. */
  subledger?: string;
}

export interface JournalEntry {
  code: JournalCode;
  orderId: string;
  at: number;
  lines: JournalLine[];
}

export class UnbalancedJournalError extends Error {
  constructor(code: JournalCode, debit: Money, credit: Money) {
    super(`Jurnal ${code} tidak seimbang: debit ${debit}, kredit ${credit}`);
    this.name = 'UnbalancedJournalError';
  }
}

const zero = money(0);

function line(
  account: AccountCode,
  debit: number,
  credit: number,
  subledger?: string,
): JournalLine {
  return { account, debit: money(debit), credit: money(credit), subledger };
}

/**
 * Setiap jurnal diperiksa keseimbangannya sebelum dikembalikan.
 *
 * Ini bukan kelengkapan formalitas. Jurnal timpang yang lolos akan muncul
 * berhari-hari kemudian sebagai selisih rekonsiliasi yang sumbernya
 * sudah tidak bisa dilacak.
 */
function balanced(entry: JournalEntry): JournalEntry {
  const debit = add(...entry.lines.map((l) => l.debit));
  const credit = add(...entry.lines.map((l) => l.credit));
  if (debit !== credit) throw new UnbalancedJournalError(entry.code, debit, credit);
  return entry;
}

export interface OrderAmounts {
  grossFare: Money;
  mdr: Money;
  netReceived: Money;
  partnerShare: Money;
  platformCommission: Money;
}

/**
 * Hitung rincian nilai satu order.
 *
 * Pembulatan disebut eksplisit: MDR ke atas agar tidak pernah kurang
 * menalangi biaya akuisitor, bagian mitra ke bawah agar platform tidak
 * pernah mengambil lebih dari haknya.
 */
export function computeAmounts(
  grossFare: Money,
  mdrPerMille: number,
  partnerSharePerMille: number,
): OrderAmounts {
  const mdr = applyRate(grossFare, mdrPerMille, 'ceil');
  const netReceived = subtract(grossFare, mdr);
  const partnerShare = applyRate(grossFare, partnerSharePerMille, 'floor');
  const platformCommission = subtract(netReceived, partnerShare);
  return { grossFare, mdr, netReceived, partnerShare, platformCommission };
}

/** JRN-P01 — konsumen membayar, dana masuk R1 sebagai Dana Tertahan. */
export function journalPaymentReceived(
  orderId: string,
  amounts: OrderAmounts,
  at: number,
): JournalEntry {
  return balanced({
    code: 'JRN-P01',
    orderId,
    at,
    lines: [
      line('1-1101', amounts.netReceived, 0),
      line('2-2102', 0, amounts.netReceived, orderId),
    ],
  });
}

/** JRN-P02 — mitra tap selesai, Dana Tertahan dipecah. */
export function journalOrderCompleted(
  orderId: string,
  partnerId: string,
  amounts: OrderAmounts,
  at: number,
): JournalEntry {
  return balanced({
    code: 'JRN-P02',
    orderId,
    at,
    lines: [
      line('2-2102', amounts.netReceived, 0, orderId),
      line('2-2101', 0, amounts.partnerShare, partnerId),
      line('2-2103', 0, amounts.platformCommission),
    ],
  });
}

/** JRN-P03 — batal sebelum dispatch, refund penuh. */
export function journalFullRefund(
  orderId: string,
  amounts: OrderAmounts,
  at: number,
): JournalEntry {
  return balanced({
    code: 'JRN-P03',
    orderId,
    at,
    lines: [
      line('2-2102', amounts.netReceived, 0, orderId),
      line('2-2104', 0, amounts.netReceived, orderId),
    ],
  });
}

/**
 * JRN-P04 — batal setelah mitra berjalan, refund sebagian.
 *
 * PENTING — bagian Pesona masuk ke 2-2103 Komisi Terutang, BUKAN langsung
 * ke 4-4102 Pendapatan.
 *
 * Alasannya sama dengan JRN-P02: uangnya masih berada di R1 sampai disapu
 * pada akhir hari. Mengakuinya sebagai pendapatan sekarang berarti nilai
 * itu keluar dari sisi liabilitas invariant §7 sementara kasnya belum
 * keluar dari R1 — dan rekonsiliasi langsung timpang sebesar biaya itu.
 *
 * Pendapatan baru diakui di JRN-P06, di buku operasional, setelah kas
 * benar-benar berpindah ke R3.
 *
 * Catatan terpisah: MDR tidak dikembalikan akuisitor saat refund. Selisih
 * itu menjadi beban Pesona dan harus ditalangi dari R2 agar invariant
 * tetap nol — biaya nyata setiap pembatalan, dan harus masuk perhitungan
 * kebijakan pembatalan.
 */
export function journalPartialRefund(
  orderId: string,
  partnerId: string,
  amounts: OrderAmounts,
  cancellationFee: { partner: Money; platform: Money },
  at: number,
): JournalEntry {
  const withheld = add(cancellationFee.partner, cancellationFee.platform);
  const refund = subtract(amounts.netReceived, withheld);
  return balanced({
    code: 'JRN-P04',
    orderId,
    at,
    lines: [
      line('2-2102', amounts.netReceived, 0, orderId),
      line('2-2101', 0, cancellationFee.partner, partnerId),
      line('2-2103', 0, cancellationFee.platform, `${orderId}:cancellation`),
      line('2-2104', 0, refund, orderId),
    ],
  });
}

/** JRN-P05 — penyapuan komisi akhir hari dari R1 ke R3. */
export function journalCommissionSweep(total: Money, at: number): JournalEntry {
  return balanced({
    code: 'JRN-P05',
    orderId: 'EOD',
    at,
    lines: [line('2-2103', total, 0), line('1-1101', 0, total)],
  });
}

/**
 * Kontrak buku besar. `InMemoryLedger` (di bawah) mengimplementasikannya
 * untuk pengembangan dan tes; `DrizzleLedger` (services/core-api/src/
 * modules/escrow-settlement/repo/) mengimplementasikannya untuk produksi.
 *
 * Diketik sebagai interface — bukan kelas konkret — persis pola
 * `OrderRepo`/`InMemoryOrderRepo` di modul order, supaya `OrderService`
 * bisa menerima implementasi apa pun tanpa tahu isinya Postgres atau
 * memori.
 *
 * SELURUH method async, tanpa kecuali — termasuk di `InMemoryLedger`
 * yang sebenarnya tidak butuh itu. Ini sengaja: akses buku besar
 * sungguhan selalu I/O (kueri Postgres), dan kalau interface-nya
 * dibiarkan sinkron-atau-async (union), pemanggil yang lupa `await`
 * pada implementasi Postgres akan lolos dari compiler tapi kehilangan
 * jurnal di produksi — persis kasus yang diperingatkan aturan eslint
 * `no-floating-promises` di packages/config. Lebih baik in-memory ikut
 * repot sedikit (setiap tes memakai `await`) daripada versi produksi
 * diam-diam salah.
 */
export interface Ledger {
  post(entry: JournalEntry): Promise<void>;
  all(): Promise<readonly JournalEntry[]>;
  balance(account: AccountCode, subledger?: string): Promise<Money>;
  reconciliation(): Promise<ReconciliationSnapshot>;
  clear(): Promise<void>;
}

export interface ReconciliationSnapshot {
  bankBalanceR1: Money;
  totalMemberSavings: Money;
  totalHeldFunds: Money;
  totalUnsweptCommission: Money;
  totalPendingRefund: Money;
  variance: Money;
  allowSweep: boolean;
  allowWithdrawal: boolean;
}

/**
 * Buku besar sederhana in-memory.
 *
 * Untuk pengembangan dan tes. Di produksi digantikan `DrizzleLedger`,
 * tetapi invariant-nya harus sama persis — dan tes di modul ini yang
 * menjadi acuannya. Method-nya `async` murni demi kepatuhan tipe
 * terhadap `Ledger`; isinya sendiri tetap sinkron dan cepat.
 */
export class InMemoryLedger implements Ledger {
  private entries: JournalEntry[] = [];

  async post(entry: JournalEntry): Promise<void> {
    this.entries.push(entry);
  }

  async all(): Promise<readonly JournalEntry[]> {
    return this.entries;
  }

  /** Saldo satu akun; positif berarti sesuai sifat normalnya. */
  async balance(account: AccountCode, subledger?: string): Promise<Money> {
    let debit = 0;
    let credit = 0;
    for (const e of this.entries) {
      for (const l of e.lines) {
        if (l.account !== account) continue;
        if (subledger !== undefined && l.subledger !== subledger) continue;
        debit += l.debit;
        credit += l.credit;
      }
    }
    // Akun aset (1-xxxx) bersifat debit; liabilitas dan pendapatan kredit.
    return money(account.startsWith('1-') ? debit - credit : credit - debit);
  }

  /**
   * Invariant §7 — GERBANG, bukan laporan.
   *
   *   Saldo Bank R1 = Σ Simpanan + Σ Dana Tertahan
   *                 + Komisi Terutang + Utang Refund
   *
   * Toleransi nol. Selisih satu rupiah pada sistem finansial bukan
   * pembulatan; ia gejala cacat logika yang akan membesar.
   */
  async reconciliation(): Promise<ReconciliationSnapshot> {
    const bankBalanceR1 = await this.balance('1-1101');
    const totalMemberSavings = await this.balance('2-2101');
    const totalHeldFunds = await this.balance('2-2102');
    const totalUnsweptCommission = await this.balance('2-2103');
    const totalPendingRefund = await this.balance('2-2104');

    const liabilities = add(
      totalMemberSavings,
      totalHeldFunds,
      totalUnsweptCommission,
      totalPendingRefund,
    );
    const variance = subtract(bankBalanceR1, liabilities);
    const balancedNow = variance === zero;

    return {
      bankBalanceR1,
      totalMemberSavings,
      totalHeldFunds,
      totalUnsweptCommission,
      totalPendingRefund,
      variance,
      allowSweep: balancedNow,
      allowWithdrawal: balancedNow,
    };
  }

  async clear(): Promise<void> {
    this.entries = [];
  }
}
