import { describe, it, expect, vi } from 'vitest';
import { HttpOrderClient, RecordingOrderClient } from '../src/order-client.js';

describe('HttpOrderClient', () => {
  it('mengirim POST ke endpoint assign core-api dengan partnerId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const client = new HttpOrderClient('http://core-api.local', fetchMock as unknown as typeof fetch);

    await client.notifyAssigned('ORD-1', 'DRV-9');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://core-api.local/internal/orders/ORD-1/assign',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ partnerId: 'DRV-9' }),
      }),
    );
  });

  it('mengirim POST ke endpoint dispatch-exhausted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const client = new HttpOrderClient('http://core-api.local', fetchMock as unknown as typeof fetch);

    await client.notifyExhausted('ORD-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://core-api.local/internal/orders/ORD-1/dispatch-exhausted',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('melempar bila core-api menjawab bukan 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const client = new HttpOrderClient('http://core-api.local', fetchMock as unknown as typeof fetch);

    await expect(client.notifyExhausted('ORD-1')).rejects.toThrow('core-api menjawab 500');
  });
});

describe('RecordingOrderClient (default dev tanpa CORE_API_URL)', () => {
  it('mencatat panggilan tanpa melakukan HTTP', async () => {
    const client = new RecordingOrderClient();

    await client.notifyAssigned('ORD-1', 'DRV-9');
    await client.notifyExhausted('ORD-2');

    expect(client.assigned).toEqual([{ orderId: 'ORD-1', partnerId: 'DRV-9' }]);
    expect(client.exhausted).toEqual(['ORD-2']);
  });
});
