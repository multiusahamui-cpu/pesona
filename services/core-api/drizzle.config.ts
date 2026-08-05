import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Config } from 'drizzle-kit';

/**
 * Konfigurasi drizzle-kit — generate & migrate skema PostgreSQL core-api.
 *
 * Perintah (dari root monorepo):
 *   pnpm --filter @pesona/core-api db:generate   # buat file migration dari perubahan skema
 *   pnpm --filter @pesona/core-api db:migrate    # jalankan migration ke DATABASE_URL
 *   pnpm --filter @pesona/core-api db:push       # dorong skema langsung tanpa file migration (dev cepat)
 *   pnpm --filter @pesona/core-api db:studio     # buka Drizzle Studio
 *
 * Fase 1: hanya dua modul yang punya skema (order, escrow-settlement).
 * Tambahkan path skema modul lain ke array di bawah begitu modul itu
 * punya tabel Drizzle sungguhan — jangan lupa, kalau tidak drizzle-kit
 * generate akan diam-diam tidak melihat tabel baru.
 *
 * drizzle-kit dijalankan lewat `pnpm --filter`, yang menyetel cwd ke
 * folder paket ini — BUKAN ke root monorepo tempat `.env` sungguhan
 * berada. Tanpa baris di bawah, `process.env.DATABASE_URL` selalu
 * kosong dan drizzle-kit gagal dengan "Please provide required params
 * for Postgres driver: [x] url: ''" meskipun `.env` sudah diisi benar.
 * Path dihitung dari lokasi berkas ini (bukan `process.cwd()`) supaya
 * tetap benar dari mana pun perintah dipanggil.
 */
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
export default {
  schema: [
    './src/modules/order/schema/order.schema.ts',
    './src/modules/escrow-settlement/schema/ledger.schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
} satisfies Config;
