import type { ClientShell } from '@pesona/contracts';

/**
 * Deteksi lingkungan jalan — ADR-006 dan ADR-007.
 *
 * Prinsipnya: percabangan fitur dilakukan pada KEMAMPUAN shell, bukan
 * pada nama sistem operasi. Untuk fitur seperti pelacakan latar belakang,
 * jangan bercabang di `os === 'android'`; bercabanglah di
 * `shell === 'native-webview'`. Kalau bukan native, fitur itu tidak boleh
 * ditawarkan sama sekali — bukan ditawarkan lalu gagal diam-diam di lapangan.
 */

export type RuntimePlatform = 'ios' | 'android' | 'web';

export interface RuntimeInfo {
  shell: ClientShell;
  os: RuntimePlatform;
  platform: RuntimePlatform;
  /** true bila aplikasi terpasang ke layar utama (PWA) atau native. */
  installed: boolean;
}

interface NativeMarker {
  platform?: RuntimePlatform;
  version?: string;
}

declare global {
  interface Window {
    __PESONA_NATIVE__?: NativeMarker;
  }
  /**
   * `standalone` bukan bagian dari standar — ini peninggalan Safari iOS
   * yang masih dipakai untuk mendeteksi PWA yang sudah ditambahkan ke
   * layar utama. Ditambahkan lewat augmentasi, bukan dengan menimpa
   * tipe `Window.navigator` yang sudah didefinisikan lib DOM.
   */
  interface Navigator {
    standalone?: boolean;
  }
}

/**
 * Penanda native disuntikkan dari sisi aplikasi, BUKAN dikenali dari
 * user agent. Sniffing UA untuk mengenali aplikasi sendiri rapuh dan
 * mudah dipalsukan.
 *
 * React Native WebView:
 *   injectedJavaScript =
 *     'window.__PESONA_NATIVE__={platform:"android",version:"1.2.0"};true;'
 */
function readNativeMarker(): NativeMarker | null {
  if (typeof window === 'undefined') return null;
  return window.__PESONA_NATIVE__ ?? null;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const byMediaQuery =
    typeof window.matchMedia === 'function' &&
    ['standalone', 'fullscreen', 'minimal-ui'].some(
      (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
    );
  // navigator.standalone adalah peninggalan Safari iOS lama, masih dipakai.
  const byLegacySafari = window.navigator.standalone === true;
  return byMediaQuery || byLegacySafari;
}

function detectOs(): RuntimePlatform {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return 'android';
  // iPadOS 13+ menyamar sebagai Macintosh; layar sentuh yang membedakannya.
  const isIpadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(ua) || isIpadOs) return 'ios';
  return 'web';
}

export function detectRuntime(): RuntimeInfo {
  const native = readNativeMarker();
  const standalone = isStandalone();
  const os = native?.platform ?? detectOs();

  const shell: ClientShell = native
    ? 'native-webview'
    : standalone
      ? 'pwa'
      : 'browser';

  return {
    shell,
    os,
    platform: native?.platform ?? os,
    installed: shell !== 'browser',
  };
}

/**
 * Apakah shell ini boleh menawarkan pelacakan lokasi latar belakang.
 *
 * Hanya native. Di web, geolocation ditangguhkan begitu tab tidak aktif
 * atau layar terkunci — tidak ada jalan keluarnya. Aplikasi driver karena
 * itu WAJIB native (ADR-006).
 */
export function supportsBackgroundLocation(runtime: RuntimeInfo): boolean {
  return runtime.shell === 'native-webview';
}

/**
 * Apakah aksi finansial boleh diantrekan saat luring.
 *
 * Selalu false. ADR-006 pagar 1: mode luring bersifat baca-saja. Antrean
 * luring adalah sumber sengketa nomor satu — pengguna menekan bayar saat
 * sinyal hilang, permintaan terkirim ulang saat kembali daring, saldo
 * terpotong dua kali.
 */
export function allowsOfflineFinancialQueue(): false {
  return false;
}
