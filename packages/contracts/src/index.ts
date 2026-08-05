/**
 * @pesona/contracts — sumber kebenaran tipe untuk seluruh workspace.
 *
 * Zod-first: skema didefinisikan sekali di sini, dipakai untuk validasi
 * runtime di service, tipe TypeScript diturunkan otomatis, dan OpenAPI
 * di-generate darinya (pnpm --filter @pesona/contracts gen:openapi).
 *
 * Jangan pernah mendefinisikan ulang tipe API di app atau service.
 */

export * from './money.js';
export * from './ids.js';
export * from './result.js';
export * from './request-context.js';
export * from './order.js';
export * from './escrow.js';
export * from './navigation.js';
export * from './confirmation.js';

// Kontrak endpoint — irisan vertikal ride
export * as api from './api/index.js';
export { rideSliceEndpoints } from './api/index.js';
export type { EndpointName, EndpointDef, AuthLevel } from './api/index.js';
