import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { InboxStore, DeviceStore } from './store.js';
import type { PushPort } from './push-client.js';
import type { DeliveryOutcome, NotificationMessage } from './domain/types.js';
import { defaultExpiryFor, planDelivery, priorityFor, toInboxEntry } from './domain/delivery.js';

/**
 * Handler HTTP notification — modul 9.
 *
 * Handler tipis, seluruh aturan (kanal, dedup, kedaluwarsa, prioritas)
 * di domain/delivery.ts. Satu urutan yang TIDAK BOLEH dibalik di sini:
 * tulis kotak masuk dulu, baru coba push (ADR-006 pagar 5) — lihat
 * komentar panjang di POST /internal/notifications/send.
 */

const SendBody = z.object({
  dedupeKey: z.string().min(1),
  recipientId: z.string().min(1),
  kind: z.enum([
    'DISPATCH_OFFER',
    'ORDER_STATUS',
    'PAYMENT_RECEIVED',
    'PAYOUT_SETTLED',
    'CHAT_MESSAGE',
    'ANNOUNCEMENT',
  ]),
  title: z.string().min(1),
  body: z.string().min(1),
  data: z.record(z.string(), z.string()).optional(),
  /** Jarang perlu diisi manual — default sekarang, dan kadaluwarsa
   *  dihitung dari `kind` lewat defaultExpiryFor() bila tidak disetel. */
  createdAt: z.number().optional(),
  expiresAt: z.number().nullable().optional(),
});

const RegisterDeviceBody = z.object({
  deviceId: z.string().min(1),
  recipientId: z.string().min(1),
  shell: z.enum(['browser', 'pwa', 'native-webview']),
  platform: z.enum(['ios', 'android', 'web']),
  pushToken: z.string().nullable().default(null),
});

function recipientIdOf(req: Request): string | null {
  const raw = req.header('X-Pesona-Recipient-Id');
  return raw && raw.length > 0 ? raw : null;
}

function unauthorized(res: Response): void {
  res
    .status(401)
    .json({ error: { code: 'UNAUTHENTICATED', message: 'Identitas penerima tidak ada' } });
}

export interface NotificationDeps {
  inbox: InboxStore;
  devices: DeviceStore;
  push: PushPort;
  now?: () => number;
}

export function registerNotificationRoutes(app: Express, deps: NotificationDeps): void {
  const now = deps.now ?? (() => Date.now());
  const { inbox, devices, push } = deps;

  /** Dipanggil core-api (lewat NotificationPort) untuk setiap kejadian yang perlu diberitahukan. */
  app.post('/internal/notifications/send', (req, res) => {
    void (async () => {
      const parsed = SendBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'Bentuk permintaan tidak sah' },
        });
      }

      const createdAt = parsed.data.createdAt ?? now();
      const message: NotificationMessage = {
        dedupeKey: parsed.data.dedupeKey,
        recipientId: parsed.data.recipientId,
        kind: parsed.data.kind,
        priority: priorityFor(parsed.data.kind),
        title: parsed.data.title,
        body: parsed.data.body,
        data: parsed.data.data,
        createdAt,
        expiresAt:
          parsed.data.expiresAt !== undefined
            ? parsed.data.expiresAt
            : defaultExpiryFor(parsed.data.kind, createdAt),
      };

      const existingKeys = await inbox.dedupeKeysForRecipient(message.recipientId);
      if (existingKeys.has(message.dedupeKey)) {
        // Kembar: sudah pernah ditulis, jangan tulis ulang, jangan
        // dorong ulang. Ini yang membuat retry pemanggil (core-api)
        // aman untuk dicoba berkali-kali.
        const skipped: DeliveryOutcome = 'SKIPPED_DUPLICATE';
        return res.json({ data: { messageWritten: false, deliveries: [{ outcome: skipped }] } });
      }

      // WAJIB terjadi sebelum percobaan push apa pun — lihat ADR-006
      // pagar 5 di domain/types.ts. Kalau baris ini gagal (melempar),
      // handler di bawah (lihat index.ts) mengembalikan 500 dan
      // TIDAK ADA push yang dicoba sama sekali.
      await inbox.append(message.recipientId, toInboxEntry(message));

      const recipientDevices = await devices.listForRecipient(message.recipientId);

      if (recipientDevices.length === 0) {
        // Konsumen non-anggota atau siapa pun tanpa perangkat terdaftar:
        // pesannya tetap ada di kotak masuk (di atas), hanya tidak ada
        // tujuan untuk didorong. Bukan galat.
        return res.json({ data: { messageWritten: true, deliveries: [] } });
      }

      const deliveries = await Promise.all(
        recipientDevices.map(async (device) => {
          const plan = planDelivery(message, device, existingKeys, now());
          if (plan.outcome !== null) {
            return { deviceId: device.deviceId, channel: plan.channel, outcome: plan.outcome };
          }
          // TODO fase 2: antrean retry sungguhan dengan retryDelayMs()/
          // shouldRetry() dari domain/delivery.ts. Fase 1 mencoba sekali;
          // kegagalan tercatat di respons, pesan tetap aman di kotak masuk.
          const outcome = await push.send(device, message, plan.channel);
          return { deviceId: device.deviceId, channel: plan.channel, outcome };
        }),
      );

      res.json({ data: { messageWritten: true, deliveries } });
    })();
  });

  app.post('/api/devices/register', (req, res) => {
    void (async () => {
      const parsed = RegisterDeviceBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'Bentuk permintaan tidak sah' },
        });
      }

      await devices.register({ ...parsed.data, lastSeenAt: now() });
      res.json({ data: { registered: true } });
    })();
  });

  app.get('/api/notifications/inbox', (req, res) => {
    void (async () => {
      const recipientId = recipientIdOf(req);
      if (!recipientId) return unauthorized(res);

      const entries = await inbox.listForRecipient(recipientId);
      res.json({ data: entries });
    })();
  });

  /** `:id` adalah dedupeKey — kotak masuk tidak punya id terpisah. */
  app.post('/api/notifications/:id/read', (req, res) => {
    void (async () => {
      const recipientId = recipientIdOf(req);
      if (!recipientId) return unauthorized(res);

      const dedupeKey = req.params.id ?? '';
      const found = await inbox.markRead(recipientId, dedupeKey, now());
      if (!found) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notifikasi tidak ditemukan' } });
      }
      res.json({ data: { acknowledged: true } });
    })();
  });
}
