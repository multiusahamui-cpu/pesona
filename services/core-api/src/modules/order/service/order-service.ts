import {
  canTransition,
  money,
  type Money,
  type OrderStatus,
  type OrderVertical,
} from '@pesona/contracts';
import {
  computeAmounts,
  journalPaymentReceived,
  journalOrderCompleted,
  journalFullRefund,
  journalPartialRefund,
  type Ledger,
  type OrderAmounts,
} from '../../escrow-settlement/index.js';

/**
 * Modul 6 — Order Lifecycle.
 *
 * State machine-nya sendiri hidup di @pesona/contracts supaya klien dan
 * server memakai definisi yang sama persis. Berkas ini yang menegakkannya
 * dan menyambungkannya ke jurnal.
 *
 * Aturan yang tidak boleh dilanggar: PEMBAYARAN MENDAHULUI DISPATCH.
 * QRIS dinamis kedaluwarsa dalam 10-15 menit; kalau pembayaran diletakkan
 * setelah driver ditemukan, QR bisa mati saat menunggu driver menjawab.
 */

export interface OrderRecord {
  id: string;
  vertical: OrderVertical;
  status: OrderStatus;
  consumerId: string | null;
  partnerId: string | null;
  amounts: OrderAmounts;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  createdAt: number;
  updatedAt: number;
}

export class InvalidTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Transisi order tidak sah: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export interface OrderRepo {
  get(id: string): Promise<OrderRecord | null>;
  put(order: OrderRecord): Promise<void>;
}

export class InMemoryOrderRepo implements OrderRepo {
  private orders = new Map<string, OrderRecord>();
  async get(id: string): Promise<OrderRecord | null> {
    return this.orders.get(id) ?? null;
  }
  async put(order: OrderRecord): Promise<void> {
    this.orders.set(order.id, order);
  }
  clear(): void {
    this.orders.clear();
  }
}

export interface OrderServiceDeps {
  repo: OrderRepo;
  ledger: Ledger;
  now?: () => number;
  mdrPerMille?: number;
  partnerSharePerMille?: number;
}

export class OrderService {
  private readonly now: () => number;
  private readonly mdrPerMille: number;
  private readonly partnerSharePerMille: number;

  constructor(private readonly deps: OrderServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    // MDR QRIS untuk usaha besar: 0,7% = 7 per mille.
    this.mdrPerMille = deps.mdrPerMille ?? 7;
    // Bagian mitra 85% dari tarif kotor.
    this.partnerSharePerMille = deps.partnerSharePerMille ?? 850;
  }

  private transition(order: OrderRecord, to: OrderStatus): OrderRecord {
    if (!canTransition(order.status, to)) {
      throw new InvalidTransitionError(order.status, to);
    }
    return { ...order, status: to, updatedAt: this.now() };
  }

  async create(input: {
    id: string;
    vertical: OrderVertical;
    consumerId: string | null;
    grossFare: Money;
    pickup: { lat: number; lng: number };
    dropoff: { lat: number; lng: number };
  }): Promise<OrderRecord> {
    // Idempoten: order dengan id sama tidak dibuat dua kali.
    const existing = await this.deps.repo.get(input.id);
    if (existing) return existing;

    const t = this.now();
    const amounts = computeAmounts(
      input.grossFare,
      this.mdrPerMille,
      this.partnerSharePerMille,
    );

    const order: OrderRecord = {
      id: input.id,
      vertical: input.vertical,
      status: 'AWAITING_PAYMENT',
      consumerId: input.consumerId,
      partnerId: null,
      amounts,
      pickup: input.pickup,
      dropoff: input.dropoff,
      createdAt: t,
      updatedAt: t,
    };

    await this.deps.repo.put(order);
    return order;
  }

  /** Notifikasi akuisitor diterima: JRN-P01, order naik ke PAID. */
  async markPaid(orderId: string): Promise<OrderRecord> {
    const order = await this.require(orderId);
    // Idempoten: callback akuisitor lazim dikirim ulang.
    if (order.status === 'PAID') return order;

    const next = this.transition(order, 'PAID');
    await this.deps.ledger.post(journalPaymentReceived(order.id, order.amounts, this.now()));
    await this.deps.repo.put(next);
    return next;
  }

  async markDispatching(orderId: string): Promise<OrderRecord> {
    const order = await this.require(orderId);
    if (order.status === 'DISPATCHING') return order;
    const next = this.transition(order, 'DISPATCHING');
    await this.deps.repo.put(next);
    return next;
  }

  async assign(orderId: string, partnerId: string): Promise<OrderRecord> {
    const order = await this.require(orderId);
    if (order.status === 'ASSIGNED' && order.partnerId === partnerId) return order;
    const next = { ...this.transition(order, 'ASSIGNED'), partnerId };
    await this.deps.repo.put(next);
    return next;
  }

  async start(orderId: string): Promise<OrderRecord> {
    const order = await this.require(orderId);
    if (order.status === 'IN_PROGRESS') return order;
    const next = this.transition(order, 'IN_PROGRESS');
    await this.deps.repo.put(next);
    return next;
  }

  /** Tap sampai: JRN-P02, Dana Tertahan dipecah ke simpanan dan komisi. */
  async complete(orderId: string): Promise<OrderRecord> {
    const order = await this.require(orderId);
    if (order.status === 'COMPLETED') return order;
    if (!order.partnerId) {
      throw new Error(`Order ${orderId} tidak punya mitra, tidak bisa diselesaikan`);
    }

    const next = this.transition(order, 'COMPLETED');
    await this.deps.ledger.post(
      journalOrderCompleted(order.id, order.partnerId, order.amounts, this.now()),
    );
    await this.deps.repo.put(next);
    return next;
  }

  /**
   * Pembatalan. Server yang menentukan JRN-P03 atau JRN-P04 berdasarkan
   * status order saat dibatalkan — bukan klien.
   */
  async cancel(
    orderId: string,
    cancellationFee: Money = money(0),
  ): Promise<OrderRecord> {
    const order = await this.require(orderId);
    if (order.status === 'CANCELLED' || order.status === 'CANCELLED_FEE') return order;

    const belumBayar = order.status === 'DRAFT' || order.status === 'AWAITING_PAYMENT';
    if (belumBayar) {
      const next = this.transition(order, 'CANCELLED');
      await this.deps.repo.put(next);
      return next;
    }

    const sudahJalan = order.status === 'ASSIGNED' || order.status === 'IN_PROGRESS';
    if (sudahJalan && cancellationFee > 0 && order.partnerId) {
      const next = this.transition(order, 'CANCELLED_FEE');
      const bagianMitra = money(Math.floor(cancellationFee * 0.8));
      await this.deps.ledger.post(
        journalPartialRefund(
          order.id,
          order.partnerId,
          order.amounts,
          { partner: bagianMitra, platform: money(cancellationFee - bagianMitra) },
          this.now(),
        ),
      );
      await this.deps.repo.put(next);
      return next;
    }

    const next = this.transition(order, 'CANCELLED');
    await this.deps.ledger.post(journalFullRefund(order.id, order.amounts, this.now()));
    await this.deps.repo.put(next);
    return next;
  }

  /** Baca murni, tanpa efek samping. Dipakai handler HTTP dan orkestrasi lintas layanan. */
  async get(orderId: string): Promise<OrderRecord | null> {
    return this.deps.repo.get(orderId);
  }

  private async require(orderId: string): Promise<OrderRecord> {
    const order = await this.deps.repo.get(orderId);
    if (!order) throw new Error(`Order tidak ditemukan: ${orderId}`);
    return order;
  }
}
