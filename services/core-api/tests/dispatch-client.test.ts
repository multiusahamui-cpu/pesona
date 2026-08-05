import { describe, it, expect, vi } from 'vitest';
import { HttpDispatchClient } from '../src/modules/order/index.js';

describe('HttpDispatchClient', () => {
  it('mengirim POST ke /internal/dispatch/start dan mengembalikan hasilnya', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { state: 'SEARCHING', wave: 1 } }),
    });
    const client = new HttpDispatchClient(
      'http://dispatch.local',
      fetchMock as unknown as typeof fetch,
    );

    const result = await client.start({ orderId: 'ORD-1', pickup: { lat: -6.2, lng: 106.8 } });

    expect(result).toEqual({ state: 'SEARCHING', wave: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://dispatch.local/internal/dispatch/start',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('melempar bila dispatch menjawab bukan 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const client = new HttpDispatchClient(
      'http://dispatch.local',
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      client.start({ orderId: 'ORD-1', pickup: { lat: -6.2, lng: 106.8 } }),
    ).rejects.toThrow('dispatch menjawab 500');
  });

  it('melempar bila jawaban tidak membawa data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const client = new HttpDispatchClient(
      'http://dispatch.local',
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      client.start({ orderId: 'ORD-1', pickup: { lat: -6.2, lng: 106.8 } }),
    ).rejects.toThrow('dispatch tidak mengembalikan data');
  });
});
