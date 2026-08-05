import { describe, it, expect, vi } from 'vitest';
import { HttpNotificationClient } from '../src/modules/order/index.js';

describe('HttpNotificationClient', () => {
  it('mengirim POST ke /internal/notifications/send', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
    const client = new HttpNotificationClient(
      'http://notification.local',
      fetchMock as unknown as typeof fetch,
    );

    await client.send({
      dedupeKey: 'ORD-1:consumer:dispatching',
      recipientId: 'CUST-1',
      kind: 'ORDER_STATUS',
      title: 'Mencari driver',
      body: 'Sedang mencari driver terdekat.',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://notification.local/internal/notifications/send',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toMatchObject({
      dedupeKey: 'ORD-1:consumer:dispatching',
      recipientId: 'CUST-1',
    });
  });

  it('melempar bila notification menjawab bukan 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const client = new HttpNotificationClient(
      'http://notification.local',
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      client.send({
        dedupeKey: 'ORD-1:consumer:dispatching',
        recipientId: 'CUST-1',
        kind: 'ORDER_STATUS',
        title: 'x',
        body: 'y',
      }),
    ).rejects.toThrow('notification menjawab 500');
  });

  it('menghilangkan garis miring akhir pada baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const client = new HttpNotificationClient(
      'http://notification.local/',
      fetchMock as unknown as typeof fetch,
    );

    await client.send({
      dedupeKey: 'ORD-1:consumer:dispatching',
      recipientId: 'CUST-1',
      kind: 'ORDER_STATUS',
      title: 'x',
      body: 'y',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://notification.local/internal/notifications/send',
      expect.anything(),
    );
  });
});
