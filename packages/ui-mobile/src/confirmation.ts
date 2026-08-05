import {
  buildConfirmation,
  CONFIRMATION_GESTURE,
  type TransactionConfirmation,
  type ConfirmationGesture,
} from '@pesona/contracts';

/**
 * Sifat layar konfirmasi transaksi di mobile — ADR-007 pagar 2, 3, 4.
 *
 * Isyaratnya dikunci ke ketukan. Tipe ConfirmationGesture hanya punya
 * satu nilai, jadi menambahkan geser-untuk-bayar akan gagal kompilasi,
 * bukan lolos review.
 */
export interface MobileConfirmationProps {
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
): MobileConfirmationProps {
  return { data, gesture: CONFIRMATION_GESTURE, confirmLabel, ...handlers };
}

export { buildConfirmation };
export type { TransactionConfirmation };
