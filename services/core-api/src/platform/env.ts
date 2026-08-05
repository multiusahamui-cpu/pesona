import { z } from 'zod';

/**
 * Konfigurasi dibaca sekali saat proses menyala, dan divalidasi.
 *
 * Kalau ada variabel yang hilang atau salah bentuk, proses berhenti di
 * detik pertama — bukan gagal di tengah transaksi enam jam kemudian.
 *
 * Di produksi TIDAK ADA berkas .env (ADR-005). Nilai dipasok External
 * Secrets Operator sebagai variabel lingkungan biasa.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET minimal 32 karakter'),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Sengaja TIDAK menyimpan hasil di cache modul: fungsi murni jauh lebih
 * mudah diuji, dan pemanggilannya hanya sekali saat proses menyala.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Konfigurasi lingkungan tidak sah:\n${detail}`);
  }
  return parsed.data;
}
