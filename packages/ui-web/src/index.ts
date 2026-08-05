/**
 * @pesona/ui-web — design system web Pesona.
 *
 * ADR-007 mensyaratkan komponen navigasi dan konfirmasi transaksi berasal
 * dari paket ini. Bentuk propsnya sengaja dibuat cerminan ui-mobile agar
 * kedua permukaan berperilaku sama.
 */
export { resolveLayout, buildNavItems, WIDE_VIEWPORT_MIN_PX } from './navigation.js';
export type { WebNavLayout, WebNavItem } from './navigation.js';
export { makeConfirmationProps, buildConfirmation } from './confirmation.js';
export type { WebConfirmationProps, TransactionConfirmation } from './confirmation.js';
