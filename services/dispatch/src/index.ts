import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express from 'express';
import { loadEnv } from './platform/env.js';
import { registerDispatchRoutes, InMemorySessionStore, type SessionStore } from './routes.js';
import { HttpSupplyClient, StaticSupplyClient, type SupplyPort } from './supply-client.js';
import { HttpOrderClient, RecordingOrderClient, type OrderPort } from './order-client.js';
import { startExpirySweeper, type Sweeper } from './scheduler.js';

/**
 * Muat `.env` root monorepo sebelum apa pun membaca `process.env` —
 * lihat komentar identik di services/core-api/src/index.ts untuk
 * alasan lengkapnya (cwd `pnpm --filter` bukan root, ADR-005 di
 * produksi).
 */
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

/**
 * @pesona/dispatch — Modul 5, matching engine.
 *
 * Inilah yang membedakan ride-hailing dari pencatatan perjalanan. Di
 * garuda tidak ada padanannya: PATCH /api/rides/:id hanya mengubah status
 * secara manual, tanpa broadcast, tanpa terima/tolak, tanpa kedaluwarsa,
 * tanpa penugasan ulang.
 *
 * Diekstrak dari core-api karena stateful: indeks geo in-memory, target
 * latensi di bawah 100 ms, dan butuh partisi sticky per zona.
 *
 * Layanan internal: ClusterIP, TIDAK PERNAH diekspos ke internet.
 */

const SERVICE = 'dispatch';

export interface AppDeps {
  store?: SessionStore;
  supply?: SupplyPort;
  /** Diganti HttpOrderClient otomatis bila CORE_API_URL disetel. */
  orders?: OrderPort;
  now?: () => number;
  newOfferId?: () => string;
  onAssigned?: (orderId: string, partnerId: string) => void | Promise<void>;
  onExhausted?: (orderId: string) => void | Promise<void>;
}

interface ResolvedDeps {
  store: SessionStore;
  supply: SupplyPort;
  orders: OrderPort;
  now?: () => number;
  newOfferId?: () => string;
  onAssigned: (orderId: string, partnerId: string) => void | Promise<void>;
  onExhausted: (orderId: string) => void | Promise<void>;
}

/**
 * Menyatukan aturan default sekali saja, supaya `createApp()` (dipakai
 * Express) dan `start()` (yang juga perlu `store`/`onExhausted` yang
 * SAMA persis untuk menyalakan scheduler) tidak pernah bisa berbeda.
 */
function resolveDeps(deps: AppDeps): ResolvedDeps {
  const store = deps.store ?? new InMemorySessionStore();
  const supply =
    deps.supply ??
    (process.env.LOCATION_URL
      ? new HttpSupplyClient(process.env.LOCATION_URL)
      : new StaticSupplyClient());
  const orders =
    deps.orders ??
    (process.env.CORE_API_URL
      ? new HttpOrderClient(process.env.CORE_API_URL)
      : new RecordingOrderClient());

  return {
    store,
    supply,
    orders,
    now: deps.now,
    newOfferId: deps.newOfferId,
    // deps.onAssigned/onExhausted (bila dipasok tes) menang atas orders —
    // supaya tes lama yang memasang callback langsung tetap jalan tanpa
    // perubahan.
    onAssigned: deps.onAssigned ?? ((orderId, partnerId) => orders.notifyAssigned(orderId, partnerId)),
    onExhausted: deps.onExhausted ?? ((orderId) => orders.notifyExhausted(orderId)),
  };
}

export function createApp(deps: AppDeps = {}, resolved: ResolvedDeps = resolveDeps(deps)) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'live', service: SERVICE });
  });

  app.get('/health/ready', (_req, res) => {
    res.json({ status: 'ready', service: SERVICE });
  });

  registerDispatchRoutes(app, resolved);

  return app;
}

export function start(): void {
  const env = loadEnv();
  const resolved = resolveDeps({});
  const app = createApp({}, resolved);

  const sweeper: Sweeper = startExpirySweeper({
    store: resolved.store,
    now: resolved.now,
    newOfferId: resolved.newOfferId,
    onExhausted: resolved.onExhausted,
  });

  const server = app.listen(env.PORT, () => {
    console.warn(`[${SERVICE}] mendengarkan di port ${env.PORT} (${env.NODE_ENV})`);
  });

  // Berhenti rapi: sesi ride-hailing di tengah sapuan tidak boleh
  // ditinggal menggantung karena proses dibunuh mendadak.
  const shutdown = (): void => {
    sweeper.stop();
    server.close(() => {
      console.warn(`[${SERVICE}] berhenti`);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1]?.endsWith('index.js')) {
  start();
}

export { InMemorySessionStore } from './routes.js';
export { StaticSupplyClient, HttpSupplyClient } from './supply-client.js';
export { HttpOrderClient, RecordingOrderClient } from './order-client.js';
export { startExpirySweeper, sweepOnce } from './scheduler.js';
export type { SessionStore } from './routes.js';
export type { SupplyPort } from './supply-client.js';
export type { OrderPort } from './order-client.js';
export type { Sweeper, SchedulerDeps } from './scheduler.js';
