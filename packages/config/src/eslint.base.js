/**
 * Konfigurasi ESLint dasar Pesona SuperApp.
 *
 * Dipakai bersama oleh seluruh paket workspace. Aturan batas modul
 * ada di eslint.boundaries.js dan hanya dipasang di services/core-api.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export const base = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // Variabel tak terpakai adalah penyebab kegagalan pre-commit paling
      // sering di garuda. Pola yang disepakati: ganti nama jadi _ daripada
      // menonaktifkan aturannya.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],

      // Sistem finansial: jangan biarkan tipe hilang diam-diam.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Uang tidak boleh dihitung dengan float. Tipe Money di
      // @pesona/contracts adalah integer rupiah.
      'no-loss-of-precision': 'error',

      // Promise yang tidak ditunggu di alur pembayaran = transaksi hilang.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/*.config.cjs',
    ],
  },
];

export default base;
