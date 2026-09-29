import AdmZip from "adm-zip";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import {
  detectThemeSlugFromZip,
  resolveLocalThemePath,
} from "@/lib/themeDeployer";
import type { ThemeStyleProfile } from "@/lib/theme-style-profile";
import { normalizeWpUrl } from "@/lib/wordpress-client";

export type ThemeImageAsset = {
  /** Stable dedupe key (public URL or zip path). */
  key: string;
  publicUrl: string;
  filename: string;
  relativePath: string;
  roleHint: "hero" | "section" | "any";
  rank: number;
  source: "theme-zip" | "reference-markup" | "page-content";
};

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
const SKIP_PATH =
  /(?:^|\/)(?:icons?|icon-fonts?|fonts?|flags|admin|node_modules|woocommerce\/assets|svg)(?:\/|$)/i;
const MIN_BYTES = 4_000;

function roleFromPath(relativePath: string): {
  roleHint: ThemeImageAsset["roleHint"];
  rank: number;
} {
  const p = relativePath.toLowerCase();
  if (/hero|banner|slider|slide|masthead|header-bg|home-bg|cover|jumbotron/.test(p)) {
    return { roleHint: "hero", rank: 100 };
  }
  if (/about|team|service|feature|gallery|portfolio|work|testimonial|trust/.test(p)) {
    return { roleHint: "section", rank: 60 };
  }
  if (/thumb|avatar|logo|favicon|sprite|pattern|bg-pattern/.test(p)) {
    return { roleHint: "any", rank: 5 };
  }
  return { roleHint: "any", rank: 30 };
}

function normalizePublicUrl(url: string, wpUrl: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  const base = normalizeWpUrl(wpUrl);

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const wpHost = new URL(base).host;
      if (parsed.host !== wpHost && !/\/wp-content\/themes\//i.test(trimmed)) {
        return null;
      }
      return parsed.href;
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  if (trimmed.startsWith("/")) {
    return `${base}${trimmed}`;
  }

  return `${base}/${trimmed.replace(/^\/+/, "")}`;
}

export function extractImageUrlsFromMarkup(
  markup: string,
  wpUrl: string
): string[] {
  if (!markup.trim()) return [];
  const found = new Set<string>();

  const srcRe = /<img\b[^>]*\bsrc=(["'])(.*?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = srcRe.exec(markup))) {
    const url = normalizePublicUrl(m[2], wpUrl);
    if (url) found.add(url);
  }

  const urlInCss =
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
  while ((m = urlInCss.exec(markup))) {
    const raw = m[2];
    if (!IMAGE_EXT.test(raw)) continue;
    const url = normalizePublicUrl(raw, wpUrl);
    if (url) found.add(url);
  }

  const wpBlockUrl = /"url"\s*:\s*"(https?:[^"]+\.(?:jpe?g|png|webp|gif))"/gi;
  while ((m = wpBlockUrl.exec(markup))) {
    const url = normalizePublicUrl(m[1], wpUrl);
    if (url) found.add(url);
  }

  return [...found];
}

function zipRelativePath(entryName: string, themeSlug: string): string | null {
  const normalized = entryName.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (parts[0].toLowerCase() === themeSlug.toLowerCase()) {
    return parts.slice(1).join("/");
  }
  return parts.join("/");
}

export function catalogImagesFromThemeZip(
  zipPath: string,
  wpUrl: string,
  themeSlug: string
): ThemeImageAsset[] {
  const zip = new AdmZip(zipPath);
  const base = normalizeWpUrl(wpUrl);
  const assets: ThemeImageAsset[] = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, "/");
    if (!IMAGE_EXT.test(name) || SKIP_PATH.test(name)) continue;
    const data = entry.getData();
    if (!data || data.length < MIN_BYTES) continue;

    const relativePath = zipRelativePath(name, themeSlug);
    if (!relativePath || SKIP_PATH.test(relativePath)) continue;

    const { roleHint, rank } = roleFromPath(relativePath);
    const publicUrl = `${base}/wp-content/themes/${themeSlug}/${relativePath.replace(/\\/g, "/")}`;

    assets.push({
      key: publicUrl,
      publicUrl,
      filename: relativePath.split("/").pop() ?? "image.jpg",
      relativePath,
      roleHint,
      rank,
      source: "theme-zip",
    });
  }

  return assets;
}

