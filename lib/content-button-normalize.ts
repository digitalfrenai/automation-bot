import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { wpRequest } from "@/lib/wordpress-client";

export const CONTENT_BUTTON_CSS_MARKER = "/* wp-bot-content-buttons */";

const CTA_CLASS = "wp-bot-cta";
const SOCIAL_CLASS = "wp-bot-social";
const SOCIAL_ROW_CLASS = "wp-bot-social-row";

const BUTTON_LIKE_CLASS =
  /\b(?:btn|button|cta|wp-block-button__link|wp-element-button)\b/i;

const SOCIAL_HREF =
  /facebook\.com|fb\.com|twitter\.com|(?:^|[/"'])x\.com|linkedin\.com|instagram\.com|youtube\.com|tiktok\.com|t\.me/i;

const SOCIAL_HINT_CLASS =
  /\b(?:social|facebook|twitter|linkedin|instagram|icon-link|share)\b/i;

const SOCIAL_GLYPH_TEXT = /^(?:f|x|in|yt|ig|▶|►|●|➤)$/i;

function parseStyle(style: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of style.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    const val = trimmed.slice(idx + 1).trim();
    if (key) map.set(key, val);
  }
  return map;
}

function serializeStyle(map: Map<string, string>): string {
  return [...map.entries()].map(([k, v]) => `${k}: ${v}`).join("; ");
}

function hrefFromAttrs(attrs: string): string {
  const m = attrs.match(/\bhref=(["'])(.*?)\1/i);
  return m?.[2]?.trim() ?? "";
}

function mergeCtaStyles(existing: string): string {
  const map = parseStyle(existing);
  const set = (prop: string, value: string) => {
    if (!map.has(prop)) map.set(prop, value);
  };
  set("display", "inline-block");
  set("padding", "0.85em 1.5em");
  set("line-height", "1.35");
  set("text-align", "center");
  set("box-sizing", "border-box");
  set("flex-shrink", "0");
  set("flex-grow", "0");
  set("min-width", "9.5rem");
  set("max-width", "100%");
  set("white-space", "normal");
  set("word-break", "normal");
  map.delete("width");
  if (map.get("flex") === "1" || map.get("flex") === "1 1 auto") {
    map.set("flex", "0 0 auto");
  }
  return serializeStyle(map);
}

function mergeSocialIconStyles(existing: string): string {
  const map = parseStyle(existing);
  map.set("display", "inline-flex");
  map.set("align-items", "center");
  map.set("justify-content", "center");
  map.set("width", "2.5rem");
  map.set("height", "2.5rem");
  map.set("min-width", "2.5rem");
  map.set("max-width", "2.5rem");
  map.set("flex", "0 0 auto");
  map.set("flex-grow", "0");
  map.set("flex-shrink", "0");
  map.set("padding", "0");
  map.set("box-sizing", "border-box");
  map.set("text-align", "center");
  map.set("line-height", "1");
  map.set("text-decoration", "none");
  map.set("border-radius", "50%");
  map.delete("flex-basis");
  return serializeStyle(map);
}

function mergeFlexRowStyles(existing: string): string {
  const map = parseStyle(existing);
  const display = map.get("display") ?? "";
  if (!/flex/i.test(display)) return existing;
  const set = (prop: string, value: string) => {
    if (!map.has(prop)) map.set(prop, value);
  };
  set("flex-wrap", "wrap");
  set("align-items", "center");
  set("gap", "0.65rem");
  set("justify-content", "flex-start");
  map.delete("width");
  if (map.get("width") === "100%" && !map.has("max-width")) {
    map.set("max-width", "100%");
  }
  return serializeStyle(map);
}

function mergeSocialRowStyles(existing: string): string {
  const map = parseStyle(existing);
  map.set("display", "flex");
  map.set("flex-wrap", "wrap");
  map.set("align-items", "center");
  map.set("justify-content", "center");
  map.set("gap", "0.5rem");
  map.set("width", "auto");
  map.set("max-width", "100%");
  map.delete("flex");
  return serializeStyle(map);
}

function looksLikeSocialLink(openTag: string, linkText: string): boolean {
  if (new RegExp(`\\b${SOCIAL_CLASS}\\b`).test(openTag)) return true;
  if (SOCIAL_HREF.test(hrefFromAttrs(openTag.replace(/^<\/?a\b/i, "")))) return true;
  if (SOCIAL_HINT_CLASS.test(openTag)) return true;
  const text = linkText.replace(/\s+/g, " ").trim();
  if (text.length > 0 && text.length <= 3 && SOCIAL_GLYPH_TEXT.test(text)) {
    return true;
  }
  if (
    text.length <= 12 &&
    /facebook|twitter|\bx\b|linkedin|instagram|youtube/i.test(text)
  ) {
    return true;
  }
  return false;
}

function looksLikeButtonTag(openTag: string, linkText?: string): boolean {
  if (linkText !== undefined && looksLikeSocialLink(openTag, linkText)) {
    return false;
  }
  if (/^<button\b/i.test(openTag)) return true;
  if (!/^<a\b/i.test(openTag)) return false;
  if (BUTTON_LIKE_CLASS.test(openTag)) return true;
  const styleMatch = openTag.match(/\bstyle=(["'])([\s\S]*?)\1/i);
  if (styleMatch) {
    const css = styleMatch[2].toLowerCase();
    if (
      /background/.test(css) &&
      (/padding/.test(css) || /border-radius/.test(css))
    ) {
      const text = (linkText ?? "").trim();
      if (text.length <= 3 && SOCIAL_GLYPH_TEXT.test(text)) return false;
      return true;
    }
  }
  return false;
}

function addClassToOpenTag(openTag: string, className: string): string {
  if (new RegExp(`\\b${className}\\b`).test(openTag)) return openTag;
  const classMatch = openTag.match(/\bclass=(["'])([\s\S]*?)\1/i);
  if (classMatch) {
    const quote = classMatch[1];
    const next = `${classMatch[2].trim()} ${className}`.trim();
    return openTag.replace(classMatch[0], `class=${quote}${next}${quote}`);
  }
  return openTag.replace(/^<\w+\b/, (head) => `${head} class="${className}"`);
}

function patchOpenTagStyles(
  openTag: string,
  merge: (style: string) => string
): string {
  const styleMatch = openTag.match(/\bstyle=(["'])([\s\S]*?)\1/i);
  if (!styleMatch) {
    return openTag.replace(/^<\w+\b/, (head) => `${head} style="${merge("")}"`);
  }
  const quote = styleMatch[1];
  const merged = merge(styleMatch[2]);
  return openTag.replace(styleMatch[0], `style=${quote}${merged}${quote}`);
}

function normalizeSocialLinks(html: string): string {
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const open = `<a${attrs}>`;
    if (!looksLikeSocialLink(open, text)) return full;

    let nextOpen = addClassToOpenTag(open, SOCIAL_CLASS);
    nextOpen = patchOpenTagStyles(nextOpen, mergeSocialIconStyles);
    return `${nextOpen}${inner}</a>`;
  });
}

function wrapSocialRows(html: string): string {
  return html.replace(
    /<(div|p|span|nav|ul)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, attrs: string, inner: string) => {
      const socialCount = (inner.match(new RegExp(`\\b${SOCIAL_CLASS}\\b`, "g")) ?? [])
        .length;
      if (socialCount < 2) return full;
      const nonSocial = inner
        .replace(/<a\b[\s\S]*?<\/a>/gi, "")
        .replace(/\s+/g, "")
        .replace(/<!--[\s\S]*?-->/g, "");
      if (nonSocial.length > 40) return full;

      const open = `<${tag}${attrs}>`;
      const nextOpen = patchOpenTagStyles(
        addClassToOpenTag(open, SOCIAL_ROW_CLASS),
        mergeSocialRowStyles
      );
      return `${nextOpen}${inner}</${tag}>`;
    }
  );
}

/** Tag CTAs, social icons, and relax cramped flex rows in generated page HTML. */
export function normalizeContentButtons(html: string): string {
  if (!html.trim()) return html;

  let out = normalizeSocialLinks(html);
  out = wrapSocialRows(out);

  out = out.replace(
    /<(div|section|p|span|ul|li|nav|article)\b([^>]*)>/gi,
    (full, _tag: string, rest: string) => {
      const open = `<${_tag}${rest}>`;
      const styleMatch = rest.match(/\bstyle=(["'])([\s\S]*?)\1/i);
      if (!styleMatch) return full;
      const css = styleMatch[2];
      if (!/display\s*:\s*flex/i.test(css)) return full;
      const merged = mergeFlexRowStyles(css);
      if (merged === css) return full;
      return patchOpenTagStyles(open, () => merged);
    }
  );

  out = out.replace(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (full, tag, rest, inner) => {
    const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const open = `<${tag}${rest}>`;
    if (new RegExp(`\\b${SOCIAL_CLASS}\\b`).test(open)) return full;
    if (!looksLikeButtonTag(open, text)) return full;
    let nextOpen = addClassToOpenTag(open, CTA_CLASS);
    nextOpen = patchOpenTagStyles(nextOpen, mergeCtaStyles);
    return `${nextOpen}${inner}</${tag}>`;
  });

  return out;
}

export function contentButtonCssBlock(): string {
  return `${CONTENT_BUTTON_CSS_MARKER}
.entry-content .wp-block-buttons,
.entry-content .wp-block-button,
.entry-content .wp-block-buttons-is-layout-flex {
  flex-wrap: wrap !important;
  gap: 0.75rem !important;
  align-items: center !important;
}
.entry-content .wp-block-button__link,
.entry-content .wp-element-button,
.entry-content a.${CTA_CLASS}:not(.${SOCIAL_CLASS}),
.entry-content button.${CTA_CLASS} {
  display: inline-block !important;
  padding: 0.85em 1.5em !important;
  line-height: 1.35 !important;
  text-align: center !important;
  box-sizing: border-box !important;
  flex: 0 0 auto !important;
  flex-shrink: 0 !important;
  min-width: 9.5rem;
  max-width: 100%;
  width: auto !important;
  white-space: normal !important;
  word-break: normal !important;
}
.entry-content .wp-block-button .wp-block-button__link {
  width: auto !important;
}
.entry-content .${SOCIAL_ROW_CLASS} {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 0.5rem !important;
  width: auto !important;
  max-width: 100% !important;
}
.entry-content a.${SOCIAL_CLASS} {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 2.5rem !important;
  height: 2.5rem !important;
  min-width: 2.5rem !important;
  max-width: 2.5rem !important;
  flex: 0 0 auto !important;
  padding: 0 !important;
  line-height: 1 !important;
  text-align: center !important;
  box-sizing: border-box !important;
  border-radius: 50% !important;
  text-decoration: none !important;
}
.entry-content a.${SOCIAL_CLASS} img,
.entry-content a.${SOCIAL_CLASS} svg {
  width: 1.1rem !important;
  height: 1.1rem !important;
  max-width: 1.1rem !important;
  object-fit: contain !important;
}`;
}

export async function applyContentButtonCss(
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<void> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const block = contentButtonCssBlock();

  try {
    const settings = await wpRequest<{ custom_css?: string }>(
      config,
      "/wp-json/wp/v2/settings"
    );
    let css = settings.custom_css ?? "";
    if (css.includes(CONTENT_BUTTON_CSS_MARKER)) {
      css = css.replace(
        /\/\* wp-bot-content-buttons \*\/[\s\S]*?(?=\/\* wp-bot-|\s*$)/,
        block
      );
    } else {
      css = css.trim() ? `${css.trim()}\n\n${block}` : block;
    }
    await wpRequest(config, "/wp-json/wp/v2/settings", {
      method: "POST",
      body: JSON.stringify({ custom_css: css }),
    });
    log.info("Applied page content button spacing CSS (Additional CSS).", {
      phase: "phase1",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "custom_css failed";
    log.warn(`Could not apply content button CSS: ${message}`, { phase: "phase1" });
  }
}
