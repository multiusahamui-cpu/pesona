import { z } from 'zod';

/** Konfigurasi location, divalidasi saat proses menyala. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5002),
  REDIS_URL: z.string().min(1),
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
