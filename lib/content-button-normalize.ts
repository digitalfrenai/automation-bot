import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { wpRequest } from "@/lib/wordpress-client";

export const CONTENT_BUTTON_CSS_MARKER = "/* wp-bot-content-buttons */";

const CTA_CLASS = "wp-bot-cta";
const SOCIAL_CLASS = "wp-bot-social";

const BUTTON_LIKE_CLASS =
  /\b(?:btn|button|cta|wp-block-button__link|wp-element-button|fa-|fab |fas |social)\b/i;

const SOCIAL_NETWORKS: Array<{
  id: string;
  href: RegExp;
  classOrLabel: RegExp;
  letterInner: RegExp;
  label: string;
  svg: string;
}> = [
  {
    id: "facebook",
    href: /facebook\.com|fb\.com/i,
    classOrLabel: /fa-facebook|\bfacebook\b/i,
    letterInner: /^f$/i,
    label: "Facebook",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H8v3h2v7h3v-7h2.6l.4-3H13v-2c0-.6.4-1 1-1z"/></svg>',
  },
  {
    id: "x",
    href: /twitter\.com|(?:^|\/\/)(?:www\.)?x\.com\//i,
    classOrLabel: /fa-x-twitter|fa-twitter|\btwitter\b/i,
    letterInner: /^(x|t)$/i,
    label: "X",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M18.2 3H21l-6.5 7.4L22 21h-6.2l-4.9-6.4L5.4 21H2.6l7-8L2 3h6.3l4.4 5.8L18.2 3zm-1.1 16.2h1.7L7 4.7H5.2l11.9 14.5z"/></svg>',
  },
  {
    id: "instagram",
    href: /instagram\.com/i,
    classOrLabel: /fa-instagram|\binstagram\b/i,
    letterInner: /^(ig|in)$/i,
    label: "Instagram",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H7zm10.2 1.3a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zM12 8.2A3.8 3.8 0 1 1 8.2 12 3.8 3.8 0 0 1 12 8.2zm0 2A1.8 1.8 0 1 0 13.8 12 1.8 1.8 0 0 0 12 10.2z"/></svg>',
  },
  {
    id: "linkedin",
    href: /linkedin\.com/i,
    classOrLabel: /fa-linkedin|\blinkedin\b/i,
    letterInner: /^(in|li)$/i,
    label: "LinkedIn",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6.5 9H4V20h2.5V9zM5.2 4A1.5 1.5 0 1 0 6.7 5.5 1.5 1.5 0 0 0 5.2 4zM20 20h-2.5v-5.6c0-1.6-.6-2.6-2-2.6s-2.1 1-2.1 2.6V20H11V9h2.4v1.5h.1c.4-.8 1.5-1.7 3.1-1.7 2.2 0 3.4 1.4 3.4 4.3V20z"/></svg>',
  },
  {
    id: "youtube",
    href: /youtube\.com|youtu\.be/i,
    classOrLabel: /fa-youtube|\byoutube\b/i,
    letterInner: /^(yt|▶|►)$/i,
    label: "YouTube",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M23 12.2s0-3.2-.4-4.7c-.2-1-1-1.8-2-2C18.8 5 12 5 12 5s-6.8 0-8.6.5c-1 .2-1.8 1-2 2C1 9 1 12.2 1 12.2s0 3.2.4 4.7c.2 1 1 1.8 2 2C5.2 19.4 12 19.4 12 19.4s6.8 0 8.6-.5c1-.2 1.8-1 2-2 .4-1.5.4-4.7.4-4.7zM9.8 15.5V8.9l6.2 3.3-6.2 3.3z"/></svg>',
  },
];

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

function mergeCtaStyles(existing: string): string {
  const map = parseStyle(existing);
  const set = (prop: string, value: string) => {
    if (!map.has(prop)) map.set(prop, value);
  };
  set("display", "inline-block");
  set("padding", "0.75em 1.35em");
  set("line-height", "1.35");
  set("text-align", "center");
  set("box-sizing", "border-box");
  set("flex-shrink", "0");
  set("min-width", "9.5rem");
  set("max-width", "100%");
  set("white-space", "normal");
  set("word-break", "normal");
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
  set("gap", "0.75rem");
  set("justify-content", "flex-start");
  return serializeStyle(map);
}

