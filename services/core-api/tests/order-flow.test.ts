import { describe, it, expect, beforeEach } from 'vitest';
import { money } from '@pesona/contracts';
import {
  OrderService,
  InMemoryOrderRepo,
  OrderFlow,
  StaticDispatchClient,
  StaticNotificationClient,
} from '../src/modules/order/index.js';
import { InMemoryLedger, type Ledger } from '../src/modules/escrow-settlement/index.js';

/**
 * OrderFlow menjahit Order Lifecycle ke mesin Dispatch dan ke
 * notification. Di sini diuji murni lewat port palsu
 * (StaticDispatchClient/StaticNotificationClient) — tanpa menyalakan
 * layanan sungguhan. Uji HTTP end-to-end ada di order-routes.test.ts.
 */

const T0 = 1_770_000_000_000;
const PICKUP = { lat: -6.2, lng: 106.816 };
const DROPOFF = { lat: -6.21, lng: 106.83 };

let repo: InMemoryOrderRepo;
let ledger: Ledger;
let orderService: OrderService;
let notification: StaticNotificationClient;
let clock = T0;

beforeEach(() => {
  clock = T0;
  repo = new InMemoryOrderRepo();
  ledger = new InMemoryLedger();
  orderService = new OrderService({ repo, ledger, now: () => clock });
  notification = new StaticNotificationClient();
});

async function buatOrder(id = 'ORD-F1', consumerId: string | null = null) {
  return orderService.create({
    id,
    vertical: 'RIDE',
    consumerId,
    grossFare: money(50_000),
    pickup: PICKUP,
    dropoff: DROPOFF,
  });
}

function buatFlow(dispatch = new StaticDispatchClient({ state: 'SEARCHING', wave: 1 })) {
  return new OrderFlow({ orderService, dispatch, notification });
}

describe('Pembayaran dikonfirmasi -> dispatch dimulai', () => {
  it('order naik ke DISPATCHING dan dispatch dipanggil sekali', async () => {
    await buatOrder();
    const dispatch = new StaticDispatchClient({ state: 'SEARCHING', wave: 1 });
    const flow = buatFlow(dispatch);

    const out = await flow.onPaymentConfirmed('ORD-F1');

    expect(out.status).toBe('DISPATCHING');
    expect(dispatch.calls).toHaveLength(1);
    expect(dispatch.calls[0]).toEqual({ orderId: 'ORD-F1', pickup: PICKUP });
    expect((await ledger.reconciliation()).variance).toBe(0);
  });

  it('kandidat habis -> order dibatalkan otomatis dengan refund penuh (JRN-P03)', async () => {
    await buatOrder();
    const dispatch = new StaticDispatchClient({ state: 'EXHAUSTED', wave: 5 });
    const flow = buatFlow(dispatch);

    const out = await flow.onPaymentConfirmed('ORD-F1');

    expect(out.status).toBe('CANCELLED');
    const rec = await ledger.reconciliation();
    expect(rec.totalPendingRefund).toBe(49_650);
    expect(rec.totalHeldFunds).toBe(0);
    expect(rec.variance).toBe(0);
  });

  it('webhook akuisitor yang diulang setelah dispatch berjalan tidak memanggil dispatch dua kali', async () => {
    await buatOrder();
    const dispatch = new StaticDispatchClient({ state: 'SEARCHING', wave: 1 });
    const flow = buatFlow(dispatch);

    await flow.onPaymentConfirmed('ORD-F1');
    const kedua = await flow.onPaymentConfirmed('ORD-F1');

    expect(kedua.status).toBe('DISPATCHING');
    expect(dispatch.calls).toHaveLength(1);
  });

  it('webhook akuisitor yang diulang setelah driver ditugaskan tetap idempoten', async () => {
    await buatOrder();
    const dispatch = new StaticDispatchClient({ state: 'SEARCHING', wave: 1 });
    const flow = buatFlow(dispatch);

    await flow.onPaymentConfirmed('ORD-F1');
    await flow.onDriverAssigned('ORD-F1', 'DRV-9');

    const retry = await flow.onPaymentConfirmed('ORD-F1');

    expect(retry.status).toBe('ASSIGNED');
    expect(retry.partnerId).toBe('DRV-9');
    expect(dispatch.calls).toHaveLength(1);
  });
});

