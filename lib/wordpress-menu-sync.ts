import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { navMenuLabel } from "@/lib/page-display-title";
import type { ScaffoledPage } from "@/lib/pipeline-types";
import { wpRequest } from "@/lib/wordpress-client";

type WpMenu = {
  id: number;
  name?: string;
  slug?: string;
  locations?: string[];
  auto_add?: boolean;
};

type WpMenuItem = {
  id: number;
  menus?: number;
  menu_order?: number;
};

const PRIMARY_LOCATION = "primary";

/** Kadence / Braine header locations (subset applied if registered on the site). */
const KADENCE_HEADER_LOCATIONS = [
  "primary",
  "secondary",
  "mobile",
  "mobile-secondary",
  "tertiary",
  "quaternary",
];

const MENU_LOCATION_FALLBACKS = [
  ...KADENCE_HEADER_LOCATIONS,
  "main",
  "header",
  "header-menu",
  "primary-menu",
  "main-menu",
  "menu-1",
  "primary_navigation",
  "footer",
];

async function listAllMenus(
  config: LoadedSiteConfig
): Promise<WpMenu[]> {
  try {
    const menus = await wpRequest<WpMenu[]>(
      config,
      "/wp-json/wp/v2/menus?per_page=100"
    );
    return Array.isArray(menus) ? menus : [];
  } catch {
    return [];
  }
}

async function registeredMenuLocationSlugs(
  config: LoadedSiteConfig
): Promise<string[]> {
  try {
    const locations = await wpRequest<Record<string, unknown>>(
      config,
      "/wp-json/wp/v2/menu-locations"
    );
    if (locations && typeof locations === "object") {
      return Object.keys(locations);
    }
  } catch {
    /* WP < 6.8 or menus REST disabled */
  }
  return MENU_LOCATION_FALLBACKS;
}

async function assignMenuToThemeLocations(
  config: LoadedSiteConfig,
  menuId: number,
  preferred: string[]
): Promise<void> {
  const registered = await registeredMenuLocationSlugs(config);
  const targets = preferred.filter((loc) => registered.includes(loc));
  const keys = targets.length > 0 ? targets : registered;

  for (const loc of keys) {
    for (const body of [{ menu: menuId }, { menus: menuId }]) {
      try {
        await wpRequest(config, `/wp-json/wp/v2/menu-locations/${loc}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        break;
      } catch {
        /* try next body shape / location */
      }
    }
  }

  try {
    await wpRequest(config, `/wp-json/wp/v2/menus/${menuId}`, {
      method: "POST",
      body: JSON.stringify({
        locations: targets.length > 0 ? targets : [PRIMARY_LOCATION],
        auto_add: false,
      }),
    });
  } catch {
    /* menu update optional */
  }
}

async function resolvePrimaryMenuId(
  config: LoadedSiteConfig
): Promise<number | null> {
  try {
    const locations = await wpRequest<Record<string, number>>(
      config,
      "/wp-json/wp/v2/menu-locations"
    );
    const id = locations?.[PRIMARY_LOCATION];
    if (typeof id === "number" && id > 0) return id;
  } catch {
    /* menu-locations requires WP 6.8+ REST menus */
  }

  try {
    const menus = await wpRequest<WpMenu[]>(
      config,
      "/wp-json/wp/v2/menus?per_page=100"
    );
    if (!Array.isArray(menus) || menus.length === 0) return null;
    const assigned = menus.find((m) =>
      m.locations?.includes(PRIMARY_LOCATION)
    );
    if (assigned?.id) return assigned.id;
    const byName = menus.find(
      (m) =>
        m.slug === PRIMARY_LOCATION ||
        m.name?.toLowerCase() === "primary" ||
        m.name?.toLowerCase() === "main menu"
    );
    return byName?.id ?? menus[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function ensurePrimaryMenu(
  config: LoadedSiteConfig
): Promise<number | null> {
  const existing = await resolvePrimaryMenuId(config);
  if (existing) return existing;

  const registered = await registeredMenuLocationSlugs(config);
  const headerLocs = KADENCE_HEADER_LOCATIONS.filter((l) =>
    registered.includes(l)
  );

  try {
    const created = await wpRequest<WpMenu>(config, "/wp-json/wp/v2/menus", {
      method: "POST",
      body: JSON.stringify({
        name: "Primary",
        locations: headerLocs.length > 0 ? headerLocs : [PRIMARY_LOCATION],
        auto_add: false,
      }),
    });
    return created?.id ?? null;
  } catch {
    return null;
  }
}

async function listMenuItems(
  config: LoadedSiteConfig,
  menuId: number
): Promise<WpMenuItem[]> {
  try {
    const items = await wpRequest<WpMenuItem[]>(
      config,
      `/wp-json/wp/v2/menu-items?menus=${menuId}&per_page=100`
    );
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function clearAllMenuItems(
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<void> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const menus = await listAllMenus(config);
  let removed = 0;

  for (const menu of menus) {
    try {
      await wpRequest(config, `/wp-json/wp/v2/menus/${menu.id}`, {
        method: "POST",
        body: JSON.stringify({ auto_add: false }),
      });
    } catch {
      /* ignore */
    }

    const items = await listMenuItems(config, menu.id);
    for (const item of items) {
      try {
        await wpRequest(
          config,
          `/wp-json/wp/v2/menu-items/${item.id}?force=true`,
          { method: "DELETE" }
        );
        removed += 1;
      } catch {
        /* best effort */
      }
    }
  }

  if (removed > 0) {
    log.info(
      `Cleared ${removed} existing menu item(s) (demo/old pages removed from nav).`,
      { phase: "phase1" }
    );
  }
}

/** Replace primary nav with configured scaffold pages only (short labels). */
export async function syncPrimaryNavigationMenu(
  config: LoadedSiteConfig,
  pages: ScaffoledPage[],
  onLog?: LogSink
): Promise<void> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const menuId = await ensurePrimaryMenu(config);
  if (!menuId) {
    log.warn(
      "Could not access WordPress menus API — assign Primary menu in Appearance → Menus (Kadence: Primary + Mobile), or use WordPress 6.8+ with REST menus enabled.",
      { phase: "phase1" }
    );
    return;
  }

  await clearAllMenuItems(config, onLog);

  let order = 1;
  for (const page of pages) {
    const label = navMenuLabel(page.scaffoldTitle ?? page.title);
    try {
      await wpRequest(config, "/wp-json/wp/v2/menu-items", {
        method: "POST",
        body: JSON.stringify({
          title: label,
          type: "post_type",
          object: "page",
          object_id: page.id,
          menus: menuId,
          menu_order: order,
          status: "publish",
        }),
      });
      order += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "menu item failed";
      log.warn(`Could not add "${label}" to Primary menu: ${message}`, {
        phase: "phase1",
        pageTitle: page.title,
        pageId: page.id,
      });
    }
  }

  await assignMenuToThemeLocations(config, menuId, KADENCE_HEADER_LOCATIONS);

  log.info(
    `Primary navigation synced (${pages.length} item(s) from Pages to build) — Kadence Primary/Mobile locations updated; auto-add disabled on all menus.`,
    { phase: "phase1" }
  );
}
