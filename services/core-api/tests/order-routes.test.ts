import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { InMemoryOrderRepo, StaticDispatchClient, StaticNotificationClient } from '../src/modules/order/index.js';
import { InMemoryLedger } from '../src/modules/escrow-settlement/index.js';

/**
 * Uji HTTP ujung ke ujung: benar-benar menembak Express, bukan memanggil
 * service langsung. Ini yang membuktikan wiring routes.ts + OrderFlow +
 * DispatchPort/NotificationPort sungguhan menyala, bukan hanya benar di
 * level fungsi.
 */

const PICKUP = { lat: -6.2, lng: 106.816 };
const DROPOFF = { lat: -6.21, lng: 106.83 };

function buatApp(dispatch = new StaticDispatchClient()) {
  const repo = new InMemoryOrderRepo();
  const ledger = new InMemoryLedger();
  const notification = new StaticNotificationClient();
  const app = createApp({ repo, ledger, dispatch, notification, now: () => 1_770_000_000_000 });
  return { app, ledger, dispatch, notification };
}

async function buatOrderViaHttp(
  app: ReturnType<typeof buatApp>['app'],
  id: string,
  grossFare = 50_000,
  consumerId: string | null = null,
) {
  return request(app)
    .post('/api/orders')
    .send({ id, vertical: 'RIDE', consumerId, grossFare, pickup: PICKUP, dropoff: DROPOFF })
    .expect(201);
}

describe('Rute HTTP order tersambung ke dispatch', () => {
  it('alur bahagia: bayar -> dispatch mulai -> driver diterima -> selesai', async () => {
    const { app, ledger, dispatch } = buatApp(new StaticDispatchClient({ state: 'SEARCHING', wave: 1 }));

    await buatOrderViaHttp(app, 'ORD-H1');

    const paid = await request(app).post('/internal/payments/ORD-H1/confirmed').expect(200);
    expect(paid.body.data.status).toBe('DISPATCHING');
    expect(dispatch.calls).toHaveLength(1);
    expect(dispatch.calls[0]).toMatchObject({ orderId: 'ORD-H1', pickup: PICKUP });

    const assigned = await request(app)
      .post('/internal/orders/ORD-H1/assign')
      .send({ partnerId: 'DRV-9' })
      .expect(200);
    expect(assigned.body.data.status).toBe('ASSIGNED');
    expect(assigned.body.data.partnerId).toBe('DRV-9');

    await request(app).post('/internal/orders/ORD-H1/start').expect(200);
    const completed = await request(app).post('/internal/orders/ORD-H1/complete').expect(200);
    expect(completed.body.data.status).toBe('COMPLETED');

    expect((await ledger.reconciliation()).variance).toBe(0);

    const fetched = await request(app).get('/api/orders/ORD-H1').expect(200);
    expect(fetched.body.data.status).toBe('COMPLETED');
  });

  it('kandidat habis -> order dibatalkan otomatis dengan refund penuh', async () => {
    const { app, ledger } = buatApp(new StaticDispatchClient({ state: 'EXHAUSTED', wave: 5 }));

    await buatOrderViaHttp(app, 'ORD-H2', 30_000);
    const res = await request(app).post('/internal/payments/ORD-H2/confirmed').expect(200);

    expect(res.body.data.status).toBe('CANCELLED');
    expect((await ledger.reconciliation()).variance).toBe(0);
  });

  it('webhook pembayaran diulang tidak memanggil dispatch dua kali', async () => {
    const { app, dispatch } = buatApp(new StaticDispatchClient({ state: 'SEARCHING', wave: 1 }));

    await buatOrderViaHttp(app, 'ORD-H3', 20_000);
    await request(app).post('/internal/payments/ORD-H3/confirmed').expect(200);
    const retry = await request(app).post('/internal/payments/ORD-H3/confirmed').expect(200);

    expect(retry.body.data.status).toBe('DISPATCHING');
    expect(dispatch.calls).toHaveLength(1);
  });

  it('menolak transisi tidak sah dengan 409, bukan 500', async () => {
    const { app } = buatApp();
    await buatOrderViaHttp(app, 'ORD-H4', 20_000);

    // Belum dibayar — dispatch tidak boleh dilompati.
    const res = await request(app).post('/internal/orders/ORD-H4/start').expect(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('order yang tidak ada mengembalikan 404', async () => {
    const { app } = buatApp();
    const res = await request(app).get('/api/orders/TIDAK-ADA').expect(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('body tidak sah pada pembuatan order mengembalikan 400', async () => {
    const { app } = buatApp();
    const res = await request(app).post('/api/orders').send({ id: 'ORD-H5' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('pembatalan berbiaya lewat HTTP menghasilkan JRN-P04 dan invariant tetap nol', async () => {
    const { app, ledger } = buatApp(new StaticDispatchClient({ state: 'SEARCHING', wave: 1 }));

    await buatOrderViaHttp(app, 'ORD-H6', 50_000);
    await request(app).post('/internal/payments/ORD-H6/confirmed').expect(200);
    await request(app)
      .post('/internal/orders/ORD-H6/assign')
      .send({ partnerId: 'DRV-9' })
      .expect(200);

    const cancelled = await request(app)
      .post('/internal/orders/ORD-H6/cancel')
      .send({ cancellationFee: 10_000 })
      .expect(200);

    expect(cancelled.body.data.status).toBe('CANCELLED_FEE');
    expect(await ledger.balance('2-2101', 'DRV-9')).toBe(8_000);
    expect(await ledger.balance('2-2103', 'ORD-H6:cancellation')).toBe(2_000);
    expect((await ledger.reconciliation()).variance).toBe(0);
  });

  it('alur bahagia lewat HTTP memberi tahu konsumen di tiap tahap: dispatching, ditugaskan, berlangsung, selesai', async () => {
    const { app, notification } = buatApp(new StaticDispatchClient({ state: 'SEARCHING', wave: 1 }));

    await buatOrderViaHttp(app, 'ORD-H7', 50_000, 'CUST-7');
    await request(app).post('/internal/payments/ORD-H7/confirmed').expect(200);
    await request(app)
      .post('/internal/orders/ORD-H7/assign')
      .send({ partnerId: 'DRV-9' })
      .expect(200);
    await request(app).post('/internal/orders/ORD-H7/start').expect(200);
    await request(app).post('/internal/orders/ORD-H7/complete').expect(200);

    const keys = notification.calls.map((c) => c.dedupeKey);
    expect(keys).toEqual([
      'ORD-H7:consumer:dispatching',
      'ORD-H7:consumer:assigned',
      'ORD-H7:consumer:in-progress',
      'ORD-H7:consumer:completed',
      'ORD-H7:partner:completed',
    ]);
    expect(notification.calls.every((c) => c.recipientId === 'CUST-7' || c.recipientId === 'DRV-9')).toBe(
      true,
    );
  });
});
