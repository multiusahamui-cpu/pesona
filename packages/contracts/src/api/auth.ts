import { z } from 'zod';
import { defineEndpoint, ok } from './_endpoint.js';
import { MemberIdSchema } from '../ids.js';

/** Langkah 1 — Identity. Diport dari garuda routes/auth.ts. */

export const RoleSchema = z.enum(['CONSUMER', 'DRIVER', 'MERCHANT', 'ADMIN']);

/**
 * Peran bersifat SEJAJAR, bukan berjenjang seperti di garuda.
 * Satu akun dapat memegang lebih dari satu peran, dan konsumen tidak
 * perlu jadi anggota koperasi lebih dulu. Lihat ARSITEKTUR-KEUANGAN §2.
 */
export const SessionUserSchema = z.object({
  id: MemberIdSchema,
  displayName: z.string(),
  roles: z.array(RoleSchema).min(1),
  /** false = konsumen non-anggota. Tidak punya dompet. */
  isCooperativeMember: z.boolean(),
  kycStatus: z.enum(['NONE', 'PENDING', 'VERIFIED', 'REJECTED']),
});

export type SessionUser = z.infer<typeof SessionUserSchema>;

export const login = defineEndpoint({
  method: 'POST',
  path: '/api/auth/login',
  summary: 'Masuk dengan nomor ponsel atau surel',
  auth: 'none',
  idempotent: false,
  monetary: false,
  request: z.object({
    identifier: z.string().min(3).max(128),
    password: z.string().min(8).max(256),
  }),
  response: ok(
    z.object({
      accessToken: z.string(),
      refreshToken: z.string(),
      user: SessionUserSchema,
    }),
  ),
});

export const me = defineEndpoint({
  method: 'GET',
  path: '/api/auth/me',
  summary: 'Profil sesi berjalan',
  auth: 'consumer',
  idempotent: false,
  monetary: false,
  request: z.object({}),
  response: ok(SessionUserSchema),
});
