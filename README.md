# Pesona SuperApp

Monorepo superapp multi-vertikal berbasis koperasi. Diregresi dari `garuda-superapp`.

Arsitektur lengkap dan seluruh ADR: [`docs/adr/ARSITEKTUR-PESONA-SUPERAPP.md`](docs/adr/ARSITEKTUR-PESONA-SUPERAPP.md)

---

## Prasyarat

| Alat | Versi |
|---|---|
| Node.js | 22 LTS (`.nvmrc`) — minimum 20 |
| pnpm | 9 (via Corepack: `corepack enable`) |
| Docker | untuk Postgres + Redis lokal |

```bash
corepack enable
pnpm install
cp .env.example .env      # lalu isi
pnpm infra:up             # Postgres + Redis lokal
```

---

## Menjalankan — semua dari root

**Tidak perlu `cd` ke subfolder.** Semua paket dijalankan dari root dengan filter.

```bash
pnpm dev:core      # core-api + dispatch + location + notification
pnpm dev:admin     # web-admin + core-api
pnpm dev:ride      # core-api + dispatch + location + mobile-driver

pnpm --filter @pesona/core-api dev        # satu paket
pnpm --filter "./services/*" dev          # seluruh backend
pnpm --filter @pesona/mobile-driver start # Expo

pnpm --filter @pesona/core-api test
pnpm --filter @pesona/core-api add drizzle-orm   # tambah dependensi ke satu paket

pnpm build:affected                       # hanya yang berubah sejak origin/main
```

Menjalankan seluruh 16 paket sekaligus tidak realistis di satu mesin — pakai profil `dev:*` di atas.

---

## Struktur

```
apps/          7 folder → 6 deliverable (3 mobile, 4 web)
services/      4 artefak deployable
packages/      5 paket bersama
infra/         docker · k8s · terraform
docs/adr/      keputusan arsitektur
```

| Paket | Peran | Port dev |
|---|---|---|
| `@pesona/web-public` | Web publik + PWA Konsumen (Next.js) | 3000 |
| `@pesona/web-admin` | Back-office | 3001 |
| `@pesona/web-ops` | Live Ops, CS, payout | 3002 |
| `@pesona/web-merchant` | Dashboard merchant (PWA) | 3003 |
| `@pesona/mobile-consumer` | App Konsumen | Expo |
| `@pesona/mobile-driver` | App Driver — **wajib native** | Expo |
| `@pesona/mobile-merchant` | App Merchant | Expo |
| `@pesona/core-api` | 9 modul domain, satu DB, ACID | 5000 |
| `@pesona/dispatch` | Matching engine | 5001 |
| `@pesona/location` | Presence & ingest GPS | 5002 |
| `@pesona/notification` | Push & realtime | 5003 |
| `@pesona/contracts` | Skema zod → OpenAPI | — |
| `@pesona/sdk-client` | Client API ter-generate | — |
| `@pesona/ui-web` · `@pesona/ui-mobile` | Design system | — |
| `@pesona/config` | eslint, tsconfig, aturan batas modul | — |

---

## Aturan yang tidak boleh dilanggar

1. **Batas modul.** Modul di `core-api/src/modules/` hanya boleh saling mengimpor lewat `index.ts`. Menyentuh `repo/` atau `schema/` modul lain ditolak CI.
2. **Tidak ada `.env` di produksi.** Rahasia dipasok External Secrets Operator + KMS.
3. **Tidak ada artefak biner di git.** `*.zip`, `backups/`, `repo/` sudah di-ignore — ini pelajaran langsung dari garuda.
4. **PWA offline bersifat baca-saja.** Tidak ada aksi finansial yang diantrekan offline (ADR-006 pagar 1).
5. **Driver tidak boleh PWA.** Background location dan foreground service tidak tersedia di web.
6. **Bundle ID mobile belum final.** Lihat `apps/mobile-*/BUNDLE-ID.md` — wajib diganti sebelum rilis store pertama.

---

## Status

Fase 0 — scaffold. Belum ada kode dari garuda yang dipindahkan.

Langkah berikutnya: `packages/contracts` (zod-first) dan `packages/config` (aturan batas modul), lalu kontrak modul Dispatch.
