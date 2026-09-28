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
};

type WpMenuItem = {
  id: number;
  menus?: number;
  menu_order?: number;
};

const PRIMARY_LOCATION = "primary";

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

  try {
    const created = await wpRequest<WpMenu>(config, "/wp-json/wp/v2/menus", {
      method: "POST",
      body: JSON.stringify({
        name: "Primary",
        locations: [PRIMARY_LOCATION],
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
      "Could not access WordPress menus API — assign Primary menu manually or upgrade WP REST menus.",
      { phase: "phase1" }
    );
    return;
  }

  const existingItems = await listMenuItems(config, menuId);
  for (const item of existingItems) {
    try {
      await wpRequest(
        config,
        `/wp-json/wp/v2/menu-items/${item.id}?force=true`,
        { method: "DELETE" }
      );
    } catch {
      /* best effort */
    }
  }

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

  log.info(
    `Primary navigation synced (${pages.length} item(s)) — theme menu matches pagesToBuild.`,
    { phase: "phase1" }
  );
}
