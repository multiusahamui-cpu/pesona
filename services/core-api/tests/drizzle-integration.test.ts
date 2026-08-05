import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { money } from '@pesona/contracts';
import { OrderService, DrizzleOrderRepo } from '../src/modules/order/index.js';
import { orders } from '../src/modules/order/schema/order.schema.js';
import { DrizzleLedger } from '../src/modules/escrow-settlement/index.js';
import type { Db } from '../src/platform/db.js';

/**
 * Uji integrasi SUNGGUHAN ke Postgres — bukan in-memory.
 *
 * Migration (`pnpm --filter @pesona/core-api db:migrate`) hanya
 * membuktikan DDL-nya benar (tabel bisa dibuat). Berkas ini membuktikan
 * DML-nya benar: DrizzleOrderRepo dan DrizzleLedger benar-benar bisa
 * menulis dan membaca lewat SQL, angka Money tidak rusak melewati kolom
 * bigint, dan invariant rekonsiliasi §7 tetap nol saat dihitung dari
 * baris Postgres sungguhan — bukan dari array in-memory.
 *
 * Dilewati otomatis (bukan gagal) kalau DATABASE_URL tidak disetel,
 * supaya kontributor tanpa Postgres lokal tidak terblokir menjalankan
 * `pnpm test` di seluruh workspace.
 *
 * Memakai database yang SAMA dengan yang di-migrate — tabelnya
 * dibersihkan di beforeEach, bukan database terpisah. Jangan jalankan
 * ini ke database yang berisi data sungguhan.
 */

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const RUN = Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN)('Integrasi Drizzle -> Postgres sungguhan', () => {
  let pool: Pool;
  let db: Db;
  let repo: DrizzleOrderRepo;
  let ledger: DrizzleLedger;
  let service: OrderService;
  const T0 = 1_770_000_000_000;
  const PICKUP = { lat: -6.2, lng: 106.816 };
  const DROPOFF = { lat: -6.21, lng: 106.83 };

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      // Tidak akan pernah sampai sini — describe.skipIf(!RUN) sudah
      // melewati seluruh blok ini kalau DATABASE_URL kosong. Guard ini
      // murni supaya TypeScript tahu tipenya `string`, bukan
      // `string | undefined`, tanpa non-null assertion.
      throw new Error('DATABASE_URL tidak disetel');
    }
    pool = new Pool({ connectionString });
    db = drizzle(pool);
    repo = new DrizzleOrderRepo(db);
    ledger = new DrizzleLedger(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Database dev bersama migration — dibersihkan sebelum tiap tes,
    // bukan tabel/skema terpisah. Aman karena ini database dev khusus
    // pesona, bukan produksi.
    await ledger.clear();
    await db.delete(orders);
    service = new OrderService({ repo, ledger, now: () => T0 });
  });

  it('order round-trip lewat Postgres: create lalu get mengembalikan nilai identik', async () => {
    const created = await service.create({
      id: 'ORD-DRZ-1',
      vertical: 'RIDE',
      consumerId: null,
      grossFare: money(50_000),
      pickup: PICKUP,
      dropoff: DROPOFF,
    });

    // Repo baru, memaksa baca ulang dari Postgres — bukan cache di memori.
    const fetched = await repo.get('ORD-DRZ-1');

    expect(fetched).not.toBeNull();
    expect(fetched).toEqual(created);
    expect(fetched?.amounts.netReceived).toBe(49_650);
    expect(fetched?.pickup).toEqual(PICKUP);
  });

  it('alur bahagia ujung ke ujung lewat Postgres, invariant tetap nol', async () => {
    await service.create({
      id: 'ORD-DRZ-2',
      vertical: 'RIDE',
      consumerId: null,
      grossFare: money(50_000),
      pickup: PICKUP,
      dropoff: DROPOFF,
    });

    await service.markPaid('ORD-DRZ-2');
    await service.markDispatching('ORD-DRZ-2');
    await service.assign('ORD-DRZ-2', 'DRV-9');
    await service.start('ORD-DRZ-2');
    const selesai = await service.complete('ORD-DRZ-2');

    expect(selesai.status).toBe('COMPLETED');

    const rec = await ledger.reconciliation();
    expect(rec.bankBalanceR1).toBe(49_650);
    expect(rec.totalMemberSavings).toBe(42_500);
    expect(rec.totalUnsweptCommission).toBe(7_150);
    expect(rec.totalHeldFunds).toBe(0);
    expect(rec.variance).toBe(0);
    expect(rec.allowSweep).toBe(true);

    expect(await ledger.balance('2-2101', 'DRV-9')).toBe(42_500);
  });

  it('pembatalan berbiaya (JRN-P04) lewat Postgres: subledger tersimpan dan terbaca benar', async () => {
    await service.create({
      id: 'ORD-DRZ-3',
      vertical: 'RIDE',
      consumerId: null,
      grossFare: money(50_000),
      pickup: PICKUP,
      dropoff: DROPOFF,
    });
    await service.markPaid('ORD-DRZ-3');
    await service.markDispatching('ORD-DRZ-3');
    await service.assign('ORD-DRZ-3', 'DRV-9');

    const out = await service.cancel('ORD-DRZ-3', money(10_000));
    expect(out.status).toBe('CANCELLED_FEE');

    // Membuktikan filter account+subledger di DrizzleLedger.balance()
    // benar — bukan cuma filter account saja (yang akan salah jumlah
    // kalau ada mitra lain di akun yang sama).
    expect(await ledger.balance('2-2101', 'DRV-9')).toBe(8_000);
    expect(await ledger.balance('2-2101', 'DRV-LAIN-TIDAK-ADA')).toBe(0);
    expect(await ledger.balance('2-2103', 'ORD-DRZ-3:cancellation')).toBe(2_000);
    expect(await ledger.balance('4-4102')).toBe(0);

    const rec = await ledger.reconciliation();
    expect(rec.variance).toBe(0);
    expect(rec.allowSweep).toBe(true);
  });

  it('dua order bersamaan tidak saling tercampur di buku pembantu Postgres', async () => {
    await service.create({
      id: 'ORD-DRZ-4A',
      vertical: 'RIDE',
      consumerId: null,
      grossFare: money(50_000),
      pickup: PICKUP,
      dropoff: DROPOFF,
    });
    await service.create({
      id: 'ORD-DRZ-4B',
      vertical: 'RIDE',
      consumerId: null,
      grossFare: money(30_000),
      pickup: PICKUP,
      dropoff: DROPOFF,
    });

    await service.markPaid('ORD-DRZ-4A');
    await service.markPaid('ORD-DRZ-4B');

    expect(await ledger.balance('2-2102', 'ORD-DRZ-4A')).toBe(49_650);
    expect(await ledger.balance('2-2102', 'ORD-DRZ-4B')).toBe(29_790);
    expect((await ledger.reconciliation()).totalHeldFunds).toBe(79_440);
    expect((await ledger.reconciliation()).variance).toBe(0);
  });

  it('get() atas id yang tidak ada di Postgres mengembalikan null, bukan melempar', async () => {
    expect(await repo.get('TIDAK-ADA-DI-POSTGRES')).toBeNull();
  });

  it('all() mengembalikan seluruh jurnal yang sudah diposting, termasuk subledger-nya', async () => {
    await service.create({
      id: 'ORD-DRZ-5',
      vertical: 'RIDE',
      consumerId: null,
      grossFare: money(20_000),
      pickup: PICKUP,
      dropoff: DROPOFF,
    });
    await service.markPaid('ORD-DRZ-5');

    const all = await ledger.all();
    const jrn = all.find((e) => e.code === 'JRN-P01' && e.orderId === 'ORD-DRZ-5');

    expect(jrn).toBeDefined();
    expect(jrn?.lines.some((l) => l.account === '2-2102' && l.subledger === 'ORD-DRZ-5')).toBe(true);
  });
});

if (!RUN) {
  console.warn(
    '[drizzle-integration.test.ts] DATABASE_URL tidak disetel — tes integrasi Postgres dilewati.',
  );
}
