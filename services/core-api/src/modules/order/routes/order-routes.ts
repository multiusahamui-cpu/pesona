import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { money, OrderVerticalSchema } from '@pesona/contracts';
import { OrderService, InvalidTransitionError } from '../service/order-service.js';
import type { OrderFlow } from '../service/order-flow.js';

/**
 * Handler HTTP modul 6 — Order Lifecycle.
 *
 * Sama seperti location dan dispatch: handler tipis, seluruh aturan ada
 * di service/. Rute /internal/* dipanggil layanan lain (dispatch), tidak
 * pernah dari internet.
 */

const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const CreateOrderBody = z.object({
  id: z.string().min(1),
  vertical: OrderVerticalSchema,
  consumerId: z.string().nullable(),
  grossFare: z.number().int().positive(),
  pickup: LatLng,
  dropoff: LatLng,
});

const AssignBody = z.object({ partnerId: z.string().min(1) });
const CancelBody = z.object({ cancellationFee: z.number().int().nonnegative().optional() });

function badRequest(res: Response, message = 'Bentuk permintaan tidak sah'): void {
  res.status(400).json({ error: { code: 'VALIDATION_FAILED', message } });
}

function notFound(res: Response, orderId: string): void {
  res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: `Order tidak ditemukan: ${orderId}` } });
}

function conflict(res: Response, err: InvalidTransitionError): void {
  res.status(409).json({ error: { code: 'INVALID_TRANSITION', message: err.message } });
}

/**
 * Membungkus handler async supaya galat tak terduga tetap jadi 500 dengan
 * respons JSON, bukan promise yang gagal diam-diam atau proses macet.
 */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    void fn(req, res).catch((err: unknown) => {
      if (err instanceof InvalidTransitionError) return conflict(res, err);
      if (err instanceof Error && err.message.startsWith('Order tidak ditemukan')) {
        return notFound(res, req.params.orderId);
      }
      console.error('[order] galat tak terduga', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Kesalahan internal' } });
    });
  };
}

export interface OrderRoutesDeps {
  orderService: OrderService;
  orderFlow: OrderFlow;
}

export function registerOrderRoutes(app: Express, deps: OrderRoutesDeps): void {
  const { orderService, orderFlow } = deps;

  app.post(
    '/api/orders',
    handle(async (req, res) => {
      const parsed = CreateOrderBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res);

      const order = await orderService.create({
        id: parsed.data.id,
        vertical: parsed.data.vertical,
        consumerId: parsed.data.consumerId,
        grossFare: money(parsed.data.grossFare),
        pickup: parsed.data.pickup,
        dropoff: parsed.data.dropoff,
      });
      res.status(201).json({ data: order });
    }),
  );

  app.get(
    '/api/orders/:orderId',
    handle(async (req, res) => {
      const order = await orderService.get(req.params.orderId);
      if (!order) return notFound(res, req.params.orderId);
      res.json({ data: order });
    }),
  );

  /** Dipanggil modul payment saat akuisitor mengonfirmasi pembayaran (JRN-P01 + mulai dispatch). */
  app.post(
    '/internal/payments/:orderId/confirmed',
    handle(async (req, res) => {
      const order = await orderFlow.onPaymentConfirmed(req.params.orderId);
      res.json({ data: order });
    }),
  );

  /** Dipanggil layanan dispatch saat seorang driver menerima tawaran. */
  app.post(
    '/internal/orders/:orderId/assign',
    handle(async (req, res) => {
      const parsed = AssignBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res);
      const order = await orderFlow.onDriverAssigned(req.params.orderId, parsed.data.partnerId);
      res.json({ data: order });
    }),
  );

  /** Dipanggil layanan dispatch saat seluruh kandidat habis tanpa ada yang menerima. */
  app.post(
    '/internal/orders/:orderId/dispatch-exhausted',
    handle(async (req, res) => {
      const order = await orderFlow.onDispatchExhausted(req.params.orderId);
      res.json({ data: order });
    }),
  );

  /** Mitra tap "mulai perjalanan". */
  app.post(
    '/internal/orders/:orderId/start',
    handle(async (req, res) => {
      const order = await orderFlow.onTripStarted(req.params.orderId);
      res.json({ data: order });
    }),
  );

  /** Mitra tap "sampai" — memicu JRN-P02, Dana Tertahan dipecah. */
  app.post(
    '/internal/orders/:orderId/complete',
    handle(async (req, res) => {
      const order = await orderFlow.onTripCompleted(req.params.orderId);
      res.json({ data: order });
    }),
  );

  /** Pembatalan. Server yang menentukan JRN-P03 vs JRN-P04, bukan klien. */
  app.post(
    '/internal/orders/:orderId/cancel',
    handle(async (req, res) => {
      const parsed = CancelBody.safeParse(req.body ?? {});
      if (!parsed.success) return badRequest(res);

      const order =
        parsed.data.cancellationFee !== undefined
          ? await orderFlow.onOrderCancelled(req.params.orderId, money(parsed.data.cancellationFee))
          : await orderFlow.onOrderCancelled(req.params.orderId);
      res.json({ data: order });
    }),
  );
}
