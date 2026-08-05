/**
 * Registri endpoint irisan vertikal pertama: satu order ojek, ujung ke ujung.
 *
 * Sepuluh langkah yang dibuktikan irisan ini:
 *   1  login              — Identity (modul 1)
 *   2  routePreview       — Geo (modul 3)
 *   3  quote              — Pricing (modul 7)
 *   4  createOrder        — Order (modul 6)
 *   5  issuePayment       — Escrow (modul 13), JRN-P01 via acquirerWebhook
 *   6  setPresence        — Supply State (modul 4)
 *   7  acceptOffer        — Dispatch (modul 5)
 *   8  startOrder/complete— Order (modul 6)
 *   9  (alokasi otomatis) — Escrow (modul 13), JRN-P02
 *  10  reconciliation     — Escrow (modul 13), gerbang
 */

import * as auth from './auth.js';
import * as geo from './geo.js';
import * as pricing from './pricing.js';
import * as order from './order.js';
import * as escrow from './escrow.js';
import * as location from './location.js';
import * as dispatch from './dispatch.js';
import type { EndpointDef } from './_endpoint.js';

export * from './_endpoint.js';
export { auth, geo, pricing, order, escrow, location, dispatch };

export const rideSliceEndpoints = {
  'auth.login': auth.login,
  'auth.me': auth.me,
  'geo.routePreview': geo.routePreview,
  'pricing.quote': pricing.quote,
  'order.create': order.createOrder,
  'order.get': order.getOrder,
  'order.start': order.startOrder,
  'order.complete': order.completeOrder,
  'order.cancel': order.cancelOrder,
  'escrow.issuePayment': escrow.issuePayment,
  'escrow.acquirerWebhook': escrow.acquirerWebhook,
  'escrow.reconciliation': escrow.reconciliationSnapshot,
  'location.setPresence': location.setPresence,
  'location.pushPositions': location.pushPositions,
  'dispatch.currentOffer': dispatch.currentOffer,
  'dispatch.acceptOffer': dispatch.acceptOffer,
  'dispatch.rejectOffer': dispatch.rejectOffer,
  'dispatch.expireOffer': dispatch.expireOffer,
} as const satisfies Record<string, EndpointDef>;

export type EndpointName = keyof typeof rideSliceEndpoints;
