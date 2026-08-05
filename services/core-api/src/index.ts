import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express from 'express';
import { loadEnv } from './platform/env.js';
import { registerHealthRoutes } from './platform/health.js';
import { createDb, type Db } from './platform/db.js';
import {
  OrderService,
  InMemoryOrderRepo,
  DrizzleOrderRepo,
  OrderFlow,
  HttpDispatchClient,
  StaticDispatchClient,
  HttpNotificationClient,
  StaticNotificationClient,
  registerOrderRoutes,
  type OrderRepo,
  type DispatchPort,
  type NotificationPort,
} from './modules/order/index.js';
import {
  InMemoryLedger,
  DrizzleLedger,
  type Ledger,
} from './modules/escrow-settlement/index.js';

/**
 * Muat `.env` root monorepo SEBELUM apa pun membaca `process.env` —
 * termasuk `loadEnv()` di bawah dan `process.env.DATABASE_URL` /
 * `DISPATCH_URL` yang dibaca lazy di dalam `createApp()`. Path dihitung
 * dari lokasi berkas ini (bukan `process.cwd()`) supaya tetap benar
 * baik dijalankan lewat `pnpm --filter @pesona/core-api dev` (cwd =
 * folder paket ini) maupun dari root. Di produksi berkas `.env` tidak
 * ada (ADR-005) — `loadDotenv()` diam-diam tidak melakukan apa-apa
 * kalau filenya tidak ditemukan, bukan melempar galat.
 */
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

/**
 * @pesona/core-api — modular monolith.
 *
 * Sebelas modul domain hidup di src/modules/, masing-masing dengan
 * index.ts sebagai satu-satunya permukaan publiknya. Berkas ini adalah
 * agregator: ia memanggil registrar tiap modul, tidak memuat logika
 * bisnis sendiri.
 *
 * Pelajaran dari garuda: routes.ts di sana sempat mencapai 14.389 baris
 * karena agregator perlahan diisi logika. Jangan ulangi — kalau sebuah
 * endpoint terasa "tidak masuk modul mana pun", itu tanda modulnya belum
 * ada, bukan tanda ia boleh tinggal di sini.
 */

const SERVICE = 'core-api';

export interface AppDeps {
  /** Diganti DrizzleOrderRepo otomatis bila DATABASE_URL disetel dan tidak disuntik di sini. */
  repo?: OrderRepo;
  /** Diganti DrizzleLedger otomatis bila DATABASE_URL disetel dan tidak disuntik di sini. */
  ledger?: Ledger;
  /** Diganti HttpDispatchClient otomatis bila DISPATCH_URL disetel. */
  dispatch?: DispatchPort;
  /** Diganti HttpNotificationClient otomatis bila NOTIFICATION_URL disetel. */
  notification?: NotificationPort;
  now?: () => number;
}

export function createApp(deps: AppDeps = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerHealthRoutes(app, { serviceName: SERVICE });

  // Satu Pool dipakai bersama repo dan ledger kalau keduanya perlu
  // Postgres — dibuat sekali, malas (lazy), dan hanya kalau memang
  // dibutuhkan (tidak ada gunanya membuka koneksi DB di tes yang
  // menyuntik repo/ledger in-memory sendiri).
  let db: Db | undefined;
  function getDb(): Db {
    if (!db) {
      if (!process.env.DATABASE_URL) {
        throw new Error(
          'DATABASE_URL tidak disetel — tidak bisa membuat koneksi Postgres untuk core-api',
        );
      }
      db = createDb(process.env.DATABASE_URL);
    }
    return db;
  }

  const repo =
    deps.repo ?? (process.env.DATABASE_URL ? new DrizzleOrderRepo(getDb()) : new InMemoryOrderRepo());
  const ledger =
    deps.ledger ?? (process.env.DATABASE_URL ? new DrizzleLedger(getDb()) : new InMemoryLedger());
  const dispatch =
    deps.dispatch ??
    (process.env.DISPATCH_URL
      ? new HttpDispatchClient(process.env.DISPATCH_URL)
      : new StaticDispatchClient());
  const notification =
    deps.notification ??
    (process.env.NOTIFICATION_URL
      ? new HttpNotificationClient(process.env.NOTIFICATION_URL)
      : new StaticNotificationClient());

  const orderService = new OrderService({ repo, ledger, now: deps.now });
  const orderFlow = new OrderFlow({ orderService, dispatch, notification });

  registerOrderRoutes(app, { orderService, orderFlow });

  // Fase 1 — registrar modul lain didaftarkan di sini:
  // registerIdentityRoutes(app);
  // registerEscrowSettlementRoutes(app);

  return app;
}

export function start(): void {
  const env = loadEnv();
  const app = createApp();
  app.listen(env.PORT, () => {
    console.warn(`[${SERVICE}] mendengarkan di port ${env.PORT} (${env.NODE_ENV})`);
  });
}

// Hanya menyala bila dijalankan langsung, bukan saat diimpor tes.
if (process.argv[1]?.endsWith('index.js')) {
  start();
}
