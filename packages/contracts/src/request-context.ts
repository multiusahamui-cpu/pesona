import { z } from 'zod';

/**
 * Konteks yang WAJIB menyertai setiap permintaan yang mengubah state.
 * Lihat ADR-006 pagar 2 dan 4.
 */

/**
 * Shell asal permintaan. Dicatat pada setiap transaksi supaya saat
 * sengketa masuk, CS dapat merekonstruksi dari permukaan mana aksi berasal.
 */
export const ClientShellSchema = z.enum(['browser', 'pwa', 'native-webview']);
export type ClientShell = z.infer<typeof ClientShellSchema>;

export const PlatformSchema = z.enum(['ios', 'android', 'web']);

/**
 * Kunci idempotensi. Wajib pada semua operasi yang menggerakkan uang.
 *
 * Aturan yang tidak boleh dilanggar: saat retry, kunci HARUS sama dengan
 * percobaan pertama. Membuat kunci baru saat retry menghilangkan seluruh
 * gunanya — dan itu kesalahan paling mahal di sistem pembayaran.
 */
export const IdempotencyKeySchema = z.string().uuid();

export const MutationContextSchema = z.object({
  idempotencyKey: IdempotencyKeySchema,
  shell: ClientShellSchema,
  platform: PlatformSchema,
  deviceId: z.string().min(1).max(128),
  clientVersion: z.string().min(1).max(32),
});

export type MutationContext = z.infer<typeof MutationContextSchema>;
