import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/index.js';
import { InMemoryInboxStore, InMemoryDeviceStore } from '../src/store.js';
import { NoopPushAdapter } from '../src/push-client.js';

/**
 * Uji HTTP ujung ke ujung: menembak Express sungguhan, bukan memanggil
 * domain/store langsung. Ini yang membuktikan urutan "kotak masuk dulu,
 * baru push" (ADR-006 pagar 5) benar-benar ditegakkan di jalur nyata,
 * bukan cuma benar di atas kertas.
 */

const T0 = 1_770_000_000_000;

function buatApp() {
  const inbox = new InMemoryInboxStore();
  const devices = new InMemoryDeviceStore();
  const push = new NoopPushAdapter();
  const app = createApp({ inbox, devices, push, now: () => T0 });
  return { app, inbox, devices, push };
}

describe('POST /internal/notifications/send', () => {
  it('menulis ke kotak masuk walau penerima belum punya perangkat terdaftar', async () => {
    const { app, inbox } = buatApp();

    const res = await request(app)
      .post('/internal/notifications/send')
      .send({
        dedupeKey: 'ORD-1:status:DISPATCHING',
        recipientId: 'CUST-1',
        kind: 'ORDER_STATUS',
        title: 'Pesanan diproses',
        body: 'Sedang mencari driver',
      })
      .expect(200);

    expect(res.body.data).toEqual({ messageWritten: true, deliveries: [] });
    const list = await inbox.listForRecipient('CUST-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.readAt).toBeNull();
  });

  it('kunci dedup yang sama dikirim dua kali tidak menulis ulang atau mendorong ulang', async () => {
    const { app, inbox, push } = buatApp();
    const body = {
      dedupeKey: 'ORD-2:paid',
      recipientId: 'CUST-2',
      kind: 'PAYMENT_RECEIVED' as const,
      title: 'Pembayaran diterima',
      body: 'Terima kasih',
    };

    await request(app).post('/internal/notifications/send').send(body).expect(200);
    const retry = await request(app).post('/internal/notifications/send').send(body).expect(200);

    expect(retry.body.data.messageWritten).toBe(false);
    expect(retry.body.data.deliveries).toEqual([{ outcome: 'SKIPPED_DUPLICATE' }]);
    expect(await inbox.listForRecipient('CUST-2')).toHaveLength(1);
    expect(push.calls).toHaveLength(0);
  });

  it('mendorong ke perangkat native yang punya token lewat kanal andal', async () => {
    const { app, devices, push } = buatApp();
    await devices.register({
      deviceId: 'DEV-1',
      recipientId: 'DRV-1',
      shell: 'native-webview',
      platform: 'android',
      pushToken: 'token-1',
      lastSeenAt: T0,
    });

    const res = await request(app)
      .post('/internal/notifications/send')
      .send({
        dedupeKey: 'OFFER-1',
        recipientId: 'DRV-1',
        kind: 'DISPATCH_OFFER',
        title: 'Order baru',
        body: 'Ada penumpang dekat Anda',
      })
      .expect(200);

    expect(res.body.data.messageWritten).toBe(true);
    expect(res.body.data.deliveries).toEqual([
      { deviceId: 'DEV-1', channel: 'FCM', outcome: 'DELIVERED' },
    ]);
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0]).toMatchObject({ deviceId: 'DEV-1', dedupeKey: 'OFFER-1' });
  });

  it('tawaran dispatch (CRITICAL) ke perangkat web push TIDAK didorong — tetap INBOX_ONLY, push tidak dicoba', async () => {
    const { app, devices, push } = buatApp();
    // Browser dengan token: selectChannel() -> WEB_PUSH, bukan kanal
    // andal untuk CRITICAL menurut isChannelReliableForCritical().
    await devices.register({
      deviceId: 'DEV-2',
      recipientId: 'DRV-2',
      shell: 'browser',
      platform: 'web',
      pushToken: 'web-token',
      lastSeenAt: T0,
    });

    const res = await request(app)
      .post('/internal/notifications/send')
      .send({
        dedupeKey: 'OFFER-2',
        recipientId: 'DRV-2',
        kind: 'DISPATCH_OFFER',
        title: 'Order baru',
        body: 'Ada penumpang dekat Anda',
      })
      .expect(200);

    expect(res.body.data.deliveries).toEqual([
      { deviceId: 'DEV-2', channel: 'WEB_PUSH', outcome: 'INBOX_ONLY' },
    ]);
    expect(push.calls).toHaveLength(0);
  });

  it('body tidak sah mengembalikan 400', async () => {
    const { app } = buatApp();
    const res = await request(app)
      .post('/internal/notifications/send')
      .send({ recipientId: 'CUST-1' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/devices/register', () => {
  it('mendaftarkan perangkat baru', async () => {
    const { app, devices } = buatApp();

    await request(app)
      .post('/api/devices/register')
      .send({
        deviceId: 'DEV-3',
        recipientId: 'CUST-3',
        shell: 'pwa',
        platform: 'ios',
        pushToken: null,
      })
      .expect(200);

    expect(await devices.listForRecipient('CUST-3')).toHaveLength(1);
  });
});

describe('GET /api/notifications/inbox', () => {
  it('menolak tanpa header identitas penerima', async () => {
    const { app } = buatApp();
    const res = await request(app).get('/api/notifications/inbox').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('mengembalikan kotak masuk milik penerima yang mengirim header', async () => {
    const { app } = buatApp();
    await request(app)
      .post('/internal/notifications/send')
      .send({
        dedupeKey: 'DK-9',
        recipientId: 'CUST-9',
        kind: 'ANNOUNCEMENT',
        title: 'Info',
        body: 'Halo',
      })
      .expect(200);

    const res = await request(app)
      .get('/api/notifications/inbox')
      .set('X-Pesona-Recipient-Id', 'CUST-9')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].dedupeKey).toBe('DK-9');
  });
});

describe('POST /api/notifications/:id/read', () => {
  it('menandai dibaca dan mengembalikan 404 untuk kunci yang tidak ada', async () => {
    const { app } = buatApp();
    await request(app)
      .post('/internal/notifications/send')
      .send({
        dedupeKey: 'DK-READ',
        recipientId: 'CUST-4',
        kind: 'ANNOUNCEMENT',
        title: 'Info',
        body: 'Halo',
      })
      .expect(200);

    await request(app)
      .post('/api/notifications/DK-READ/read')
      .set('X-Pesona-Recipient-Id', 'CUST-4')
      .expect(200);

    const res = await request(app)
      .post('/api/notifications/TIDAK-ADA/read')
      .set('X-Pesona-Recipient-Id', 'CUST-4')
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