function detectSocialNetwork(openTag: string, inner = ""): (typeof SOCIAL_NETWORKS)[number] | null {
  const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  for (const network of SOCIAL_NETWORKS) {
    if (network.href.test(openTag)) return network;
    if (network.classOrLabel.test(openTag)) return network;
    if (text && network.letterInner.test(text) && /social|share|icon|fa-|fab /i.test(openTag)) {
      return network;
    }
  }

  const letterOnly = text.length <= 2;
  if (letterOnly && text) {
    const byLetter = SOCIAL_NETWORKS.find(
      (n) => n.letterInner.test(text) && n.id !== "instagram" && n.id !== "linkedin"
    );
    if (byLetter && /href=/i.test(openTag)) return byLetter;
  }
  return null;
}

function looksLikeButtonTag(openTag: string): boolean {
  if (/^<button\b/i.test(openTag)) return true;
  if (!/^<a\b/i.test(openTag)) return false;
  if (BUTTON_LIKE_CLASS.test(openTag)) return true;
  if (detectSocialNetwork(openTag)) return true;
  const styleMatch = openTag.match(/\bstyle=(["'])([\s\S]*?)\1/i);
  if (styleMatch) {
    const css = styleMatch[2].toLowerCase();
    if (
      /background/.test(css) &&
      (/padding/.test(css) || /border-radius/.test(css))
    ) {
      return true;
    }
  }
  return false;
}

function mergeSocialStyles(existing: string): string {
  const map = parseStyle(existing);
  map.set("display", "inline-flex");
  map.set("align-items", "center");
  map.set("justify-content", "center");
  map.set("width", "2.35rem");
  map.set("height", "2.35rem");
  map.set("min-width", "2.35rem");
  map.set("padding", "0");
  map.set("line-height", "1");
  map.set("border-radius", "999px");
  map.set("text-decoration", "none");
  map.set("flex-shrink", "0");
  map.set("box-sizing", "border-box");
  if (!map.has("background") && !map.has("background-color")) {
    map.set("background", "#111827");
  }
  if (!map.has("color")) {
    map.set("color", "#ffffff");
  }
  return serializeStyle(map);
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

/** Tag CTAs and relax cramped flex rows in generated page HTML / Gutenberg static HTML. */
export function normalizeContentButtons(html: string): string {
  if (!html.trim()) return html;

  let out = html.replace(
    /<(div|section|p|span|ul|li|nav)\b([^>]*)>/gi,
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

  out = out.replace(
    /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, rest: string, inner: string) => {
      const open = `<${tag}${rest}>`;
      const social = detectSocialNetwork(open, inner);
      if (social) {
        let next = addClassToOpenTag(open, SOCIAL_CLASS);
        next = patchOpenTagStyles(next, mergeSocialStyles);
        if (!/\baria-label=/i.test(next)) {
          next = next.replace(/^<\w+\b/, (head) => `${head} aria-label="${social.label}"`);
        }
        return `${next}${social.svg}</${tag}>`;
      }
      if (!looksLikeButtonTag(open)) return full;
      let next = addClassToOpenTag(open, CTA_CLASS);
      next = patchOpenTagStyles(next, mergeCtaStyles);
      return `${next}${inner}</${tag}>`;
    }
  );

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
.entry-content a.${CTA_CLASS},
.entry-content button.${CTA_CLASS} {
  display: inline-block !important;
  padding: 0.75em 1.35em !important;
  line-height: 1.35 !important;
  text-align: center !important;
  box-sizing: border-box !important;
  flex-shrink: 0 !important;
  min-width: 9.5rem;
  max-width: 100%;
  white-space: normal !important;
  word-break: normal !important;
}
.entry-content .wp-block-button .wp-block-button__link {
  width: auto !important;
}
.entry-content a.${SOCIAL_CLASS},
.entry-content button.${SOCIAL_CLASS} {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 2.35rem !important;
  height: 2.35rem !important;
  min-width: 2.35rem !important;
  padding: 0 !important;
  border-radius: 999px !important;
  line-height: 1 !important;
  text-decoration: none !important;
  flex-shrink: 0 !important;
}
.entry-content a.${SOCIAL_CLASS} svg,
.entry-content button.${SOCIAL_CLASS} svg {
  display: block;
  width: 16px;
  height: 16px;
}
.entry-content a.${SOCIAL_CLASS} i,
.entry-content button.${SOCIAL_CLASS} i {
  display: none !important;
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