function assetFromPublicUrl(
  url: string,
  source: ThemeImageAsset["source"]
): ThemeImageAsset | null {
  if (!/\/wp-content\/themes\//i.test(url)) return null;
  const pathMatch = url.match(/\/wp-content\/themes\/[^/]+\/(.+)$/i);
  const relativePath = pathMatch?.[1] ?? url.split("/").pop() ?? "image.jpg";
  const { roleHint, rank } = roleFromPath(relativePath);
  return {
    key: url,
    publicUrl: url,
    filename: relativePath.split("/").pop() ?? "image.jpg",
    relativePath,
    roleHint,
    rank: rank + (source === "reference-markup" ? 15 : 10),
    source,
  };
}

export function buildThemeImageCatalog(
  config: LoadedSiteConfig,
  profile: ThemeStyleProfile,
  extraMarkup?: string
): ThemeImageAsset[] {
  const byKey = new Map<string, ThemeImageAsset>();
  const themeSlug =
    profile.themeSlug?.trim() ||
    (config.activeThemeZipPath?.trim()
      ? detectThemeSlugFromZip(resolveLocalThemePath(config.activeThemeZipPath))
      : "");

  if (config.activeThemeZipPath?.trim() && themeSlug) {
    try {
      for (const asset of catalogImagesFromThemeZip(
        resolveLocalThemePath(config.activeThemeZipPath),
        config.wpUrl,
        themeSlug
      )) {
        byKey.set(asset.key, asset);
      }
    } catch {
      /* optional */
    }
  }

  const markupSources = [
    profile.referenceMarkup ?? "",
    extraMarkup ?? "",
  ];
  for (const markup of markupSources) {
    for (const url of extractImageUrlsFromMarkup(markup, config.wpUrl)) {
      const asset = assetFromPublicUrl(url, "reference-markup");
      if (asset) {
        const existing = byKey.get(asset.key);
        if (!existing || asset.rank > existing.rank) {
          byKey.set(asset.key, asset);
        }
      }
    }
  }

  return [...byKey.values()].sort((a, b) => b.rank - a.rank);
}

export function pickThemeImagesForSlots(
  catalog: ThemeImageAsset[],
  slots: Array<{ role: "hero" | "section" }>
): ThemeImageAsset[] {
  if (catalog.length === 0 || slots.length === 0) return [];

  const used = new Set<string>();
  const heroes = catalog.filter((c) => c.roleHint === "hero");
  const sections = catalog.filter((c) => c.roleHint === "section");
  const general = catalog.filter((c) => c.roleHint === "any");

  const pickFrom = (pool: ThemeImageAsset[]): ThemeImageAsset | undefined => {
    for (const item of pool) {
      if (!used.has(item.key)) {
        used.add(item.key);
        return item;
      }
    }
    for (const item of catalog) {
      if (!used.has(item.key)) {
        used.add(item.key);
        return item;
      }
    }
    return undefined;
  };

  const picked: ThemeImageAsset[] = [];
  for (const slot of slots) {
    const pool =
      slot.role === "hero"
        ? [...heroes, ...general, ...sections]
        : [...sections, ...general, ...heroes];
    const asset = pickFrom(pool);
    if (asset) picked.push(asset);
  }
  return picked;
}

function mimeFromFilename(filename: string): string {
  const ext = filename.toLowerCase();
  if (ext.endsWith(".png")) return "image/png";
  if (ext.endsWith(".webp")) return "image/webp";
  if (ext.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/** Read theme image bytes from uploaded zip when live theme URL fetch fails. */
export function readThemeImageBytesFromZip(
  config: LoadedSiteConfig,
  asset: ThemeImageAsset,
  themeSlug: string
): { buffer: Buffer; mimeType: string } | null {
  if (!config.activeThemeZipPath?.trim() || asset.source !== "theme-zip") {
    return null;
  }
  try {
    const zip = new AdmZip(resolveLocalThemePath(config.activeThemeZipPath));
    const target = asset.relativePath.replace(/\\/g, "/").toLowerCase();
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const name = entry.entryName.replace(/\\/g, "/");
      const rel = zipRelativePath(name, themeSlug);
      if (rel?.replace(/\\/g, "/").toLowerCase() === target) {
        const buffer = entry.getData();
        if (!buffer?.length) return null;
        return { buffer, mimeType: mimeFromFilename(asset.filename) };
      }
    }
  } catch {
    return null;
  }
  return null;
}
