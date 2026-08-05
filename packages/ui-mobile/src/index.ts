/**
 * @pesona/ui-mobile — design system React Native Pesona.
 *
 * ADR-007 mensyaratkan komponen navigasi dan konfirmasi transaksi berasal
 * dari paket ini, bukan ditulis ulang di tiap aplikasi. Kalau ditulis
 * ulang, kelima pagar ADR-007 bergantung pada kedisiplinan tiap
 * pengembang — dan itu tidak bertahan.
 */
export { buildTabRoutes } from './navigation.js';
export type { MobileTabRoute } from './navigation.js';
export { makeConfirmationProps, buildConfirmation } from './confirmation.js';
export type { MobileConfirmationProps, TransactionConfirmation } from './confirmation.js';
