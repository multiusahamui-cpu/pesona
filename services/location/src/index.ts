import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express from 'express';
import { loadEnv } from './platform/env.js';
import { registerLocationRoutes } from './routes.js';
import { InMemoryPresenceStore, type PresenceStore } from './store.js';

/**
 * Muat `.env` root monorepo sebelum apa pun membaca `process.env` —
 * lihat komentar identik di services/core-api/src/index.ts untuk
 * alasan lengkapnya (cwd `pnpm --filter` bukan root, ADR-005 di
 * produksi).
 */
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

/**
 * @pesona/location — Modul 4, Supply State.
 *
 * Diekstrak dari core-api karena profil tulisnya berbeda total: ping GPS
 * bisa mencapai ratusan ribu tulis per detik, dan datastore-nya Redis,
 * bukan PostgreSQL. Ping driver TIDAK PERNAH masuk PostgreSQL — posisi
 * terkini di Redis, riwayat untuk keperluan sengketa di TimescaleDB.
 *
 * Layanan internal: ClusterIP, TIDAK PERNAH diekspos ke internet.
 */

const SERVICE = 'location';

export interface AppDeps {
  store?: PresenceStore;
  now?: () => number;
}

export function createApp(deps: AppDeps = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // In-memory hanya untuk pengembangan dan tes. Adaptor Redis menggantikan
  // ini tanpa menyentuh handler maupun domain.
  const store = deps.store ?? new InMemoryPresenceStore();

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'live', service: SERVICE });
  });

  app.get('/health/ready', (_req, res) => {
    res.json({ status: 'ready', service: SERVICE });
  });

  registerLocationRoutes(app, { store, now: deps.now });
  return app;
}

export function start(): void {
  const env = loadEnv();
  createApp().listen(env.PORT, () => {
    console.warn(`[${SERVICE}] mendengarkan di port ${env.PORT} (${env.NODE_ENV})`);
  });
}

if (process.argv[1]?.endsWith('index.js')) {
  start();
}

export { InMemoryPresenceStore } from './store.js';
export type { PresenceStore } from './store.js';
