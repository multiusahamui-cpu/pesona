import { describe, it, expect } from 'vitest';
import { money, add, subtract, applyRate } from '../src/money.js';
import { canTransition } from '../src/order.js';
import { isBalanced, settlementGate } from '../src/escrow.js';

describe('Money', () => {
  it('menolak desimal', () => {
    expect(() => money(1000.5)).toThrow();
  });

  it('menjumlah tanpa kehilangan presisi', () => {
    expect(add(money(42500), money(7150))).toBe(49650);
  });

  it('mengurangi', () => {
    expect(subtract(money(50000), money(350))).toBe(49650);
  });

  it('MDR 0,7% dari 50.000 dibulatkan ke atas = 350', () => {
    expect(applyRate(money(50000), 7, 'ceil')).toBe(350);
  });

  it('komisi 15% dari 50.000 dibulatkan ke bawah = 7.500', () => {
    expect(applyRate(money(50000), 150, 'floor')).toBe(7500);
  });

  it('contoh JRN-P01/P02 mengunci: 49.650 = 42.500 + 7.150', () => {
    const gross = money(50000);
    const mdr = applyRate(gross, 7, 'ceil');
    const netReceived = subtract(gross, mdr);
    const partnerShare = applyRate(gross, 850, 'floor');
    const commission = subtract(netReceived, partnerShare);

    expect(netReceived).toBe(49650);
    expect(partnerShare).toBe(42500);
    expect(commission).toBe(7150);
    expect(add(partnerShare, commission)).toBe(netReceived);
  });
});

describe('State machine order', () => {
  it('pembayaran mendahului dispatch', () => {
    expect(canTransition('AWAITING_PAYMENT', 'PAID')).toBe(true);
    expect(canTransition('AWAITING_PAYMENT', 'DISPATCHING')).toBe(false);
  });

  it('status terminal tidak bisa dihidupkan lagi', () => {
    expect(canTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('CANCELLED', 'PAID')).toBe(false);
  });
});

describe('Gerbang rekonsiliasi', () => {
  const base = {
    asOf: '2026-08-03T17:00:00.000Z',
    bankBalanceR1: money(100000),
    totalMemberSavings: money(60000),
    totalHeldFunds: money(30000),
    totalUnsweptCommission: money(10000),
    totalPendingRefund: money(0),
  };

  it('seimbang membuka penyapuan dan penarikan', () => {
    const snap = { ...base, variance: money(0) };
    expect(isBalanced(snap)).toBe(true);
    expect(settlementGate(snap)).toEqual({ allowSweep: true, allowWithdrawal: true });
  });

  it('selisih satu rupiah membekukan keduanya', () => {
    const snap = { ...base, variance: money(1) };
    expect(settlementGate(snap)).toEqual({ allowSweep: false, allowWithdrawal: false });
  });
});
