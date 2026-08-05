import {
  visibleTabs,
  mayUseSidebar,
  MAX_BOTTOM_TABS,
  type TabSetName,
} from '@pesona/contracts';

/**
 * Adaptor navigasi web — ADR-007.
 *
 * Aturannya bergantung pada permukaan, bukan selera:
 *   - PWA konsumen dan merchant  -> bottom tab di layar sempit,
 *                                   TOP NAV di layar lebar. Bukan sidebar.
 *   - web-admin dan web-ops      -> sidebar dipertahankan; ratusan halaman
 *                                   back-office tidak muat di bottom tab.
 */

export type WebNavLayout = 'bottom-tabs' | 'top-nav' | 'sidebar';

export interface WebNavItem {
  href: string;
  label: string;
  icon: string;
}

/** Ambang lebar viewport tempat bottom tab berganti jadi top nav. */
export const WIDE_VIEWPORT_MIN_PX = 768;

export function resolveLayout(surface: string, viewportWidthPx: number): WebNavLayout {
  if (mayUseSidebar(surface)) return 'sidebar';
  return viewportWidthPx >= WIDE_VIEWPORT_MIN_PX ? 'top-nav' : 'bottom-tabs';
}

export function buildNavItems(
  set: TabSetName,
  isCooperativeMember: boolean,
): WebNavItem[] {
  const tabs = visibleTabs(set, isCooperativeMember);
  if (tabs.length > MAX_BOTTOM_TABS) {
    throw new Error(
      `Navigasi maksimal ${MAX_BOTTOM_TABS} item, dapat ${tabs.length} untuk "${set}"`,
    );
  }
  return tabs.map((t) => ({ href: `/${t.key}`, label: t.label, icon: t.icon }));
}
