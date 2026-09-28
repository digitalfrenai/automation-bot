import AdmZip from "adm-zip";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { resolveLocalThemePath } from "@/lib/themeDeployer";
import type { ThemeStyleProfile } from "@/lib/theme-style-profile";
import { listWordPressPages, wpRequest } from "@/lib/wordpress-client";

export type ContentFormat = "html" | "gutenberg" | "elementor" | "divi";

export type ContentFormatContext = {
  format: ContentFormat;
  reasons: string[];
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const formatCache = new Map<string, { expires: number; ctx: ContentFormatContext }>();

function zipBuilderHints(zipPath: string): { elementor: boolean; divi: boolean } {
  try {
    const zip = new AdmZip(zipPath);
    let elementor = false;
    let divi = false;
    for (const entry of zip.getEntries()) {
      const name = entry.entryName.replace(/\\/g, "/").toLowerCase();
      if (/elementor/.test(name)) elementor = true;
      if (/divi|elegant-themes|et_pb/.test(name)) divi = true;
    }
    return { elementor, divi };
  } catch {
    return { elementor: false, divi: false };
  }
}

async function fetchActivePlugins(
  config: LoadedSiteConfig
): Promise<string[]> {
  try {
    const plugins = await wpRequest<
      Array<{ plugin?: string; status?: string }> | Record<string, unknown>
    >(config, "/wp-json/wp/v2/plugins?status=active");
    if (!Array.isArray(plugins)) return [];
    return plugins
      .filter((p) => p.status === "active" && typeof p.plugin === "string")
      .map((p) => p.plugin!.toLowerCase());
  } catch {
    return [];
  }
}

function sampleContentSignals(raw: string): {
  gutenberg: boolean;
  elementor: boolean;
  divi: boolean;
} {
  const html = raw || "";
  return {
    gutenberg: /<!--\s*\/?wp:/i.test(html),
    elementor: /elementor|data-elementor-type/i.test(html),
    divi: /\[et_pb_|\bet_pb_section\b/i.test(html),
  };
}

async function sampleSiteContent(
  config: LoadedSiteConfig
): Promise<{ gutenberg: boolean; elementor: boolean; divi: boolean }> {
  const signals = { gutenberg: false, elementor: false, divi: false };
  try {
    const pages = await listWordPressPages(config, { perPage: 8, orderby: "modified" });
    for (const page of pages) {
      const raw = page.content?.raw || page.content?.rendered || "";
      const s = sampleContentSignals(raw);
      signals.gutenberg ||= s.gutenberg;
      signals.elementor ||= s.elementor;
      signals.divi ||= s.divi;
    }
  } catch {
    /* ignore */
  }

  try {
    const withMeta = await wpRequest<
      Array<{ id: number; meta?: Record<string, unknown> }>
    >(config, "/wp-json/wp/v2/pages?per_page=5&context=edit");
    if (Array.isArray(withMeta)) {
      for (const page of withMeta) {
        const meta = page.meta ?? {};
        if (meta._elementor_data || meta._elementor_edit_mode) {
          signals.elementor = true;
        }
      }
    }
  } catch {
    /* meta may not be exposed */
  }

  return signals;
}

export async function detectContentFormat(
  config: LoadedSiteConfig,
  themeProfile: ThemeStyleProfile,
  onLog?: LogSink
): Promise<ContentFormatContext> {
  const cacheKey = `${config.id}:${config.activeThemeZipPath ?? ""}:${config.wpUrl}:${themeProfile.themeSlug ?? ""}`;
  const cached = formatCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.ctx;
  }

  const log = createPipelineLogger(onLog ?? (() => undefined));
  const reasons: string[] = [];

  let zipElementor = false;
  let zipDivi = false;
  if (config.activeThemeZipPath?.trim()) {
    const hints = zipBuilderHints(resolveLocalThemePath(config.activeThemeZipPath));
    zipElementor = hints.elementor;
    zipDivi = hints.divi;
    if (zipElementor) reasons.push("theme zip references Elementor");
    if (zipDivi) reasons.push("theme zip references Divi");
  }

  const plugins = await fetchActivePlugins(config);
  const elementorPlugin = plugins.some(
    (p) => p.includes("elementor/elementor.php") || p.includes("elementor")
  );
  const diviPlugin = plugins.some(
    (p) =>
      p.includes("divi-builder") ||
      p.includes("elegant-themes") ||
      p.includes("divi")
  );
  if (elementorPlugin) reasons.push("Elementor plugin active");
  if (diviPlugin) reasons.push("Divi Builder plugin active");

  const themeSlug = (themeProfile.themeSlug || "").toLowerCase();
  const themeName = (themeProfile.themeName || "").toLowerCase();
  const diviTheme = /divi|elegant/.test(themeSlug) || /divi|elegant/.test(themeName);

  const siteSignals = await sampleSiteContent(config);
  if (siteSignals.elementor) reasons.push("existing pages use Elementor");
  if (siteSignals.divi) reasons.push("existing pages use Divi shortcodes");
  if (siteSignals.gutenberg) reasons.push("existing pages use Gutenberg blocks");

  let format: ContentFormat = "html";

  if (elementorPlugin || siteSignals.elementor) {
    format = "elementor";
  } else if (
    diviPlugin ||
    diviTheme ||
    siteSignals.divi ||
    (zipDivi && (diviPlugin || diviTheme))
  ) {
    format = "divi";
  } else if (themeProfile.isBlockTheme || siteSignals.gutenberg) {
    format = "gutenberg";
  } else {
    format = "html";
    reasons.push("fallback to theme-class HTML");
  }

  const ctx: ContentFormatContext = { format, reasons };
  log.info(
    `Content format: ${format}${reasons.length ? ` (${reasons.slice(0, 3).join("; ")})` : ""}.`,
    { phase: "setup" }
  );

  formatCache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, ctx });
  return ctx;
}

