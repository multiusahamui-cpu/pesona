/**
 * Modul 13 — Escrow & Settlement
 *
 * KONTRAK PUBLIK MODUL INI.
 *
 * Modul lain HANYA boleh mengimpor dari berkas ini. Mengimpor langsung
 * dari ./repo, ./schema, atau ./service milik modul lain DILARANG dan
 * ditolak oleh eslint-plugin-boundaries di CI.
 *
 * Lihat docs/adr/ARSITEKTUR-KEUANGAN-PESONA.md
 */

export { DrizzleLedger } from './repo/drizzle-ledger.js';

export {
  InMemoryLedger,
  computeAmounts,
  journalPaymentReceived,
  journalOrderCompleted,
  journalFullRefund,
  journalPartialRefund,
  journalCommissionSweep,
  UnbalancedJournalError,
} from './service/ledger.js';

export type {
  Ledger,
  ReconciliationSnapshot,
  AccountCode,
  JournalCode,
  JournalEntry,
  JournalLine,
  OrderAmounts,
} from './service/ledger.js';
