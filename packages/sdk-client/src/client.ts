import { z } from 'zod';
import {
  rideSliceEndpoints,
  ApiErrorSchema,
  type EndpointName,
  type EndpointDef,
} from '@pesona/contracts';
import { detectRuntime, type RuntimeInfo } from './runtime.js';
import {
  PesonaApiError,
  PesonaNetworkError,
  ClientVersionTooOldError,
  ReconciliationBreakError,
  ContractViolationError,
} from './errors.js';

type Registry = typeof rideSliceEndpoints;

export type Input<N extends EndpointName> = z.input<Registry[N]['request']>;
export type Output<N extends EndpointName> = z.output<Registry[N]['response']>;

export interface ClientConfig {
  baseUrl: string;
  clientVersion: string;
  deviceId: string;
  /** Dipanggil tiap permintaan; kembalikan null bila belum masuk. */
  getAccessToken?: () => string | null | Promise<string | null>;
  /** Ditimpa hanya untuk pengujian. */
  runtime?: RuntimeInfo;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Dipanggil saat server menolak versi klien — aplikasi harus memuat ulang. */
  onClientVersionTooOld?: (minVersion: string) => void;
}

export interface CallOptions {
  /**
   * Kunci idempotensi.
   *
   * Kalau tidak diisi, klien membuatnya SEKALI di awal panggilan dan
   * memakainya kembali untuk seluruh percobaan ulang di dalam panggilan
   * itu. Membuat kunci baru saat retry menghilangkan seluruh gunanya —
   * dan itu kesalahan paling mahal di sistem pembayaran.
   *
   * Untuk operasi yang dipicu tombol, simpan kuncinya di state layar
   * supaya tetap sama bila pengguna menekan tombol lagi setelah gagal.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Jumlah percobaan ulang. Hanya berlaku untuk endpoint idempoten. */
  retries?: number;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Cadangan untuk lingkungan tanpa crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Ganti :param di path dengan nilai dari input, sisanya jadi body/query. */
function buildPath(
  template: string,
  input: Record<string, unknown>,
): { path: string; rest: Record<string, unknown> } {
  const rest: Record<string, unknown> = { ...input };
  const path = template.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = rest[name];
    if (value === undefined || value === null) {
      throw new Error(`Parameter path "${name}" tidak ada di input untuk ${template}`);
    }
    delete rest[name];
    return encodeURIComponent(String(value));
  });
  return { path, rest };
}

export function createClient(config: ClientConfig) {
  const doFetch: typeof fetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 20_000;

  async function call<N extends EndpointName>(
    name: N,
    input: Input<N>,
    options: CallOptions = {},
  ): Promise<Output<N>> {
    const def = rideSliceEndpoints[name] as EndpointDef;
    const runtime = config.runtime ?? detectRuntime();

    // Dibuat SEKALI di sini, dipakai ulang oleh seluruh percobaan.
    const idempotencyKey =
      options.idempotencyKey ?? (def.idempotent ? newIdempotencyKey() : undefined);

    const parsedInput = def.request.parse(input) as Record<string, unknown>;
    const { path, rest } = buildPath(def.path, parsedInput);

    const url = new URL(config.baseUrl.replace(/\/$/, '') + path);
    let body: string | undefined;

    if (def.method === 'GET') {
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    } else {
      body = JSON.stringify(rest);
    }

    const token = (await config.getAccessToken?.()) ?? null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // ADR-006 pagar 4: shell, perangkat, dan versi dicatat pada setiap
      // permintaan supaya saat sengketa masuk, CS dapat merekonstruksi
      // dari permukaan mana aksi itu berasal.
      'X-Pesona-Shell': runtime.shell,
      'X-Pesona-Platform': runtime.platform,
      'X-Pesona-Device-Id': config.deviceId,
      'X-Pesona-Client-Version': config.clientVersion,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const maxAttempts = def.idempotent ? 1 + (options.retries ?? 2) : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

      try {
        const response = await doFetch(url.toString(), {
          method: def.method,
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          const parsed = ApiErrorSchema.safeParse(
            (payload as { error?: unknown } | null)?.error ?? payload,
          );
          const apiError = parsed.success
            ? parsed.data
            : { code: 'UNKNOWN', message: `HTTP ${response.status}` };

          if (apiError.code === 'CLIENT_VERSION_TOO_OLD') {
            const minVersion = String(apiError.details?.minClientVersion ?? '');
            config.onClientVersionTooOld?.(minVersion);
            throw new ClientVersionTooOldError(response.status, apiError, minVersion);
          }
          if (apiError.code === 'RECONCILIATION_BREAK') {
            throw new ReconciliationBreakError(response.status, apiError);
          }

          // 5xx pada endpoint idempoten boleh diulang — kunci idempotensi
          // yang sama menjamin server tidak memproses dua kali.
          if (response.status >= 500 && attempt < maxAttempts) {
            lastError = new PesonaApiError(response.status, apiError);
            continue;
          }
          throw new PesonaApiError(response.status, apiError);
        }

        const raw: unknown = await response.json();
        const validated = def.response.safeParse(raw);
        if (!validated.success) {
          throw new ContractViolationError(name, validated.error.issues);
        }
        return validated.data as Output<N>;
      } catch (error) {
        clearTimeout(timer);
        if (
          error instanceof PesonaApiError ||
          error instanceof ContractViolationError
        ) {
          throw error;
        }
        lastError = error;
        // Waktu habis pada endpoint idempoten aman diulang dengan kunci
        // yang sama. Pada endpoint non-idempoten TIDAK diulang — status
        // di server tidak diketahui, dan mengulang bisa berarti dobel.
        if (attempt >= maxAttempts) {
          throw new PesonaNetworkError('Permintaan gagal atau waktu habis', error);
        }
      }
    }

    throw new PesonaNetworkError('Permintaan gagal', lastError);
  }

  return { call, runtime: config.runtime ?? detectRuntime() };
}

export type PesonaClient = ReturnType<typeof createClient>;
