import {
  buildConfirmation,
  CONFIRMATION_GESTURE,
  type TransactionConfirmation,
  type ConfirmationGesture,
} from '@pesona/contracts';

/**
 * Sifat layar konfirmasi transaksi di web — ADR-007 pagar 2, 3, 4.
 * Bentuknya sengaja dibuat sama persis dengan padanannya di ui-mobile,
 * supaya perilakunya identik di semua permukaan (pagar 1).
 */
export interface WebConfirmationProps {
  data: TransactionConfirmation;
  gesture: ConfirmationGesture;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function makeConfirmationProps(
  data: TransactionConfirmation,
  handlers: { onConfirm: () => void; onCancel: () => void },
  confirmLabel = 'Konfirmasi pembayaran',
): WebConfirmationProps {
  return { data, gesture: CONFIRMATION_GESTURE, confirmLabel, ...handlers };
}

export { buildConfirmation };
export type { TransactionConfirmation };
