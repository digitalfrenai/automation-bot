import type { LoadedSiteConfig } from "@/lib/config-loader";
import {
  buildGutenbergSystemPrompt,
  buildHtmlSystemPrompt,
  buildScreenshotLedHtmlSystemPrompt,
  detectContentFormat,
  type ContentFormat,
  type ContentFormatContext,
} from "@/lib/content-format";
import type { LogSink } from "@/lib/pipeline-logger";
import { buildStructuredPageJsonPrompt } from "@/lib/page-content-structure";
import {
  formatScreenshotLedThemeGuide,
  isScreenshotLedDesignMode,
} from "@/lib/design-reference-vision";
import {
  extractLogoPalette,
  formatLogoPalettePrompt,
} from "@/lib/logo-palette";
import {
  formatThemeStylePrompt,
  loadThemeStyleProfile,
} from "@/lib/theme-style-profile";

export type GenerationContext = ContentFormatContext & {
  themeGuide: string;
  screenshotLedDesign: boolean;
  /** Full theme reference markup for template-fill (structure locked, text swapped). */
  templateMarkup?: string;
  templateMarkupSource?: string;
};

function contentFormatEnvOverride(): ContentFormat | null {
  const v = process.env.CONTENT_FORMAT?.trim().toLowerCase();
  if (v === "html" || v === "gutenberg" || v === "elementor" || v === "divi") {
    return v;
  }
  return null;
}

export async function loadGenerationContext(
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<GenerationContext> {
  const themeProfile = await loadThemeStyleProfile(config, onLog);
  const screenshotLedDesign = isScreenshotLedDesignMode(config);
  const formatCtx =
    screenshotLedDesign && !contentFormatEnvOverride()
      ? {
          format: "html" as ContentFormat,
          reasons: ["screenshot-led design (no theme zip)"],
        }
      : await detectContentFormat(config, themeProfile, onLog);
  const themeGuide = screenshotLedDesign
    ? formatScreenshotLedThemeGuide(themeProfile)
    : formatThemeStylePrompt(themeProfile, formatCtx.format);
  const logoPalette = await extractLogoPalette(config, onLog);
  const brandGuide = formatLogoPalettePrompt(logoPalette);
  return {
    ...formatCtx,
    themeGuide: brandGuide ? `${themeGuide}\n\n${brandGuide}` : themeGuide,
    screenshotLedDesign,
    templateMarkup: screenshotLedDesign
      ? undefined
      : themeProfile.referenceMarkup,
    templateMarkupSource: screenshotLedDesign
      ? undefined
      : themeProfile.referenceMarkupSource,
  };
}

export function buildPageSystemPrompt(
  format: ContentFormat,
  themeGuide: string,
  options?: { screenshotLedDesign?: boolean }
): string {
  if (options?.screenshotLedDesign) {
    return buildScreenshotLedHtmlSystemPrompt(themeGuide);
  }
  if (format === "gutenberg") {
    return buildGutenbergSystemPrompt(themeGuide);
  }
  if (format === "elementor" || format === "divi") {
    return buildStructuredPageJsonPrompt("page");
  }
  return buildHtmlSystemPrompt(themeGuide);
}

export function buildBlogSystemPrompt(
  format: ContentFormat,
  themeGuide: string,
  includeExternal: boolean
): string {
  if (format === "gutenberg") {
    return `${buildGutenbergSystemPrompt(themeGuide)}

Blog structure (article layout — NOT a landing page):
- Exactly one H1 at the top (wp:heading level 1).
- Multiple H2 sections with H3 subheads where useful.
- Constrained wp:group sections only — no align full/wide, no viewport breakout CSS.
- Intro, body, takeaways, closing CTA block (simple group + buttons, same content width as body text).
- Every wp:image must include alt text.
- Add 2–4 internal links (/about, /services, /contact).
${includeExternal ? "- Add 1–2 reputable external links with rel=\"noopener noreferrer\" target=\"_blank\"." : "- Do not add external links."}
- 800–1200 words of visible copy.`;
  }

  if (format === "elementor" || format === "divi") {
    return `${buildStructuredPageJsonPrompt("post")}

Additional blog rules:
- Use 4–6 sections; first section kind "content" with heading as article title context.
- Include practical takeaways and a CTA section.
${includeExternal ? "- Mention 1–2 external references in body_html with full URLs." : "- No external links."}
- 800–1200 words total across sections.`;
  }

  return `You are an expert blog writer and front-end HTML author for WordPress.
Return ONLY a valid HTML fragment (no markdown fences, no explanations).

CRITICAL — WordPress theme context:
- The theme already renders site header, navigation, and footer.
- Output ONLY the article body for the editor content area.
- Do NOT include <header>, <footer>, <nav>, or site chrome.

${themeGuide}

Structure requirements:
- Exactly one <h1> (SEO-friendly title including the primary keyword).
- Multiple <h2> sections with logical <h3> subheads where useful.
- Intro, body sections, practical takeaways, and a closing CTA.
- Use semantic markup: <article> or <section>, <p>, <ul>, <ol>, <a>, <blockquote>, <figure>/<img> placeholders.
- Every <img> must include descriptive alt text (use placeholder src like https://placehold.co/800x450 if needed).
- Add 2–4 internal links using relative paths such as /about, /services, /contact (based on typical site pages).
${includeExternal ? "- Add 1–2 reputable external links (e.g. industry standards, government, or well-known educational sources) with rel=\"noopener noreferrer\" target=\"_blank\"." : "- Do not add external links."}
- Write 800–1200 words of visible copy.
- Natural keyword usage; no stuffing.
- No Gutenberg block comments or page-builder shortcodes.`;
}

export function buildRefreshSystemPrompt(
  format: ContentFormat,
  themeGuide: string
): string {
  const formatRule =
    format === "gutenberg"
      ? "- improved_html must be valid Gutenberg block markup (keep <!-- wp: --> comments)."
      : format === "elementor" || format === "divi"
        ? '- improved_html must be a JSON string matching { "sections": [...] } (same schema as generation).'
        : "- improved_html must be theme-aware HTML (preserve class attributes).";

  return `You are a website content maintenance editor for WordPress.
Return ONLY a JSON object:
{
  "needs_update": boolean,
  "update_summary": "short explanation",
  "improved_html": "full updated content in the same format as the current page",
  "seo_notes": "optional short notes"
}

Rules:
- Refresh outdated copy, weak SEO phrasing, stale CTAs, and thin sections.
- Preserve the page/post purpose and brand voice.
${formatRule}
- No header/footer/nav chrome.
- Exactly one <h1> (or hero heading) per page; logical hierarchy for posts.
- Improve internal links where natural (relative paths like /about, /services, /contact).
- Do not invent statistics unless they already appear in the source HTML; you may rephrase existing figures.
- If content is already strong and current, set needs_update=false and return the original content in improved_html.
- No markdown, no prose outside JSON.

${themeGuide}`;
}

export function grokUsesJsonObject(format: ContentFormat): boolean {
  return format === "elementor" || format === "divi";
}
