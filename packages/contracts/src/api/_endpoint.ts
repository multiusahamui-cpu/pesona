import { z } from 'zod';

/**
 * Kerangka definisi endpoint.
 *
 * Satu endpoint didefinisikan sekali di sini, lalu dipakai tiga arah:
 *   1. Service memvalidasi request dan response terhadap skema ini
 *   2. @pesona/sdk-client di-generate darinya — mobile dan web memakai
 *      tipe yang sama persis, bukan tipe yang ditulis ulang
 *   3. OpenAPI di-generate untuk mitra eksternal
 *
 * Jangan pernah mendefinisikan bentuk request/response di luar berkas api/.
 */

export const AuthLevelSchema = z.enum([
  'none',      // publik
  'consumer',  // konsumen, anggota maupun bukan
  'partner',   // driver / merchant terverifikasi
  'admin',     // back-office
  'internal',  // antar-service, tidak diekspos ke internet
]);

export type AuthLevel = z.infer<typeof AuthLevelSchema>;

export interface EndpointDef<
  Req extends z.ZodTypeAny = z.ZodTypeAny,
  Res extends z.ZodTypeAny = z.ZodTypeAny,
> {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  auth: AuthLevel;
  /**
   * true = wajib membawa header Idempotency-Key.
   *
   * WAJIB true untuk setiap operasi yang menggerakkan uang atau mengubah
   * status order. Aturan ini ditegakkan oleh tes kontrak, bukan oleh
   * kedisiplinan penulisnya.
   */
  idempotent: boolean;
  /** true = operasi menyentuh uang. Dipakai tes kontrak sebagai penjaga. */
  monetary: boolean;
  request: Req;
  response: Res;
}

export function defineEndpoint<Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(
  def: EndpointDef<Req, Res>,
): EndpointDef<Req, Res> {
  return def;
}

/** Amplop respons sukses yang seragam. */
export function ok<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data });
}

export const EmptyRequestSchema = z.object({});
