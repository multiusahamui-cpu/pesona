/**
 * Aturan batas modul — ADR-001.
 *
 * Inilah pagar yang menentukan Pesona tetap modular monolith atau
 * merosot jadi monolit kusut seperti routes.ts di garuda yang sempat
 * mencapai 14.389 baris.
 *
 * Aturan pokoknya satu kalimat:
 *   Modul hanya boleh saling berbicara lewat index.ts.
 *
 * Menyentuh repo/ atau schema/ modul lain berarti dua modul berbagi
 * tabel secara diam-diam — dan itu yang membuat modul mustahil dicabut
 * di kemudian hari.
 *
 * Dipasang di services/core-api/eslint.config.js.
 */

import boundaries from 'eslint-plugin-boundaries';

/**
 * Dua belas modul domain di core-api.
 * Modul 4 (Supply State), 5 (Dispatch), dan 9 (Notification) tidak ada
 * di sini karena diekstrak menjadi layanan terpisah.
 */
export const CORE_API_MODULES = [
  'identity',          // modul 1
  'partner',           // modul 2
  'geo',               // modul 3
  'order',             // modul 6
  'pricing',           // modul 7
  'payment',           // modul 8
  'payout',            // modul 10
  'catalog',           // modul 11
  'trust-safety',      // modul 12
  'escrow-settlement', // modul 13
  'communication',     // modul 14
];

/** @type {import('eslint').Linter.Config[]} */
export const moduleBoundaries = [
  {
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/elements': [
        // Permukaan publik modul — satu-satunya pintu masuk
        {
          type: 'module-public',
          pattern: 'src/modules/*/index.ts',
          mode: 'full',
          capture: ['module'],
        },
        // Isi dalam modul — privat
        {
          type: 'module-internal',
          pattern: 'src/modules/*/**',
          mode: 'full',
          capture: ['module'],
        },
        // Infrastruktur bersama: db, redis, config, logger, middleware
        {
          type: 'platform',
          pattern: 'src/platform/**',
          mode: 'full',
        },
        // Aggregator
        {
          type: 'root',
          pattern: 'src/index.ts',
          mode: 'full',
        },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              // Isi modul boleh menyentuh isi modulnya sendiri,
              // permukaan publik modul lain, dan platform.
              from: ['module-internal'],
              allow: [
                ['module-internal', { module: '${from.module}' }],
                ['module-public', { module: '!${from.module}' }],
                'platform',
              ],
            },
            {
              from: ['module-public'],
              allow: [
                ['module-internal', { module: '${from.module}' }],
                ['module-public', { module: '!${from.module}' }],
                'platform',
              ],
            },
            {
              // Aggregator boleh memanggil semua permukaan publik.
              from: ['root'],
              allow: ['module-public', 'platform'],
            },
            {
              // Platform tidak boleh tahu apa pun tentang modul domain.
              // Kalau platform mengimpor modul, itu tanda ketergantungan
              // terbalik yang akan jadi impor melingkar.
              from: ['platform'],
              allow: ['platform'],
            },
          ],
        },
      ],

      // Larangan eksplisit yang paling sering dilanggar, dengan pesan
      // yang menjelaskan kenapa — bukan sekadar "dilarang".
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Bentuk absolut/alias, DAN bentuk relatif ke modul tetangga.
              // `../repo` (modul sendiri) sengaja tidak diblokir; yang
              // diblokir adalah `../<modul-lain>/repo` dan `../../<modul-lain>/repo`.
              group: [
                '**/modules/*/repo',
                '**/modules/*/repo/**',
                '../*/repo',
                '../*/repo/**',
                '../../*/repo',
                '../../*/repo/**',
              ],
              message:
                'Dilarang mengimpor repo/ modul lain. Akses data milik modul itu sendiri. ' +
                'Pakai fungsi yang diekspor dari index.ts modul tersebut.',
            },
            {
              group: [
                '**/modules/*/schema',
                '**/modules/*/schema/**',
                '../*/schema',
                '../*/schema/**',
                '../../*/schema',
                '../../*/schema/**',
              ],
              message:
                'Dilarang mengimpor schema/ modul lain. Tabel milik satu modul tidak boleh ' +
                'di-join langsung oleh modul lain — itu yang membuat modul mustahil dicabut.',
            },
            {
              group: [
                '**/modules/*/service',
                '**/modules/*/service/**',
                '../*/service',
                '../*/service/**',
                '../../*/service',
                '../../*/service/**',
              ],
              message:
                'Dilarang mengimpor service/ modul lain secara langsung. Ekspor fungsi yang ' +
                'dibutuhkan lewat index.ts modul tersebut.',
            },
            {
              group: [
                '**/modules/*/routes/**',
                '../*/routes/**',
                '../../*/routes/**',
              ],
              message:
                'Handler HTTP modul lain tidak boleh dipanggil dari kode. ' +
                'Kalau butuh logikanya, pindahkan ke service dan ekspor lewat index.ts.',
            },
          ],
        },
      ],
    },
  },
];

export default moduleBoundaries;
