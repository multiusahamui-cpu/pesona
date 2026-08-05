/**
 * Definisi navigasi — ADR-007.
 *
 * Kenapa ini ada di contracts, bukan di ui-web atau ui-mobile:
 *
 * Pagar 1 ADR-007 menyatakan label dan urutan tab HARUS identik antara
 * aplikasi native dan PWA. Kalau definisinya ditulis dua kali, cepat atau
 * lambat keduanya akan menyimpang — dan saat itu terjadi, naskah CS
 * ("tekan tab Pesanan") berhenti berlaku di salah satu permukaan, tepat
 * ketika sedang dipakai menyelesaikan sengketa.
 *
 * Dengan menaruhnya di contracts, kesamaan itu dijamin struktur, bukan
 * kedisiplinan.
 */

export interface TabDefinition {
  key: string;
  label: string;
  /** Nama ikon yang dipetakan masing-masing permukaan ke set ikonnya. */
  icon: string;
  /**
   * true = tab hanya muncul bila pengguna sudah menjadi anggota koperasi.
   * Konsumen non-anggota tidak punya dompet — ia membayar per transaksi
   * lewat QRIS. Lihat ARSITEKTUR-KEUANGAN §2.
   */
  requiresMembership: boolean;
}

/** Maksimal lima tab. Lebih dari itu, target sentuhnya terlalu sempit. */
export const MAX_BOTTOM_TABS = 5;

export const CONSUMER_TABS: readonly TabDefinition[] = [
  { key: 'home', label: 'Beranda', icon: 'home', requiresMembership: false },
  { key: 'orders', label: 'Pesanan', icon: 'receipt', requiresMembership: false },
  { key: 'chat', label: 'Chat', icon: 'message', requiresMembership: false },
  { key: 'wallet', label: 'Dompet', icon: 'wallet', requiresMembership: true },
  { key: 'account', label: 'Akun', icon: 'user', requiresMembership: false },
] as const;

/**
 * Driver wajib anggota, jadi seluruh tabnya selalu tampil.
 * Layar Beranda didominasi tombol daring/luring; kartu tawaran order
 * mengambil alih seluruh layar saat masuk.
 */
export const DRIVER_TABS: readonly TabDefinition[] = [
  { key: 'home', label: 'Beranda', icon: 'home', requiresMembership: false },
  { key: 'orders', label: 'Pesanan', icon: 'receipt', requiresMembership: false },
  { key: 'earnings', label: 'Pendapatan', icon: 'wallet', requiresMembership: false },
  { key: 'account', label: 'Akun', icon: 'user', requiresMembership: false },
] as const;

export const MERCHANT_TABS: readonly TabDefinition[] = [
  { key: 'orders', label: 'Pesanan', icon: 'receipt', requiresMembership: false },
  { key: 'products', label: 'Produk', icon: 'box', requiresMembership: false },
  { key: 'reports', label: 'Laporan', icon: 'chart', requiresMembership: false },
  { key: 'account', label: 'Akun', icon: 'user', requiresMembership: false },
] as const;

export const TAB_SETS = {
  consumer: CONSUMER_TABS,
  driver: DRIVER_TABS,
  merchant: MERCHANT_TABS,
} as const;

export type TabSetName = keyof typeof TAB_SETS;

/**
 * Tab yang benar-benar tampil bagi seorang pengguna.
 *
 * Dipakai sama persis oleh aplikasi native dan PWA — itulah yang membuat
 * pagar 1 tidak bisa dilanggar tanpa mengubah berkas ini.
 */
export function visibleTabs(
  set: TabSetName,
  isCooperativeMember: boolean,
): readonly TabDefinition[] {
  return TAB_SETS[set].filter((t) => !t.requiresMembership || isCooperativeMember);
}

/**
 * Permukaan back-office BOLEH memakai sidebar.
 *
 * Sidebar buruk di layar sempit, wajar di desktop. `web-admin` dan
 * `web-ops` menampung ratusan halaman; memaksanya ke bottom tab justru
 * menyulitkan operator yang memakainya sepanjang shift.
 */
export const SIDEBAR_ALLOWED_SURFACES = ['web-admin', 'web-ops'] as const;
export type SidebarSurface = (typeof SIDEBAR_ALLOWED_SURFACES)[number];

export function mayUseSidebar(surface: string): surface is SidebarSurface {
  return (SIDEBAR_ALLOWED_SURFACES as readonly string[]).includes(surface);
}