describe('Callback dari dispatch', () => {
  it('onDriverAssigned menugaskan mitra ke order', async () => {
    await buatOrder();
    const flow = buatFlow();

    await flow.onPaymentConfirmed('ORD-F1');
    const out = await flow.onDriverAssigned('ORD-F1', 'DRV-9');

    expect(out.status).toBe('ASSIGNED');
    expect(out.partnerId).toBe('DRV-9');
  });

  it('onDispatchExhausted membatalkan order dengan refund penuh', async () => {
    await buatOrder();
    const flow = buatFlow();

    await flow.onPaymentConfirmed('ORD-F1');
    const out = await flow.onDispatchExhausted('ORD-F1');

    expect(out.status).toBe('CANCELLED');
    expect((await ledger.reconciliation()).variance).toBe(0);
  });
});

describe('Perjalanan berlangsung dan selesai', () => {
  it('onTripStarted memindahkan order ke IN_PROGRESS dan memberi tahu konsumen', async () => {
    await buatOrder('ORD-F2', 'CUST-1');
    const flow = buatFlow();
    await flow.onPaymentConfirmed('ORD-F2');
    await flow.onDriverAssigned('ORD-F2', 'DRV-9');

    const out = await flow.onTripStarted('ORD-F2');

    expect(out.status).toBe('IN_PROGRESS');
    expect(notification.calls.map((c) => c.dedupeKey)).toContain('ORD-F2:consumer:in-progress');
  });

  it('onTripCompleted menyelesaikan order dan memberi tahu konsumen DAN mitra', async () => {
    await buatOrder('ORD-F3', 'CUST-1');
    const flow = buatFlow();
    await flow.onPaymentConfirmed('ORD-F3');
    await flow.onDriverAssigned('ORD-F3', 'DRV-9');
    await flow.onTripStarted('ORD-F3');

    const out = await flow.onTripCompleted('ORD-F3');

    expect(out.status).toBe('COMPLETED');
    const recipients = notification.calls.map((c) => ({ recipientId: c.recipientId, key: c.dedupeKey }));
    expect(recipients).toContainEqual({ recipientId: 'CUST-1', key: 'ORD-F3:consumer:completed' });
    expect(recipients).toContainEqual({ recipientId: 'DRV-9', key: 'ORD-F3:partner:completed' });
  });
});

describe('Pembatalan lewat OrderFlow', () => {
  it('onOrderCancelled tanpa biaya memberi tahu konsumen dengan pesan refund penuh', async () => {
    await buatOrder('ORD-F4', 'CUST-1');
    const flow = buatFlow();

    const out = await flow.onOrderCancelled('ORD-F4');

    expect(out.status).toBe('CANCELLED');
    const msg = notification.calls.find((c) => c.dedupeKey === 'ORD-F4:consumer:cancelled');
    expect(msg?.body).toContain('dikembalikan penuh');
  });

  it('onOrderCancelled dengan biaya memberi tahu konsumen DAN mitra yang sudah ditugaskan', async () => {
    await buatOrder('ORD-F5', 'CUST-1');
    const flow = buatFlow();
    await flow.onPaymentConfirmed('ORD-F5');
    await flow.onDriverAssigned('ORD-F5', 'DRV-9');

    const out = await flow.onOrderCancelled('ORD-F5', money(10_000));

    expect(out.status).toBe('CANCELLED_FEE');
    const recipients = notification.calls.map((c) => c.recipientId);
    expect(recipients).toContain('CUST-1');
    expect(recipients).toContain('DRV-9');
  });
});

describe('Konsumen tanpa akun (non-anggota)', () => {
  it('tidak memanggil notification sama sekali untuk sisi konsumen bila consumerId null', async () => {
    await buatOrder('ORD-F6', null);
    const flow = buatFlow();

    await flow.onPaymentConfirmed('ORD-F6');

    expect(notification.calls.some((c) => c.dedupeKey.includes(':consumer:'))).toBe(false);
  });
});

describe('Kegagalan notifikasi tidak menggagalkan alur order', () => {
  it('order tetap berpindah status walau notification.send() melempar', async () => {
    await buatOrder('ORD-F7', 'CUST-1');
    const gagal = {
      calls: [] as unknown[],
      send: async () => {
        throw new Error('layanan notification sedang turun');
      },
    };
    const flow = new OrderFlow({
      orderService,
      dispatch: new StaticDispatchClient({ state: 'SEARCHING', wave: 1 }),
      notification: gagal,
    });

    const out = await flow.onPaymentConfirmed('ORD-F7');

    expect(out.status).toBe('DISPATCHING');
  });
});