export function buildGutenbergSystemPrompt(themeGuide: string): string {
  return `You are an expert WordPress block editor (Gutenberg) author.
Return ONLY valid Gutenberg block markup: HTML comments <!-- wp:... --> plus matching static HTML (no markdown fences).

CRITICAL:
- Theme already renders header, navigation, and footer — output ONLY main content blocks.
- Do NOT include <header>, <footer>, <nav>, or site chrome.

Allowed core blocks only:
wp:group, wp:columns, wp:column, wp:heading, wp:paragraph, wp:buttons, wp:button, wp:list, wp:image, wp:separator, wp:quote, wp:spacer

Rules:
- Use wp:group with layout {"type":"constrained"} ONLY — never align full/wide (content must stay inside the theme content column).
- Exactly one wp:heading level 1 for pages; blog posts use one H1 at top.
- Prefer theme palette classes on groups/buttons when known: ${themeGuide.includes("Palette") ? "use has-*-background-color / has-*-color from theme guide" : "use sensible block styles"}.
- No Elementor/Divi shortcodes, no third-party block namespaces.
- No inline style attributes for width, margin, or position. No 100vw, calc(), or breakout CSS.
- Complete replacement content on each run — do not append duplicate heroes.

DESIGN CONSISTENCY (required — match active theme spacing, not a plain document):
- Every section is a constrained wp:group (alternate has-*-background-color for band sections — background stays inside content width).
- Hero: constrained group with has-*-background-color → inner H1 + lead paragraph + wp:buttons (primary + secondary).
- For colored bands: nested pattern only if needed — outer constrained group with background, never viewport breakout.
- Services/benefits: wp:columns with 2–4 wp:column cards (each column: H3 + short paragraph).
- Do NOT output long runs of bare wp:paragraph blocks without group/column wrappers.
- Visible headings are human-readable (e.g. "How we work") — NEVER SEO title strings with pipes (|).
- Reuse the same button block style and section padding pattern across all sections on the page.

${themeGuide}`;
}

export function buildHtmlSystemPrompt(themeGuide: string): string {
  return `You are an expert conversion copywriter and front-end HTML author for WordPress sites.
Return ONLY valid HTML fragment content (no markdown fences, no explanations).

CRITICAL — WordPress theme context:
- The active WordPress theme already renders the site header, primary navigation, and footer.
- Output ONLY the main page body that belongs in the editor content area (between header and footer).
- Do NOT include <header>, <footer>, <nav>, site-wide menus, logo bars, copyright bars, or duplicate CTAs that belong in the theme chrome.
- Use <section> for heroes and content blocks — never wrap the page in <header> or <footer>.
- Do NOT use width:100vw, negative margins, or CSS that breaks out of the content column. No inline width/margin styles.

${themeGuide}

Do NOT include Gutenberg block comments, Elementor/Divi shortcodes, or page-builder tags.
Include exactly one <h1> per page. Write high-converting copy aligned to the business brief.`;
}

export function inferContentFormatFromStorage(
  html: string,
  meta?: Record<string, unknown>
): ContentFormat {
  if (meta && (meta._elementor_data || meta._elementor_edit_mode)) {
    return "elementor";
  }
  if (/\[et_pb_/i.test(html)) {
    return "divi";
  }
  if (/<!--\s*\/?wp:/i.test(html)) {
    return "gutenberg";
  }
  return "html";
}

export function formatLabel(format: ContentFormat): string {
  switch (format) {
    case "gutenberg":
      return "Gutenberg blocks";
    case "elementor":
      return "Elementor";
    case "divi":
      return "Divi Builder";
    default:
      return "theme HTML";
  }
}
