import type { LoadedSiteConfig } from "@/lib/config-loader";
import { WordPressApiError, wpRequest } from "@/lib/wordpress-client";

export type WpMenuLocationEntry = {
  name?: string;
  description?: string;
  menu?: number;
};

export type WpMenuRecord = {
  id: number;
  name?: string;
  slug?: string;
  locations?: string[];
  auto_add?: boolean;
};

export function formatWordPressApiError(err: unknown): string {
  if (err instanceof WordPressApiError) {
    const detail = err.body.trim();
    return detail
      ? `${err.message}: ${detail.slice(0, 320)}`
      : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/** GET /menu-locations returns `{ primary: { name, description, menu } }`. */
export function parseMenuLocationsPayload(
  payload: Record<string, WpMenuLocationEntry | number> | null | undefined
): Record<string, WpMenuLocationEntry> {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const out: Record<string, WpMenuLocationEntry> = {};
  for (const [slug, value] of Object.entries(payload)) {
    if (typeof value === "number") {
      out[slug] = { name: slug, menu: value };
    } else if (value && typeof value === "object") {
      out[slug] = value;
    }
  }
  return out;
}

export function menuIdAtLocation(
  locations: Record<string, WpMenuLocationEntry>,
  slug: string
): number | null {
  const menu = locations[slug]?.menu;
  return typeof menu === "number" && menu > 0 ? menu : null;
}

export async function fetchMenuLocations(
  config: LoadedSiteConfig
): Promise<Record<string, WpMenuLocationEntry>> {
  try {
    const raw = await wpRequest<Record<string, WpMenuLocationEntry | number>>(
      config,
      "/wp-json/wp/v2/menu-locations?context=edit"
    );
    return parseMenuLocationsPayload(raw);
  } catch {
    return {};
  }
}

export async function menusRestAvailable(
  config: LoadedSiteConfig
): Promise<boolean> {
  try {
    await wpRequest(config, "/wp-json/wp/v2/menus?per_page=1&context=edit");
    return true;
  } catch {
    return false;
  }
}

export async function listMenus(
  config: LoadedSiteConfig
): Promise<WpMenuRecord[]> {
  const menus = await wpRequest<WpMenuRecord[]>(
    config,
    "/wp-json/wp/v2/menus?per_page=100&context=edit"
  );
  return Array.isArray(menus) ? menus : [];
}

/** Assign theme locations via POST /menus/{id} (menu-locations is read-only). */
const HEADER_LOCATION_PRIORITY = [
  "primary",
  "main",
  "header",
  "header-menu",
  "primary-menu",
  "main-menu",
  "secondary",
  "mobile",
  "mobile-secondary",
  "tertiary",
  "quaternary",
  "menu-1",
  "primary_navigation",
];

/** Slugs registered by the active theme (Braine may not use `primary`). */
export function pickHeaderMenuLocationSlugs(
  registered: Record<string, WpMenuLocationEntry>
): string[] {
  const slugs = Object.keys(registered);
  if (slugs.length === 0) return [];
  const picked = HEADER_LOCATION_PRIORITY.filter((s) => slugs.includes(s));
  return picked.length > 0 ? picked : slugs.slice(0, 3);
}

export async function assignMenuThemeLocations(
  config: LoadedSiteConfig,
  menuId: number,
  preferredSlugs: string[]
): Promise<string[]> {
  const registered = await fetchMenuLocations(config);
  const slugs = Object.keys(registered);
  const fromPreferred = preferredSlugs.filter((s) => slugs.includes(s));
  const targets =
    fromPreferred.length > 0
      ? fromPreferred
      : pickHeaderMenuLocationSlugs(registered);

  if (targets.length === 0) {
    return [];
  }

  await wpRequest(config, `/wp-json/wp/v2/menus/${menuId}?context=edit`, {
    method: "POST",
    body: JSON.stringify({
      locations: targets,
      auto_add: false,
    }),
  });

  return targets;
}
