import { pgTable, text, bigint, doublePrecision, index } from 'drizzle-orm/pg-core';

/**
 * Tabel `orders` — modul 6.
 *
 * Bentuknya sengaja mengikuti persis `OrderRecord` di
 * ../service/order-service.ts, kolom demi kolom, supaya
 * `DrizzleOrderRepo` (../repo/drizzle-order-repo.ts) bisa memetakan
 * baris <-> objek tanpa transformasi tersembunyi.
 *
 * `amounts` DIPECAH jadi lima kolom bigint — bukan satu kolom jsonb —
 * supaya bisa dijumlah dan diaudit lewat SQL langsung. Konsisten dengan
 * filosofi Money di @pesona/contracts: integer rupiah, tidak pernah
 * tersembunyi di dalam blob yang tidak bisa di-`SUM()`.
 *
 * `status`/`vertical` sengaja `text`, bukan `pgEnum`. Validasinya sudah
 * ditegakkan di application layer (`canTransition()` di
 * @pesona/contracts, dipanggil dari OrderService) — menambah pgEnum di
 * sini hanya menambah friksi migrasi setiap status baru ditambah, tanpa
 * pagar tambahan yang berarti.
 */
export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    vertical: text('vertical').notNull(),
    status: text('status').notNull(),
    consumerId: text('consumer_id'),
    partnerId: text('partner_id'),

    grossFare: bigint('gross_fare', { mode: 'number' }).notNull(),
    mdr: bigint('mdr', { mode: 'number' }).notNull(),
    netReceived: bigint('net_received', { mode: 'number' }).notNull(),
    partnerShare: bigint('partner_share', { mode: 'number' }).notNull(),
    platformCommission: bigint('platform_commission', { mode: 'number' }).notNull(),

    pickupLat: doublePrecision('pickup_lat').notNull(),
    pickupLng: doublePrecision('pickup_lng').notNull(),
    dropoffLat: doublePrecision('dropoff_lat').notNull(),
    dropoffLng: doublePrecision('dropoff_lng').notNull(),

    // Epoch milidetik, bukan Date SQL — cocok persis dengan
    // OrderRecord.createdAt/updatedAt yang berasal dari
    // OrderService.now() (default Date.now()).
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('orders_status_idx').on(table.status),
    index('orders_partner_idx').on(table.partnerId),
    index('orders_created_at_idx').on(table.createdAt),
  ],
);
