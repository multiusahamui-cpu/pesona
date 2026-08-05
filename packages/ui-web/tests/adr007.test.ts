import { describe, it, expect } from 'vitest';
import { resolveLayout, buildNavItems, WIDE_VIEWPORT_MIN_PX } from '../src/navigation.js';
import { buildConfirmation, makeConfirmationProps } from '../src/confirmation.js';
import { money } from '@pesona/contracts';

describe('ADR-007 — tata letak navigasi web', () => {
  it('back-office boleh sidebar', () => {
    expect(resolveLayout('web-admin', 1440)).toBe('sidebar');
    expect(resolveLayout('web-ops', 1440)).toBe('sidebar');
  });

  it('permukaan konsumen TIDAK PERNAH sidebar', () => {
    for (const w of [320, 768, 1440, 2560]) {
      expect(resolveLayout('web-public', w)).not.toBe('sidebar');
      expect(resolveLayout('web-merchant', w)).not.toBe('sidebar');
    }
  });

  it('layar sempit dapat bottom tab, layar lebar dapat top nav', () => {
    expect(resolveLayout('web-public', WIDE_VIEWPORT_MIN_PX - 1)).toBe('bottom-tabs');
    expect(resolveLayout('web-public', WIDE_VIEWPORT_MIN_PX)).toBe('top-nav');
  });
});

describe('Item navigasi', () => {
  it('konsumen non-anggota tidak mendapat tautan Dompet', () => {
    expect(buildNavItems('consumer', false).map((i) => i.label)).not.toContain('Dompet');
  });
});

describe('Konfirmasi web cerminan mobile', () => {
  it('isyaratnya ketukan, dan total diverifikasi', () => {
    const c = buildConfirmation({
      amount: money(50000),
      recipientName: 'Warung Bu Sri',
      fees: [{ label: 'Ongkir', amount: money(8000) }],
      total: money(58000),
      reference: 'ORD-456',
    });
    const props = makeConfirmationProps(c, { onConfirm: () => undefined, onCancel: () => undefined });
    expect(props.gesture).toBe('tap');
    expect(props.data.total).toBe(58000);
  });
});
