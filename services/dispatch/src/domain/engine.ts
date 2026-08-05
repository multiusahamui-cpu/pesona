import type {
  DispatchPolicy,
  DispatchSession,
  DriverCandidate,
  LatLng,
  Offer,
  RankedCandidate,
} from './types.js';
import { DEFAULT_POLICY } from './types.js';
import { rankCandidates } from './ranking.js';

/**
 * Mesin dispatch — modul 5.
 *
 * Inilah yang membedakan ride-hailing dari pencatatan perjalanan. Di
 * garuda tidak ada padanannya: `PATCH /api/rides/:id` hanya mengubah
 * status secara manual, tanpa broadcast, tanpa terima/tolak, tanpa
 * kedaluwarsa, tanpa penugasan ulang.
 *
 * Seluruh fungsi di sini MURNI. Sesi masuk, sesi baru keluar. Waktu
 * dipasok pemanggil. Tidak ada Redis, tidak ada HTTP, tidak ada
 * `Date.now()` tersembunyi — sehingga balapan dan kedaluwarsa bisa diuji
 * secara pasti, bukan dengan menunggu.
 */

export interface OfferIdGenerator {
  (): string;
}

export type AcceptOutcome =
  | { result: 'ASSIGNED'; session: DispatchSession; orderId: string }
  | { result: 'OFFER_TAKEN'; session: DispatchSession }
  | { result: 'OFFER_EXPIRED'; session: DispatchSession }
  | { result: 'OFFER_UNKNOWN'; session: DispatchSession };

/** Buat sesi dispatch untuk sebuah order dan langsung tawarkan gelombang pertama. */
export function startDispatch(input: {
  orderId: string;
  pickup: LatLng;
  candidates: readonly DriverCandidate[];
  now: number;
  newOfferId: OfferIdGenerator;
  policy?: DispatchPolicy;
}): DispatchSession {
  const policy = input.policy ?? DEFAULT_POLICY;
  const queue = rankCandidates(input.candidates, input.pickup, input.now, policy);

  const session: DispatchSession = {
    orderId: input.orderId,
    pickup: input.pickup,
    state: 'SEARCHING',
    queue,
    offers: [],
    wave: 0,
    assignedTo: null,
  };

  return openNextWave(session, input.now, input.newOfferId, policy);
}

/**
 * Buka gelombang berikutnya.
 *
 * Kandidat habis atau batas gelombang tercapai menghasilkan EXHAUSTED —
 * dan pemanggil harus membatalkan ordernya. Sesi tidak boleh menggantung
 * dalam SEARCHING tanpa tawaran aktif; kalau itu terjadi, konsumen
 * menunggu selamanya tanpa kabar.
 */
export function openNextWave(
  session: DispatchSession,
  now: number,
  newOfferId: OfferIdGenerator,
  policy: DispatchPolicy = DEFAULT_POLICY,
): DispatchSession {
  if (session.state !== 'SEARCHING') return session;

  if (session.wave >= policy.maxWaves || session.queue.length === 0) {
    return { ...session, state: 'EXHAUSTED' };
  }

  const batch = session.queue.slice(0, policy.waveSize);
  const wave = session.wave + 1;
  const expiresAt = now + policy.offerTtlSeconds * 1000;

  const offers: Offer[] = batch.map((c: RankedCandidate) => ({
    offerId: newOfferId(),
    orderId: session.orderId,
    partnerId: c.partnerId,
    state: 'PENDING',
    wave,
    createdAt: now,
    expiresAt,
  }));

  return {
    ...session,
    wave,
    queue: session.queue.slice(policy.waveSize),
    offers: [...session.offers, ...offers],
  };
}

function findOffer(session: DispatchSession, offerId: string): Offer | undefined {
  return session.offers.find((o) => o.offerId === offerId);
}

function isExpired(offer: Offer, now: number): boolean {
  return now >= offer.expiresAt;
}

/**
 * Driver menerima tawaran.
 *
 * Balapan diselesaikan di sini: gelombang menawarkan ke beberapa driver
 * serentak, tetapi hanya satu yang menang. Yang kalah menerima
 * OFFER_TAKEN, bukan galat — mereka tidak melakukan kesalahan apa pun.
 *
 * IDEMPOTEN: driver yang mengirim ulang penerimaan atas tawaran yang
 * sudah dia menangkan tetap mendapat ASSIGNED, bukan OFFER_TAKEN. Sinyal
 * driver kerap putus-nyambung dan aplikasi akan mengulang; menjawab
 * "sudah diambil orang lain" atas tawaran miliknya sendiri adalah cacat
 * yang membuat driver kehilangan order yang sudah sah jadi haknya.
 */
