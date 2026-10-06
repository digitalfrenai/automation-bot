import type { LoadedSiteConfig } from "@/lib/config-loader";
import { normalizeWpUrl, wpRequest } from "@/lib/wordpress-client";

export type ActiveThemeRecord = {
  stylesheet: string;
  template?: string;
  name?: string;
  themeUri?: string;
  isBlockTheme?: boolean;
  status?: string;
};

type BlockPattern = {
  name?: string;
  title?: string;
  content?: string;
  categories?: string[];
};

const MAX_REFERENCE_CHARS = 5_500;

export async function fetchActiveThemeRecord(
  config: LoadedSiteConfig
): Promise<ActiveThemeRecord | null> {
  try {
    const themes = await wpRequest<
      Array<{
        stylesheet?: string;
        template?: string;
        status?: string;
        theme_uri?: string;
        name?: { rendered?: string } | string;
        theme_supports?: { "block-templates"?: boolean };
      }>
    >(config, "/wp-json/wp/v2/themes?status=active");

    const active = Array.isArray(themes)
      ? themes.find((t) => t.status === "active") ?? themes[0]
      : undefined;
    if (!active?.stylesheet) return null;

    const name =
      typeof active.name === "string"
        ? active.name
        : active.name?.rendered;

    return {
      stylesheet: active.stylesheet,
      template: active.template,
      name,
      themeUri: active.theme_uri,
      isBlockTheme: Boolean(active.theme_supports?.["block-templates"]),
      status: active.status,
    };
  } catch {
    return null;
  }
}

export async function fetchPublicThemeJson(
  wpUrl: string,
  stylesheet: string
): Promise<string> {
  const base = normalizeWpUrl(wpUrl);
  const slug = stylesheet.trim();
  if (!slug) return "";

  const candidates = [
    `${base}/wp-content/themes/${slug}/theme.json`,
    `${base}/wp-content/themes/${slug}/styles/theme.json`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        return (await res.text()).slice(0, 120_000);
      }
    } catch {
      /* try next */
    }
  }
  return "";
}

export async function fetchGlobalStylesJson(
  config: LoadedSiteConfig
): Promise<string> {
  try {
    const items = await wpRequest<
      Array<{ id?: number; settings?: unknown; styles?: unknown }>
    >(config, "/wp-json/wp/v2/global-styles?per_page=5&context=view");
    if (!Array.isArray(items) || items.length === 0) return "";
    const pick = items.find((g) => g.id && g.id > 0) ?? items[0];
    return JSON.stringify(
      { settings: pick.settings, styles: pick.styles },
      null,
      0
    ).slice(0, 40_000);
  } catch {
    return "";
  }
}

export async function fetchThemeBlockPatternSample(
  config: LoadedSiteConfig,
  stylesheet: string
): Promise<string> {
  const slug = stylesheet.toLowerCase();
  try {
    const patterns = await wpRequest<BlockPattern[]>(
      config,
      "/wp-json/wp/v2/block-patterns/patterns"
    );
    if (!Array.isArray(patterns) || patterns.length === 0) return "";

    const scored = patterns
      .filter((p) => typeof p.content === "string" && p.content.trim())
      .map((p) => {
        const name = (p.name ?? "").toLowerCase();
        const title = (p.title ?? "").toLowerCase();
        let score = 0;
        if (name.includes(slug) || name.includes(slug.replace(/-/g, ""))) {
          score += 5;
        }
        if (/hero|home|landing|services|feature|cta/i.test(`${name} ${title}`)) {
          score += 3;
        }
        if (p.categories?.includes("featured")) score += 1;
        return { p, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0]?.p;
    return best?.content?.trim().slice(0, MAX_REFERENCE_CHARS) ?? "";
  } catch {
    return "";
  }
}

export async function fetchFrontPageBlockSample(
  config: LoadedSiteConfig
): Promise<string> {
  try {
    const settings = await wpRequest<{
      page_on_front?: number;
      show_on_front?: string;
    }>(config, "/wp-json/wp/v2/settings");

    if (settings.show_on_front !== "page" || !settings.page_on_front) {
      return "";
    }

    const page = await wpRequest<{
      content?: { raw?: string; rendered?: string };
    }>(config, `/wp-json/wp/v2/pages/${settings.page_on_front}?context=edit`);

    const raw = page.content?.raw?.trim() ?? "";
    if (raw.includes("<!-- wp:") && raw.length > 400) {
      return raw.slice(0, MAX_REFERENCE_CHARS);
    }
    return "";
  } catch {
    return "";
  }
}

export async function fetchRenderedEntryContentSnippet(
  wpUrl: string
): Promise<string> {
  const base = normalizeWpUrl(wpUrl);
  try {
    const res = await fetch(base, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    const mainMatch =
      html.match(
        /<main[^>]*class=["'][^"']*site-main[^"']*["'][^>]*>([\s\S]*?)<\/main>/i
      ) ??
      html.match(
        /<div[^>]*class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
      );
    if (!mainMatch?.[1]) return "";
    return mainMatch[1].trim().slice(0, MAX_REFERENCE_CHARS);
  } catch {
    return "";
  }
}

export function summarizeBlockStructure(markup: string): string {
  if (!markup.trim()) return "";
  const groups = (markup.match(/<!--\s*wp:group/gi) ?? []).length;
  const columns = (markup.match(/<!--\s*wp:columns/gi) ?? []).length;
  const buttons = (markup.match(/<!--\s*wp:buttons/gi) ?? []).length;
  const headings = (markup.match(/<!--\s*wp:heading/gi) ?? []).length;
  const alignFull = /alignfull|full-width/i.test(markup);
  const alignWide = /alignwide/i.test(markup);
  const parts = [
    groups ? `${groups} group section(s)` : "",
    columns ? `${columns} column grid(s)` : "",
    buttons ? `${buttons} button row(s)` : "",
    headings ? `${headings} heading block(s)` : "",
    alignFull ? "uses alignfull bands" : "",
    alignWide ? "uses alignwide rows" : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "block markup present";
}

export function themeBrandLayoutHints(stylesheet: string, name?: string): string[] {
  const slug = `${stylesheet} ${name ?? ""}`.toLowerCase();
  const hints: string[] = [];

  if (/generatepress|generate-press|gp-/.test(slug)) {
    hints.push(
      "GeneratePress: alternate white and light-gray band sections (#ffffff / #f7f7f7); card grids in wp:columns; primary CTAs as wp:button with solid fill; keep copy inside constrained groups (theme adds outer grid-container via CSS)."
    );
  }
  if (/kadence|kt-|braine/.test(slug)) {
    hints.push(
      "Kadence family (incl. Braine child): use core Gutenberg blocks (wp:group, wp:columns, wp:buttons) with has-*-background-color bands; match Kadence spacing — do not dump a single wp:html block or raw HTML page."
    );
  }
  if (/astra|brainstorm/.test(slug)) {
    hints.push(
      "Astra: constrained inner groups inside alignfull sections; compact heading stack + CTA row in hero."
    );
  }
  if (/block-theme|twentytwenty/.test(slug)) {
    hints.push(
      "Block theme: prefer alignfull groups + wide/constrained inner layout from theme.json spacing."
    );
  }

  return hints;
}

export function pickBestReferenceMarkup(
  candidates: { source: string; markup: string }[]
): { source: string; markup: string } | null {
  const ranked = candidates
    .filter((c) => c.markup.trim().length > 200)
    .sort((a, b) => b.markup.length - a.markup.length);
  return ranked[0] ?? null;
}
