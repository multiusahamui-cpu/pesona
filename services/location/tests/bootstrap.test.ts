import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/platform/env.js';
import { createApp } from '../src/index.js';

const sah = { NODE_ENV: 'test', PORT: '5002', REDIS_URL: 'redis://x' };

describe('Konfigurasi location', () => {
  it('menerima konfigurasi yang lengkap', () => {
    const env = loadEnv(sah as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(5002);
  });

  it('berhenti seketika bila variabel wajib hilang', () => {
    const kurang = { ...sah };
    delete (kurang as Record<string, unknown>).REDIS_URL;
    expect(() => loadEnv(kurang as NodeJS.ProcessEnv)).toThrow();
  });

  it('menolak PORT yang bukan angka', () => {
    expect(() => loadEnv({ ...sah, PORT: 'bukan-angka' } as NodeJS.ProcessEnv)).toThrow();
  });
});

describe('Aplikasi location', () => {
  it('terbentuk tanpa melempar', () => {
    expect(createApp()).toBeDefined();
  });
});
