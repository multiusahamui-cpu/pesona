import { describe, it, expect } from 'vitest';
import { buildTabRoutes } from '../src/navigation.js';
import { buildConfirmation, makeConfirmationProps } from '../src/confirmation.js';
import { money, CONSUMER_TABS, DRIVER_TABS, MERCHANT_TABS, MAX_BOTTOM_TABS } from '@pesona/contracts';

describe('ADR-007 pagar 1 — label identik lintas permukaan', () => {
  it('definisi tab berasal dari satu sumber di contracts', () => {
    const anggota = buildTabRoutes('consumer', true).map((t) => t.title);
    expect(anggota).toEqual(CONSUMER_TABS.map((t) => t.label));
  });

  it('konsumen non-anggota tidak melihat tab Dompet', () => {
    const titles = buildTabRoutes('consumer', false).map((t) => t.title);
    expect(titles).not.toContain('Dompet');
    expect(titles).toContain('Pesanan');
  });
});

describe('Batas jumlah tab', () => {
  it('semua set tab tidak melebihi lima', () => {
    for (const set of [CONSUMER_TABS, DRIVER_TABS, MERCHANT_TABS]) {
      expect(set.length).toBeLessThanOrEqual(MAX_BOTTOM_TABS);
    }
  });

  it('kunci tab unik dalam satu set', () => {
    for (const set of [CONSUMER_TABS, DRIVER_TABS, MERCHANT_TABS]) {
      const keys = set.map((t) => t.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('ADR-007 pagar 3 dan 4 — konfirmasi transaksi', () => {
  const data = {
    amount: money(50000),
    recipientName: 'Budi Santoso',
    fees: [{ label: 'Biaya layanan', amount: money(2000) }],
    total: money(52000),
    reference: 'ORD-123',
  };

  it('menerima data yang aritmetikanya benar', () => {
    const c = buildConfirmation(data);
    expect(c.total).toBe(52000);
    expect(c.recipientName).toBe('Budi Santoso');
  });

  it('menolak total yang tidak cocok dengan rinciannya', () => {
    expect(() => buildConfirmation({ ...data, total: money(51000) })).toThrow();
  });

  it('menolak penerima kosong — pagar 3 menuntutnya eksplisit', () => {
    expect(() => buildConfirmation({ ...data, recipientName: '' })).toThrow();
  });

  it('isyarat persetujuan selalu ketukan, tidak pernah geseran', () => {
    const props = makeConfirmationProps(buildConfirmation(data), {
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });
    expect(props.gesture).toBe('tap');
  });
});