export function acceptOffer(
  session: DispatchSession,
  offerId: string,
  now: number,
): AcceptOutcome {
  const offer = findOffer(session, offerId);
  if (!offer) return { result: 'OFFER_UNKNOWN', session };

  if (offer.state === 'ACCEPTED') {
    return { result: 'ASSIGNED', session, orderId: session.orderId };
  }

  if (session.state === 'ASSIGNED') {
    return { result: 'OFFER_TAKEN', session };
  }

  if (offer.state !== 'PENDING') {
    return { result: 'OFFER_EXPIRED', session };
  }

  if (isExpired(offer, now)) {
    const expired = replaceOffer(session, offerId, { state: 'EXPIRED' });
    return { result: 'OFFER_EXPIRED', session: expired };
  }

  // Pemenang ditetapkan; seluruh tawaran lain yang masih menggantung
  // ditandai SUPERSEDED sekaligus, supaya tidak ada dua penugasan.
  const offers = session.offers.map((o) =>
    o.offerId === offerId
      ? { ...o, state: 'ACCEPTED' as const }
      : o.state === 'PENDING'
        ? { ...o, state: 'SUPERSEDED' as const }
        : o,
  );

  const assigned: DispatchSession = {
    ...session,
    offers,
    state: 'ASSIGNED',
    assignedTo: offer.partnerId,
    queue: [],
  };

  return { result: 'ASSIGNED', session: assigned, orderId: session.orderId };
}

function replaceOffer(
  session: DispatchSession,
  offerId: string,
  patch: Partial<Offer>,
): DispatchSession {
  return {
    ...session,
    offers: session.offers.map((o) => (o.offerId === offerId ? { ...o, ...patch } : o)),
  };
}

/** Driver menolak. Sesi lanjut; gelombang berikutnya dibuka bila semua sudah menjawab. */
export function rejectOffer(
  session: DispatchSession,
  offerId: string,
  now: number,
  newOfferId: OfferIdGenerator,
  policy: DispatchPolicy = DEFAULT_POLICY,
): DispatchSession {
  const offer = findOffer(session, offerId);
  if (!offer || offer.state !== 'PENDING' || session.state !== 'SEARCHING') {
    return session;
  }
  const next = replaceOffer(session, offerId, { state: 'REJECTED' });
  return advanceIfWaveSettled(next, now, newOfferId, policy);
}

/** Tawaran lewat masa berlaku tanpa jawaban. */
export function expireOffer(
  session: DispatchSession,
  offerId: string,
  now: number,
  newOfferId: OfferIdGenerator,
  policy: DispatchPolicy = DEFAULT_POLICY,
): DispatchSession {
  const offer = findOffer(session, offerId);
  if (!offer || offer.state !== 'PENDING' || session.state !== 'SEARCHING') {
    return session;
  }
  const next = replaceOffer(session, offerId, { state: 'EXPIRED' });
  return advanceIfWaveSettled(next, now, newOfferId, policy);
}

/** Sapu seluruh tawaran yang sudah lewat waktu, lalu majukan bila perlu. */
export function sweepExpired(
  session: DispatchSession,
  now: number,
  newOfferId: OfferIdGenerator,
  policy: DispatchPolicy = DEFAULT_POLICY,
): DispatchSession {
  if (session.state !== 'SEARCHING') return session;

  const offers = session.offers.map((o) =>
    o.state === 'PENDING' && isExpired(o, now) ? { ...o, state: 'EXPIRED' as const } : o,
  );

  return advanceIfWaveSettled({ ...session, offers }, now, newOfferId, policy);
}

/**
 * Gelombang dianggap tuntas bila tidak ada lagi tawaran PENDING di
 * gelombang berjalan. Baru saat itu gelombang berikutnya dibuka —
 * bukan sebelumnya, supaya satu order tidak ditawarkan ke lebih banyak
 * driver daripada yang dikehendaki kebijakan.
 */
function advanceIfWaveSettled(
  session: DispatchSession,
  now: number,
  newOfferId: OfferIdGenerator,
  policy: DispatchPolicy,
): DispatchSession {
  const stillPending = session.offers.some(
    (o) => o.wave === session.wave && o.state === 'PENDING',
  );
  if (stillPending) return session;
  return openNextWave(session, now, newOfferId, policy);
}

/** Tawaran yang sedang berlaku untuk seorang driver. */
export function currentOfferFor(
  session: DispatchSession,
  partnerId: string,
  now: number,
): Offer | null {
  return (
    session.offers.find(
      (o) => o.partnerId === partnerId && o.state === 'PENDING' && !isExpired(o, now),
    ) ?? null
  );
}
