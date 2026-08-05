import { money, type Money } from '@pesona/contracts';
import { OrderService, InvalidTransitionError, type OrderRecord } from './order-service.js';
import type { DispatchPort } from './dispatch-client.js';
import type { NotificationPort, NotifyInput } from './notification-client.js';

/**
 * Menjahit Order Lifecycle ke mesin Dispatch (modul 5) dan notification
 * (modul 9), keduanya layanan terpisah lewat HTTP.
 *
 * Tetap tipis dengan sengaja: aturan status hidup di OrderService /
 * ALLOWED_TRANSITIONS (@pesona/contracts), aturan matching hidup di mesin
 * dispatch, aturan kanal/prioritas hidup di domain/delivery.ts milik
 * notification. Berkas ini hanya urutan panggilan antar keduanya, plus
 * penanganan idempotensi lintas layanan — sesuatu yang tidak dibutuhkan
 * saat OrderService diuji sendirian.
 */

export interface OrderFlowDeps {
  orderService: OrderService;
  dispatch: DispatchPort;
  notification: NotificationPort;
}

export class OrderFlow {
  constructor(private readonly deps: OrderFlowDeps) {}

  /**
   * Dipanggil modul payment saat akuisitor mengonfirmasi pembayaran.
   *
   * PEMBAYARAN MENDAHULUI DISPATCH: order dulu naik ke PAID (JRN-P01),
   * baru dispatch dimulai. Kalau kandidat langsung habis, order dibatalkan
   * dengan refund penuh (JRN-P03) — tidak dibiarkan menggantung di
   * DISPATCHING tanpa driver dan tanpa kabar ke konsumen.
   *
   * Webhook akuisitor lazim dikirim ulang. Kalau order sudah melangkah
   * lebih jauh dari PAID saat callback ini tiba lagi (mis. sudah
   * DISPATCHING atau ASSIGNED), itu bukan galat — cukup kembalikan
   * keadaan sekarang tanpa memanggil dispatch dua kali.
   */
  async onPaymentConfirmed(orderId: string): Promise<OrderRecord> {
    let order: OrderRecord;
    try {
      order = await this.deps.orderService.markPaid(orderId);
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        const current = await this.deps.orderService.get(orderId);
        if (current) return current;
      }
      throw err;
    }

    if (order.status !== 'PAID') {
      // Sudah pernah diproses oleh panggilan sebelumnya.
      return order;
    }

    const dispatching = await this.deps.orderService.markDispatching(orderId);
    await this.notifyConsumer(dispatching, 'dispatching', {
      kind: 'ORDER_STATUS',
      title: 'Mencari driver',
      body: 'Pembayaran diterima. Sedang mencari driver terdekat untuk Anda.',
    });

    const outcome = await this.deps.dispatch.start({
      orderId: dispatching.id,
      pickup: dispatching.pickup,
    });

