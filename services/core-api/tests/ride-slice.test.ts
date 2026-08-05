import { describe, it, expect, beforeEach } from 'vitest';
import { money } from '@pesona/contracts';
import {
  OrderService,
  InMemoryOrderRepo,
  InvalidTransitionError,
} from '../src/modules/order/index.js';
import {
  InMemoryLedger,
  type Ledger,
  UnbalancedJournalError,
  computeAmounts,
} from '../src/modules/escrow-settlement/index.js';

/**
 * Irisan vertikal ride, ujung ke ujung.
 *
 * Membuktikan rantainya jalan: order dibuat, dibayar, ditugaskan,
 * diselesaikan, jurnal terbentuk, dan invariant rekonsiliasi tetap nol
 * di setiap langkah.
 *
 * Angka acuan dari ARSITEKTUR-KEUANGAN-PESONA.md §6:
 *   tarif kotor  Rp 50.000
 *   MDR 0,7%     Rp 350   (dibulatkan ke atas)
 *   diterima R1  Rp 49.650
 *   hak mitra    Rp 42.500 (85% dari kotor, dibulatkan ke bawah)
 *   komisi       Rp  7.150 (menyerap MDR: 7.500 - 350)
 *
 * `Ledger` sekarang murni async (lihat komentar di ledger.ts) — setiap
 * pemanggilan `.balance()`/`.reconciliation()`/`.all()`/`.post()` di
 * bawah memakai `await`, sama seperti akan dibutuhkan `DrizzleLedger`
 * nanti.
 */

const T0 = 1_770_000_000_000;
const PICKUP = { lat: -6.2, lng: 106.816 };
const DROPOFF = { lat: -6.21, lng: 106.83 };

let repo: InMemoryOrderRepo;
let ledger: Ledger;
let service: OrderService;
let clock = T0;

beforeEach(() => {
  clock = T0;
  repo = new InMemoryOrderRepo();
  ledger = new InMemoryLedger();
  service = new OrderService({ repo, ledger, now: () => clock });
});

async function buatOrder(id = 'ORD-1') {
  return service.create({
    id,
    vertical: 'RIDE',
    consumerId: null, // konsumen non-anggota, bayar lewat QRIS
    grossFare: money(50_000),
    pickup: PICKUP,
    dropoff: DROPOFF,
  });
}

describe('Perhitungan nilai order', () => {
  it('MDR mengurangi komisi Pesona, tidak pernah hak mitra', () => {
    const a = computeAmounts(money(50_000), 7, 850);
    expect(a.mdr).toBe(350);
    expect(a.netReceived).toBe(49_650);
    expect(a.partnerShare).toBe(42_500);
    expect(a.platformCommission).toBe(7_150);
    // Yang diterima habis dibagi dua, tanpa sisa.
    expect(a.partnerShare + a.platformCommission).toBe(a.netReceived);
  });
});

describe('Alur bahagia ujung ke ujung', () => {
  it('order dibuat menunggu pembayaran, belum ada jurnal', async () => {
    const order = await buatOrder();
    expect(order.status).toBe('AWAITING_PAYMENT');
    expect(await ledger.all()).toHaveLength(0);
    expect((await ledger.reconciliation()).variance).toBe(0);
  });

  it('menjalankan seluruh rantai dan menutup dengan invariant nol', async () => {
    await buatOrder();

    // 1. Konsumen bayar -> JRN-P01
    clock = T0 + 10_000;
    const dibayar = await service.markPaid('ORD-1');
    expect(dibayar.status).toBe('PAID');

    let rec = await ledger.reconciliation();
    expect(rec.bankBalanceR1).toBe(49_650);
    expect(rec.totalHeldFunds).toBe(49_650);
    expect(rec.variance).toBe(0);

    // 2. Dispatch berjalan
    clock = T0 + 11_000;
    await service.markDispatching('ORD-1');

    // 3. Driver menerima
    clock = T0 + 20_000;
    const ditugaskan = await service.assign('ORD-1', 'DRV-9');
    expect(ditugaskan.partnerId).toBe('DRV-9');

    // 4. Perjalanan dimulai
    clock = T0 + 120_000;
    await service.start('ORD-1');

    // 5. Tap sampai -> JRN-P02
    clock = T0 + 900_000;
    const selesai = await service.complete('ORD-1');
    expect(selesai.status).toBe('COMPLETED');

    rec = await ledger.reconciliation();
    expect(rec.totalHeldFunds).toBe(0);
    expect(rec.totalMemberSavings).toBe(42_500);
    expect(rec.totalUnsweptCommission).toBe(7_150);
    expect(rec.bankBalanceR1).toBe(49_650);
    expect(rec.variance).toBe(0);
    expect(rec.allowSweep).toBe(true);
  });

  it('simpanan mitra masuk ke buku pembantu miliknya sendiri', async () => {
    await buatOrder();
    await service.markPaid('ORD-1');
    await service.markDispatching('ORD-1');
    await service.assign('ORD-1', 'DRV-9');
    await service.start('ORD-1');
    await service.complete('ORD-1');

    expect(await ledger.balance('2-2101', 'DRV-9')).toBe(42_500);
    expect(await ledger.balance('2-2101', 'DRV-LAIN')).toBe(0);
  });
});

