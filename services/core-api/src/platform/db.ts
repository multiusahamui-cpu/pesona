import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * Koneksi PostgreSQL — dipakai DrizzleOrderRepo dan DrizzleLedger.
 *
 * Satu Pool per pemanggilan; index.ts memanggilnya sekali (lazy, hanya
 * kalau DATABASE_URL disetel dan tidak ada repo/ledger yang disuntik
 * lewat AppDeps) dan menyimpan hasilnya sendiri. Sengaja TIDAK ada
 * singleton module-level di sini — sama seperti loadEnv() — supaya tes
 * bisa membuat koneksi terpisah tanpa state bocor antar proses.
 */
export function createDb(connectionString: string): Db {
  const pool = new Pool({ connectionString });
  return drizzle(pool);
}

export type Db = NodePgDatabase;
