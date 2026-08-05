import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  detectRuntime,
  supportsBackgroundLocation,
  allowsOfflineFinancialQueue,
} from '../src/runtime.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubBrowser(opts: { ua: string; standalone?: boolean; native?: unknown; platform?: string; touch?: number }) {
  vi.stubGlobal('navigator', {
    userAgent: opts.ua,
    platform: opts.platform ?? 'Linux armv8l',
    maxTouchPoints: opts.touch ?? 5,
    standalone: opts.standalone,
  });
  vi.stubGlobal('window', {
    navigator: { standalone: opts.standalone },
    matchMedia: (q: string) => ({ matches: Boolean(opts.standalone) && q.includes('standalone') }),
    __PESONA_NATIVE__: opts.native,
  });
}

describe('detectRuntime', () => {
  it('mengenali tab browser biasa di Android', () => {
    stubBrowser({ ua: 'Mozilla/5.0 (Linux; Android 14)' });
    const r = detectRuntime();
    expect(r.shell).toBe('browser');
    expect(r.os).toBe('android');
    expect(r.installed).toBe(false);
  });

  it('mengenali PWA terpasang', () => {
    stubBrowser({ ua: 'Mozilla/5.0 (Linux; Android 14)', standalone: true });
    expect(detectRuntime().shell).toBe('pwa');
  });

  it('mengenali WebView native dari penanda suntikan, bukan dari user agent', () => {
    stubBrowser({
      ua: 'Mozilla/5.0 (Linux; Android 14)',
      native: { platform: 'android', version: '1.2.0' },
    });
    expect(detectRuntime().shell).toBe('native-webview');
  });

  it('mengenali iPadOS yang menyamar sebagai Macintosh', () => {
    stubBrowser({
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      touch: 5,
    });
    expect(detectRuntime().os).toBe('ios');
  });
});

describe('Percabangan berbasis kemampuan, bukan nama OS', () => {
  it('lokasi latar belakang hanya untuk native', () => {
    expect(supportsBackgroundLocation({ shell: 'native-webview', os: 'android', platform: 'android', installed: true })).toBe(true);
    expect(supportsBackgroundLocation({ shell: 'pwa', os: 'android', platform: 'android', installed: true })).toBe(false);
    expect(supportsBackgroundLocation({ shell: 'browser', os: 'ios', platform: 'ios', installed: false })).toBe(false);
  });

  it('antrean finansial luring selalu ditolak — ADR-006 pagar 1', () => {
    expect(allowsOfflineFinancialQueue()).toBe(false);
  });
});