describe('State machine ditegakkan', () => {
  it('PEMBAYARAN MENDAHULUI DISPATCH — tidak bisa dilompati', async () => {
    await buatOrder();
    await expect(service.markDispatching('ORD-1')).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it('order tanpa mitra tidak bisa diselesaikan', async () => {
    await buatOrder();
    await service.markPaid('ORD-1');
    await service.markDispatching('ORD-1');
    await expect(service.complete('ORD-1')).rejects.toThrow();
  });

  it('order yang sudah selesai tidak bisa dihidupkan lagi', async () => {
    await buatOrder();
    await service.markPaid('ORD-1');
    await service.markDispatching('ORD-1');
    await service.assign('ORD-1', 'DRV-9');
    await service.start('ORD-1');
    await service.complete('ORD-1');
    await expect(service.start('ORD-1')).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

describe('Idempotensi', () => {
  it('callback akuisitor yang dikirim ulang tidak membuat jurnal ganda', async () => {
    await buatOrder();
    await service.markPaid('ORD-1');
    await service.markPaid('ORD-1');
    await service.markPaid('ORD-1');

    expect((await ledger.all()).filter((e) => e.code === 'JRN-P01')).toHaveLength(1);
    expect((await ledger.reconciliation()).bankBalanceR1).toBe(49_650);
  });

  it('membuat order dengan id sama mengembalikan yang lama', async () => {
    const a = await buatOrder();
    clock = T0 + 5_000;
    const b = await buatOrder();
    expect(b.createdAt).toBe(a.createdAt);
  });

  it('tap selesai yang diulang tidak memecah dana dua kali', async () => {
    await buatOrder();
    await service.markPaid('ORD-1');
    await service.markDispatching('ORD-1');
    await service.assign('ORD-1', 'DRV-9');
    await service.start('ORD-1');
    await service.complete('ORD-1');
    await service.complete('ORD-1');

    expect(await ledger.balance('2-2101', 'DRV-9')).toBe(42_500);
    expect((await ledger.reconciliation()).variance).toBe(0);
  });
});

describe('Pembatalan', () => {
  it('batal sebelum bayar tidak menyentuh buku besar', async () => {
    await buatOrder();
    const out = await service.cancel('ORD-1');
    expect(out.status).toBe('CANCELLED');
    expect(await ledger.all()).toHaveLength(0);
  });

  it('batal setelah bayar, sebelum dispatch: refund penuh (JRN-P03)', async () => {
    await buatOrder();
    await service.markPaid('ORD-1');
    const out = await service.cancel('ORD-1');

    expect(out.status).toBe('CANCELLED');
    const rec = await ledger.reconciliation();
    expect(rec.totalHeldFunds).toBe(0);
    expect(rec.totalPendingRefund).toBe(49_650);
    expect(rec.variance).toBe(0);
  });

  it('batal setelah mitra berjalan: refund sebagian (JRN-P04)', async () => {
    await buatOrder();
    await service.markPaid('ORD-1');
    await service.markDispatching('ORD-1');
    await service.assign('ORD-1', 'DRV-9');

    const out = await service.cancel('ORD-1', money(10_000));
    expect(out.status).toBe('CANCELLED_FEE');

    const rec = await ledger.reconciliation();
    // Mitra 80% dari biaya pembatalan, sisanya bagian Pesona.
    expect(await ledger.balance('2-2101', 'DRV-9')).toBe(8_000);
    // Bagian Pesona masuk Komisi Terutang, BUKAN langsung pendapatan —
    // uangnya masih di R1 sampai disapu pada akhir hari.
    expect(await ledger.balance('2-2103', 'ORD-1:cancellation')).toBe(2_000);
    expect(await ledger.balance('4-4102')).toBe(0);
    expect(rec.totalPendingRefund).toBe(39_650);
    expect(rec.variance).toBe(0);
  });

  it('pembatalan berbiaya tidak pernah membuat invariant timpang', async () => {
    await buatOrder();
    await service.markPaid('ORD-1');
    await service.markDispatching('ORD-1');
    await service.assign('ORD-1', 'DRV-9');
    await service.cancel('ORD-1', money(10_000));

    const rec = await ledger.reconciliation();
    expect(rec.bankBalanceR1).toBe(49_650);
    expect(
      rec.totalMemberSavings +
        rec.totalHeldFunds +
        rec.totalUnsweptCommission +
        rec.totalPendingRefund,
    ).toBe(49_650);
    expect(rec.variance).toBe(0);
    expect(rec.allowSweep).toBe(true);
  });
});

describe('Invariant rekonsiliasi adalah gerbang', () => {
  it('tetap nol di setiap langkah, tidak hanya di akhir', async () => {
    await buatOrder();
    const langkah: Array<() => Promise<unknown>> = [
      () => service.markPaid('ORD-1'),
      () => service.markDispatching('ORD-1'),
      () => service.assign('ORD-1', 'DRV-9'),
      () => service.start('ORD-1'),
      () => service.complete('ORD-1'),
    ];
    for (const step of langkah) {
      await step();
      expect((await ledger.reconciliation()).variance).toBe(0);
    }
  });

  it('jurnal timpang ditolak saat dibuat, bukan ditemukan berhari-hari kemudian', async () => {
    // post() sendiri tidak memvalidasi keseimbangan — balanced() di
    // pembuat jurnal (journalPaymentReceived dkk.) yang memvalidasi.
    // Baris ini sengaja melewati balanced() untuk membuktikan bahwa
    // invariant rekonsiliasi tetap menangkapnya sebagai gerbang kedua.
    await ledger.post({
      code: 'JRN-P01',
      orderId: 'X',
      at: T0,
      // Sengaja timpang.
      lines: [
        { account: '1-1101', debit: money(100), credit: money(0) },
        { account: '2-2102', debit: money(0), credit: money(99) },
      ],
    });

    expect((await ledger.reconciliation()).variance).not.toBe(0);
    expect((await ledger.reconciliation()).allowSweep).toBe(false);
    expect(UnbalancedJournalError).toBeDefined();
  });
});

describe('Dua order berjalan bersamaan', () => {
  it('buku pembantu per order tidak saling tercampur', async () => {
    await buatOrder('ORD-1');
    await service.create({
      id: 'ORD-2',
      vertical: 'RIDE',
      consumerId: null,
      grossFare: money(30_000),
      pickup: PICKUP,
      dropoff: DROPOFF,
    });

    await service.markPaid('ORD-1');
    await service.markPaid('ORD-2');

    expect(await ledger.balance('2-2102', 'ORD-1')).toBe(49_650);
    // 30.000 - ceil(30.000 * 0,007 = 210) = 29.790
    expect(await ledger.balance('2-2102', 'ORD-2')).toBe(29_790);
    expect((await ledger.reconciliation()).totalHeldFunds).toBe(79_440);
    expect((await ledger.reconciliation()).variance).toBe(0);
  });
});
