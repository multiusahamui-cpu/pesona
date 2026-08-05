import { visibleTabs, MAX_BOTTOM_TABS, type TabDefinition, type TabSetName } from '@pesona/contracts';

/**
 * Adaptor navigasi React Native — ADR-007.
 *
 * TANPA SIDEBAR. Laci menyembunyikan menu, menurunkan penemuan fitur,
 * dan menuntut jempol menjangkau pojok kiri atas — sulit di layar 6,7 inci.
 * Bottom tab bar, maksimal lima item.
 *
 * Definisi tabnya diambil dari @pesona/contracts, bukan ditulis di sini,
 * supaya identik dengan yang dipakai PWA.
 */

export interface MobileTabRoute {
  name: string;
  title: string;
  icon: string;
}

export function buildTabRoutes(
  set: TabSetName,
  isCooperativeMember: boolean,
): MobileTabRoute[] {
  const tabs = visibleTabs(set, isCooperativeMember);
  if (tabs.length > MAX_BOTTOM_TABS) {
    throw new Error(
      `Bottom tab bar maksimal ${MAX_BOTTOM_TABS} item, dapat ${tabs.length} untuk "${set}"`,
    );
  }
  return tabs.map((t: TabDefinition) => ({ name: t.key, title: t.label, icon: t.icon }));
}
