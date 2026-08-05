import { describe, it, expect } from 'vitest';
import { rideSliceEndpoints } from '../src/api/index.js';

const all = Object.entries(rideSliceEndpoints);

describe('Registri endpoint', () => {
  it('tidak ada metode+path kembar', () => {
    const keys = all.map(([, e]) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('semua path diawali /api atau /internal', () => {
    for (const [name, e] of all) {
      expect(e.path, name).toMatch(/^\/(api|internal)\//);
    }
  });

  it('endpoint /internal tidak boleh berlevel publik', () => {
    for (const [name, e] of all) {
      if (e.path.startsWith('/internal/')) {
        expect(e.auth, name).toBe('internal');
      }
    }
  });
});

describe('Penjaga kontrak finansial', () => {
  /**
   * Ini invariant yang paling penting di berkas ini. Setiap operasi yang
   * menggerakkan uang WAJIB idempoten — kalau tidak, retry akibat sinyal
   * putus akan berubah jadi transaksi ganda.
   */
  it('setiap endpoint monetary wajib idempotent', () => {
    const pelanggar = all
      .filter(([, e]) => e.monetary && !e.idempotent)
      .map(([name]) => name);
    expect(pelanggar).toEqual([]);
  });

  it('GET tidak pernah bersifat monetary', () => {
    const pelanggar = all
      .filter(([, e]) => e.method === 'GET' && e.monetary)
      .map(([name]) => name);
    expect(pelanggar).toEqual([]);
  });

  it('operasi uang tidak boleh terbuka tanpa autentikasi', () => {
    const pelanggar = all
      .filter(([, e]) => e.monetary && e.auth === 'none')
      .map(([name]) => name);
    expect(pelanggar).toEqual([]);
  });
});

describe('Alur irisan ride', () => {
  it('sepuluh langkah irisan tersedia', () => {
    for (const n of [
      'auth.login',
      'geo.routePreview',
      'pricing.quote',
      'order.create',
      'escrow.issuePayment',
      'escrow.acquirerWebhook',
      'location.setPresence',
      'dispatch.acceptOffer',
      'order.complete',
      'escrow.reconciliation',
    ] as const) {
      expect(rideSliceEndpoints[n], n).toBeDefined();
    }
  });

  it('pembuatan order tidak menerima nominal dari klien', () => {
    const shape = Object.keys(
      (rideSliceEndpoints['order.create'].request as never as { shape: object }).shape,
    );
    expect(shape).toContain('quoteId');
    expect(shape).not.toContain('grossFare');
    expect(shape).not.toContain('amount');
  });
});
