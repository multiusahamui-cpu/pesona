import { z } from 'zod';

/** Amplop error seragam untuk seluruh API Pesona. */
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  /** Diisi server, dipakai untuk melacak di log dan saat sengketa. */
  traceId: z.string().optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  /** Rekonsiliasi timpang — penarikan dan penyapuan dibekukan. */
  RECONCILIATION_BREAK: 'RECONCILIATION_BREAK',
  ACQUIRER_UNAVAILABLE: 'ACQUIRER_UNAVAILABLE',
  /** Klien memakai kontrak lama — lihat ADR-006 pagar 6. */
  CLIENT_VERSION_TOO_OLD: 'CLIENT_VERSION_TOO_OLD',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
