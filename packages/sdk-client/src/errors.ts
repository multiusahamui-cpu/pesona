import type { ApiError } from '@pesona/contracts';

/** Kesalahan yang datang dari server dengan amplop error Pesona. */
export class PesonaApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly traceId?: string;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'PesonaApiError';
    this.status = status;
    this.code = error.code;
    this.details = error.details;
    this.traceId = error.traceId;
  }
}

/**
 * Klien memakai kontrak lama — ADR-006 pagar 6.
 *
 * Service worker `autoUpdate` dapat meninggalkan pengguna pada bundel lama
 * yang memakai bentuk API berbeda. Server menolak dengan 409 dan menyebut
 * versi minimum; aplikasi harus memuat ulang, bukan mencoba lagi.
 */
export class ClientVersionTooOldError extends PesonaApiError {
  readonly minClientVersion: string;

  constructor(status: number, error: ApiError, minClientVersion: string) {
    super(status, error);
    this.name = 'ClientVersionTooOldError';
    this.minClientVersion = minClientVersion;
  }
}

/**
 * Rekonsiliasi timpang — penarikan dan penyapuan dibekukan.
 * Aplikasi harus menampilkan pesan menahan diri, bukan menyuruh coba lagi.
 */
export class ReconciliationBreakError extends PesonaApiError {}

/**
 * Gagal jaringan atau waktu habis, sebelum server sempat menjawab.
 *
 * Penyebab aslinya diteruskan lewat `Error.cause` bawaan ES2022, bukan
 * dideklarasikan ulang sebagai properti — mendeklarasikan ulang akan
 * menutupi milik kelas induk.
 */
export class PesonaNetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PesonaNetworkError';
  }
}

/**
 * Respons server tidak sesuai kontrak.
 *
 * Ini disengaja keras: kalau bentuk respons melenceng dari skema zod,
 * lebih baik gagal terang-terangan di klien daripada meneruskan data
 * yang salah ke layar — apalagi kalau isinya nominal uang.
 */
export class ContractViolationError extends Error {
  readonly endpoint: string;
  readonly issues: unknown;

  constructor(endpoint: string, issues: unknown) {
    super(`Respons server tidak sesuai kontrak: ${endpoint}`);
    this.name = 'ContractViolationError';
    this.endpoint = endpoint;
    this.issues = issues;
  }
}
