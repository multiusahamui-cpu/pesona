import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express from 'express';
import { loadEnv } from './platform/env.js';
import { registerNotificationRoutes, type NotificationDeps } from './routes.js';
import { InMemoryInboxStore, InMemoryDeviceStore, type InboxStore, type DeviceStore } from './store.js';
import { NoopPushAdapter, type PushPort } from './push-client.js';

/**
 * Muat `.env` root monorepo sebelum apa pun membaca `process.env` —
 * lihat komentar identik di services/core-api/src/index.ts untuk
 * alasan lengkapnya (cwd `pnpm --filter` bukan root, ADR-005 di
 * produksi).
 */
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

/**
 * @pesona/notification — Modul 9 — push dan realtime.
 *
 * Diekstrak karena bursty dan IO-bound — harus dapat di-scale sendiri
 * saat broadcast massal tanpa ikut menggandakan core-api.
 *
 * ADR-006 pagar 5: push BUKAN jaminan pengiriman. Kotak masuk dalam
 * aplikasi adalah sumber kebenaran; push hanya petunjuk. Lihat
 * routes.ts untuk urutan tulis-kotak-masuk-dulu yang menegakkannya.
 *
 * Layanan internal: ClusterIP, TIDAK PERNAH diekspos ke internet.
 */

const SERVICE = 'notification';

export interface AppDeps {
  inbox?: InboxStore;
  devices?: DeviceStore;
  /** Diganti adaptor FCM/APNS/Web Push sungguhan belakangan — lihat push-client.ts. */
  push?: PushPort;
  now?: () => number;
}

function resolveDeps(deps: AppDeps): NotificationDeps {
  return {
    inbox: deps.inbox ?? new InMemoryInboxStore(),
    devices: deps.devices ?? new InMemoryDeviceStore(),
    push: deps.push ?? new NoopPushAdapter(),
    now: deps.now,
  };
}

export function createApp(deps: AppDeps = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'live', service: SERVICE });
  });

  app.get('/health/ready', (_req, res) => {
    // TODO Fase 1: cek koneksi Redis di sini.
    res.json({ status: 'ready', service: SERVICE });
  });

  registerNotificationRoutes(app, resolveDeps(deps));

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

export { InMemoryInboxStore, InMemoryDeviceStore } from './store.js';
export type { InboxStore, DeviceStore } from './store.js';
export { NoopPushAdapter } from './push-client.js';
export type { PushPort } from './push-client.js';
export { registerNotificationRoutes } from './routes.js';
export type { NotificationDeps } from './routes.js';
