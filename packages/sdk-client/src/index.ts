/**
 * @pesona/sdk-client — client API tipe-aman untuk seluruh aplikasi.
 *
 * Tipenya diturunkan langsung dari @pesona/contracts lewat inferensi,
 * bukan dari codegen. Konsekuensinya: begitu kontrak berubah, aplikasi
 * yang memakai bentuk lama GAGAL SAAT KOMPILASI — bukan gagal diam-diam
 * saat dijalankan di tangan pengguna.
 *
 * Dipakai sama persis oleh web dan React Native.
 */

export { createClient } from './client.js';
export type { ClientConfig, CallOptions, Input, Output, PesonaClient } from './client.js';

export {
  detectRuntime,
  supportsBackgroundLocation,
  allowsOfflineFinancialQueue,
} from './runtime.js';
export type { RuntimeInfo, RuntimePlatform } from './runtime.js';

export {
  PesonaApiError,
  PesonaNetworkError,
  ClientVersionTooOldError,
  ReconciliationBreakError,
  ContractViolationError,
} from './errors.js';