    if (outcome.state === 'EXHAUSTED') {
      return this.cancelAndNotify(orderId);
    }
    return dispatching;
  }

  /** Dipanggil layanan dispatch saat seorang driver menerima tawaran. */
  async onDriverAssigned(orderId: string, partnerId: string): Promise<OrderRecord> {
    const order = await this.deps.orderService.assign(orderId, partnerId);
    await this.notifyConsumer(order, 'assigned', {
      kind: 'ORDER_STATUS',
      title: 'Driver ditemukan',
      body: 'Driver sedang menuju lokasi jemput Anda.',
    });
    return order;
  }

  /** Dipanggil layanan dispatch saat seluruh kandidat habis tanpa ada yang menerima. */
  async onDispatchExhausted(orderId: string): Promise<OrderRecord> {
    return this.cancelAndNotify(orderId);
  }

  /** Mitra tap "mulai perjalanan". */
  async onTripStarted(orderId: string): Promise<OrderRecord> {
    const order = await this.deps.orderService.start(orderId);
    await this.notifyConsumer(order, 'in-progress', {
      kind: 'ORDER_STATUS',
      title: 'Perjalanan dimulai',
      body: 'Perjalanan Anda sedang berlangsung.',
    });
    return order;
  }

  /** Mitra tap "sampai" — JRN-P02, Dana Tertahan dipecah ke simpanan dan komisi. */
  async onTripCompleted(orderId: string): Promise<OrderRecord> {
    const order = await this.deps.orderService.complete(orderId);
    await this.notifyConsumer(order, 'completed', {
      kind: 'ORDER_STATUS',
      title: 'Perjalanan selesai',
      body: 'Terima kasih telah menggunakan Pesona.',
    });
    await this.notifyPartner(order, 'completed', {
      kind: 'ORDER_STATUS',
      title: 'Perjalanan selesai',
      body: 'Perjalanan selesai. Saldo Anda telah diperbarui.',
    });
    return order;
  }

  /** Pembatalan diminta lewat API (konsumen/mitra/CS). Server menentukan JRN-P03 vs JRN-P04, bukan klien. */
  async onOrderCancelled(orderId: string, cancellationFee: Money = money(0)): Promise<OrderRecord> {
    return this.cancelAndNotify(orderId, cancellationFee);
  }

  private async cancelAndNotify(orderId: string, cancellationFee: Money = money(0)): Promise<OrderRecord> {
    const order = await this.deps.orderService.cancel(orderId, cancellationFee);
    const berbiaya = order.status === 'CANCELLED_FEE';
    await this.notifyConsumer(order, 'cancelled', {
      kind: 'ORDER_STATUS',
      title: 'Pesanan dibatalkan',
      body: berbiaya
        ? 'Pesanan dibatalkan. Sebagian dana dikenakan biaya pembatalan.'
        : 'Pesanan dibatalkan. Dana Anda dikembalikan penuh.',
    });
    await this.notifyPartner(order, 'cancelled', {
      kind: 'ORDER_STATUS',
      title: 'Pesanan dibatalkan',
      body: 'Order ini dibatalkan.',
    });
    return order;
  }

  /**
   * Konsumen TIDAK wajib jadi anggota koperasi (`consumerId: string |
   * null`) — beda dari mitra, yang selalu anggota begitu ditugaskan.
   * Order tanpa akun konsumen tidak punya siapa pun untuk diberi tahu;
   * itu bukan galat, jadi cukup dilewati diam-diam di sini, BUKAN di
   * layanan notification (yang tidak tahu apa-apa soal keanggotaan).
   */
  private async notifyConsumer(
    order: OrderRecord,
    event: string,
    msg: Pick<NotifyInput, 'kind' | 'title' | 'body' | 'data'>,
  ): Promise<void> {
    if (!order.consumerId) return;
    await this.send({
      dedupeKey: `${order.id}:consumer:${event}`,
      recipientId: order.consumerId,
      ...msg,
    });
  }

  private async notifyPartner(
    order: OrderRecord,
    event: string,
    msg: Pick<NotifyInput, 'kind' | 'title' | 'body' | 'data'>,
  ): Promise<void> {
    if (!order.partnerId) return;
    await this.send({
      dedupeKey: `${order.id}:partner:${event}`,
      recipientId: order.partnerId,
      ...msg,
    });
  }

  /**
   * `dedupeKey` per order+event membuat panggilan berulang (webhook
   * akuisitor dikirim ulang, retry HTTP dari dispatch) aman — layanan
   * notification sendiri yang menolak kunci kembar (lihat
   * dedupeKeysForRecipient() di routes.ts-nya), jadi OrderFlow tidak
   * perlu melacak status "sudah diberi tahu atau belum" sendiri.
   *
   * Galat pengiriman notifikasi TIDAK dilempar ulang: order sudah sah
   * berpindah status sebelum baris ini dipanggil, dan push bukan
   * jaminan pengiriman (ADR-006 pagar 5) — kegagalan di sini paling
   * buruk berarti pengguna terlambat tahu, bukan data order yang rusak.
   */
  private async send(input: NotifyInput): Promise<void> {
    try {
      await this.deps.notification.send(input);
    } catch (err) {
      console.error('[order] gagal mengirim notifikasi', input.dedupeKey, err);
    }
  }
}
