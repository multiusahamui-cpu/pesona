// Skrip sekali-pakai — HANYA untuk database dev pesona yang belum bersih
// (tersisa dari percobaan db:migrate/db:push sebelumnya). TIDAK PERNAH
// dijalankan ke database yang berisi data sungguhan.
//
// Menghapus tabel yang dibuat migration 0000 plus schema `drizzle`
// (tempat drizzle-kit menyimpan riwayat migration), supaya
// `db:migrate` bisa mulai dari nol dan riwayatnya konsisten.
//
// Jalankan: node scripts/reset-db.mjs   (dari folder services/core-api)
// atau:     pnpm --filter @pesona/core-api db:reset-dev

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL tidak disetel di .env — batal.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const statements = [
  'DROP TABLE IF EXISTS journal_lines CASCADE',
  'DROP TABLE IF EXISTS journal_entries CASCADE',
  'DROP TABLE IF EXISTS orders CASCADE',
  'DROP SCHEMA IF EXISTS drizzle CASCADE',
];

try {
  for (const sql of statements) {
    console.log(`> ${sql}`);
    await pool.query(sql);
  }
  console.log('\nSelesai. Database bersih — jalankan db:migrate lagi.');
} finally {
  await pool.end();
}
