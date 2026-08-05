import { describe, it, expect, vi } from 'vitest';
import { createClient } from '../src/client.js';
import { PesonaApiError, ContractViolationError } from '../src/errors.js';
import type { RuntimeInfo } from '../src/runtime.js';

const runtime: RuntimeInfo = {
  shell: 'native-webview',
  os: 'android',
  platform: 'android',
  installed: true,
};

const ULID = '01JZ0000000000000000000000';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeClient(fetchImpl: typeof fetch) {
  return createClient({
    baseUrl: 'https://api.pesona.test',
    clientVersion: '1.2.0',
    deviceId: 'device-abc',
    getAccessToken: () => 'token-xyz',
    runtime,
    fetchImpl,
    timeoutMs: 1000,
  });
}

const orderResponse = {
  data: {
    id: ULID,
    vertical: 'RIDE',
    status: 'AWAITING_PAYMENT',
    consumerId: ULID,
    partnerId: null,
    amounts: {
      grossFare: 50000,
      mdr: 350,
      netReceived: 49650,
      partnerShare: 42500,
      platformCommission: 7150,
    },
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
  },
};

describe('Substitusi path', () => {
  it('mengganti :orderId dan tidak mengirimnya di body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(orderResponse));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await client.call('order.complete', {
      orderId: ULID,
      at: { lat: -6.2, lng: 106.8 },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.pesona.test/api/orders/${ULID}/complete`);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('orderId');
    expect(body).toHaveProperty('at');
  });
});

describe('Header konteks — ADR-006 pagar 4', () => {
  it('mengirim shell, platform, perangkat, dan versi klien', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(orderResponse));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await client.call('order.get', { orderId: ULID });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Pesona-Shell']).toBe('native-webview');
    expect(headers['X-Pesona-Platform']).toBe('android');
    expect(headers['X-Pesona-Device-Id']).toBe('device-abc');
    expect(headers['X-Pesona-Client-Version']).toBe('1.2.0');
    expect(headers.Authorization).toBe('Bearer token-xyz');
  });
});

describe('Idempotensi', () => {
  /**
   * Inilah tes terpenting di berkas ini. Kunci idempotensi HARUS sama
   * di seluruh percobaan ulang. Kunci baru saat retry = transaksi ganda.
   */
  it('memakai kunci yang sama di semua percobaan ulang', async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      if (attempt < 3) {
        return jsonResponse({ error: { code: 'INTERNAL', message: 'boom' } }, 500);
      }
      return jsonResponse(orderResponse);
    });

    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.call(
      'order.complete',
      { orderId: ULID, at: { lat: -6.2, lng: 106.8 } },
      { retries: 3 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const keys = fetchMock.mock.calls.map(
      (c) => ((c as unknown as [string, RequestInit])[1].headers as Record<string, string>)[
        'Idempotency-Key'
      ],
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBeTruthy();
  });

  it('endpoint non-idempoten tidak mendapat kunci dan tidak diulang', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { code: 'INTERNAL', message: 'boom' } }, 500),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.call('auth.login', { identifier: '0811', password: 'rahasia123' }),
    ).rejects.toBeInstanceOf(PesonaApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
  });
});

describe('Validasi respons', () => {
  it('menolak respons yang melenceng dari kontrak', async () => {
    const rusak = {
      data: { ...orderResponse.data, amounts: { ...orderResponse.data.amounts, grossFare: 50000.5 } },
    };
    const fetchMock = vi.fn(async () => jsonResponse(rusak));
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await expect(client.call('order.get', { orderId: ULID })).rejects.toBeInstanceOf(
      ContractViolationError,
    );
  });
});

describe('Validasi input', () => {
  it('menolak nominal desimal sebelum menyentuh jaringan', async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.call('escrow.acquirerWebhook', {
        acquirerRef: 'REF123',
        orderId: ULID,
        netReceived: 49650.5,
        mdr: 350,
        paidAt: '2026-08-03T10:00:00.000Z',
        signature: 'sig',
      }),
    ).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
