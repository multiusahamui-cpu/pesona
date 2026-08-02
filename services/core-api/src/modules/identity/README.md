# Modul 1 — Identity & Membership

Autentikasi, sesi, peran, KYC, keanggotaan.

## Asal migrasi dari garuda-superapp

Matang di garuda: routes/auth.ts, mobile-auth.ts, security.ts, role-management.ts, user-management.ts, resignation.ts; server/mobile-auth-tokens.ts, pin-verification.ts, active-users-tracker.ts

## Aturan batas

- `index.ts` adalah satu-satunya permukaan publik modul ini.
- Modul lain tidak boleh menyentuh `repo/` atau `schema/` di sini.
- Tabel milik modul ini tidak boleh di-join langsung oleh modul lain.
- Pelanggaran ditolak otomatis oleh CI, bukan oleh reviu manual.

## Struktur

| Folder | Isi |
|---|---|
| `routes/` | Handler HTTP |
| `service/` | Logika bisnis |
| `repo/` | Akses data — privat untuk modul ini |
| `schema/` | Definisi tabel Drizzle — privat untuk modul ini |
