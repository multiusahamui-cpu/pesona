/**
 * Modul 6 — Order Lifecycle
 *
 * KONTRAK PUBLIK MODUL INI.
 * Modul lain HANYA boleh mengimpor dari berkas ini.
 */

export { OrderService, InMemoryOrderRepo, InvalidTransitionError } from './service/order-service.js';
export type { OrderRecord, OrderRepo, OrderServiceDeps } from './service/order-service.js';

export { DrizzleOrderRepo } from './repo/drizzle-order-repo.js';

export { OrderFlow } from './service/order-flow.js';
export type { OrderFlowDeps } from './service/order-flow.js';

export { HttpDispatchClient, StaticDispatchClient } from './service/dispatch-client.js';
export type { DispatchPort, DispatchStartInput, DispatchStartResult } from './service/dispatch-client.js';

export { HttpNotificationClient, StaticNotificationClient } from './service/notification-client.js';
export type { NotificationPort, NotifyInput, NotificationKind } from './service/notification-client.js';

export { registerOrderRoutes } from './routes/order-routes.js';
export type { OrderRoutesDeps } from './routes/order-routes.js';
