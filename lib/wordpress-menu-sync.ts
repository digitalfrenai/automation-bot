import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { navMenuLabel } from "@/lib/page-display-title";
import type { ScaffoledPage } from "@/lib/pipeline-types";
import {
  assignMenuThemeLocations,
  fetchMenuLocations,
  formatWordPressApiError,
  listMenus,
  menuIdAtLocation,
  menusRestAvailable,
  pickHeaderMenuLocationSlugs,
  type WpMenuRecord,
} from "@/lib/wordpress-nav-rest";
import { wpRequest } from "@/lib/wordpress-client";

type WpMenuItem = {
  id: number;
};

const PRIMARY_LOCATION = "primary";

async function resolvePrimaryMenuId(
  config: LoadedSiteConfig
): Promise<number | null> {
  const locations = await fetchMenuLocations(config);
  for (const slug of pickHeaderMenuLocationSlugs(locations)) {
    const atLoc = menuIdAtLocation(locations, slug);
    if (atLoc) return atLoc;
  }

  try {
    const menus = await listMenus(config);
    if (menus.length === 0) return null;
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
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<number | null> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const existing = await resolvePrimaryMenuId(config);
  if (existing) return existing;

  const registered = await fetchMenuLocations(config);
  const headerLocs = pickHeaderMenuLocationSlugs(registered);
  const createBody: Record<string, unknown> = {
    name: "Primary",
    auto_add: false,
  };
  if (headerLocs.length > 0) {
    createBody.locations = headerLocs;
  }

  try {
    const created = await wpRequest<WpMenuRecord>(
      config,
      "/wp-json/wp/v2/menus?context=edit",
      {
        method: "POST",
        body: JSON.stringify(createBody),
      }
    );
    return created?.id ?? null;
  } catch (err) {
    log.warn(
      `Could not create Primary menu via REST: ${formatWordPressApiError(err)}`,
      { phase: "phase1" }
    );
    if (headerLocs.length === 0) return null;
    try {
      const retry = await wpRequest<WpMenuRecord>(
        config,
        "/wp-json/wp/v2/menus?context=edit",
        {
          method: "POST",
          body: JSON.stringify({ name: "Primary", auto_add: false }),
        }
      );
      return retry?.id ?? null;
    } catch (retryErr) {
      log.warn(
        `Menu create retry without locations failed: ${formatWordPressApiError(retryErr)}`,
        { phase: "phase1" }
      );
      return null;
    }
  }
}

async function listMenuItems(
  config: LoadedSiteConfig,
  menuId: number
): Promise<WpMenuItem[]> {
  try {
    const items = await wpRequest<WpMenuItem[]>(
      config,
      `/wp-json/wp/v2/menu-items?menus=${menuId}&per_page=100&context=edit`
    );
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function clearMenuItems(
  config: LoadedSiteConfig,
  menuId: number
): Promise<number> {
  let removed = 0;
  const items = await listMenuItems(config, menuId);
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
  return removed;
}

async function createMenuPageItem(
  config: LoadedSiteConfig,
  menuId: number,
  page: ScaffoledPage,
  label: string,
  order: number
): Promise<void> {
  const payloads: Record<string, unknown>[] = [
    {
      title: label,
      type: "post_type",
      object: "page",
      object_id: page.id,
      menus: menuId,
      menu_order: order,
      status: "publish",
    },
    {
      title: { raw: label },
      type: "post_type",
      object: "page",
      object_id: page.id,
      menus: menuId,
      menu_order: order,
      status: "publish",
    },
  ];

  let lastError: unknown;
  for (const body of payloads) {
    try {
      await wpRequest(config, "/wp-json/wp/v2/menu-items?context=edit", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function clearOtherMenusAfterSync(
  config: LoadedSiteConfig,
  keepMenuId: number,
  onLog?: LogSink
): Promise<void> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const menus = await listMenus(config);
  let removed = 0;

  for (const menu of menus) {
    if (menu.id === keepMenuId) continue;
    try {
      await wpRequest(config, `/wp-json/wp/v2/menus/${menu.id}?context=edit`, {
        method: "POST",
        body: JSON.stringify({ auto_add: false, locations: [] }),
      });
    } catch {
      /* ignore */
    }
    removed += await clearMenuItems(config, menu.id);
  }

  if (removed > 0) {
    log.info(
      `Removed ${removed} item(s) from other WordPress menus (demo nav cleared).`,
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

  if (!(await menusRestAvailable(config))) {
    log.warn(
      "WordPress menus REST is unavailable (requires WP 5.9+ and a user with edit_theme_options). Navigation was not changed.",
      { phase: "phase1" }
    );
    return;
  }

  const registeredLocs = await fetchMenuLocations(config);
  const locSlugs = Object.keys(registeredLocs);
  if (locSlugs.length > 0) {
    log.info(
      `Theme menu locations from REST: ${locSlugs.join(", ")}.`,
      { phase: "phase1" }
    );
  } else {
    log.warn(
      "No menu locations returned from REST — menus can still be built but may need manual assignment in Appearance → Menus.",
      { phase: "phase1" }
    );
  }

  const menuId = await ensurePrimaryMenu(config, onLog);
  if (!menuId) {
    log.warn(
      "Could not resolve or create the Primary menu via REST. Check Application Password user is Administrator.",
      { phase: "phase1" }
    );
    return;
  }

  const clearedPrimary = await clearMenuItems(config, menuId);
  if (clearedPrimary > 0) {
    log.info(`Cleared ${clearedPrimary} old item(s) from Primary menu.`, {
      phase: "phase1",
    });
  }

  let added = 0;
  let order = 1;
  for (const page of pages) {
    const label = navMenuLabel(page.scaffoldTitle ?? page.title);
    try {
      await createMenuPageItem(config, menuId, page, label, order);
      added += 1;
      order += 1;
    } catch (err) {
      log.warn(
        `Could not add "${label}" to Primary menu: ${formatWordPressApiError(err)}`,
        {
          phase: "phase1",
          pageTitle: page.title,
          pageId: page.id,
        }
      );
    }
  }

  if (added === 0) {
    log.warn(
      "Primary menu has no items — site-wide menus were not cleared. Fix menu-items REST errors above.",
      { phase: "phase1" }
    );
    return;
  }

  try {
    const registered = await fetchMenuLocations(config);
    const assigned = await assignMenuThemeLocations(
      config,
      menuId,
      pickHeaderMenuLocationSlugs(registered)
    );
    if (assigned.length > 0) {
      log.info(
        `Menu #${menuId} assigned to theme location(s): ${assigned.join(", ")}.`,
        { phase: "phase1" }
      );
    } else {
      log.warn(
        "Menu items were created but no theme menu locations were registered — assign Primary in Appearance → Menus.",
        { phase: "phase1" }
      );
    }
  } catch (err) {
    log.warn(
      `Could not assign menu locations via REST: ${formatWordPressApiError(err)}`,
      { phase: "phase1" }
    );
  }

  await clearOtherMenusAfterSync(config, menuId, onLog);

  log.info(
    `Primary navigation synced via REST (${added} item(s) from Pages to build).`,
    { phase: "phase1" }
  );
}
