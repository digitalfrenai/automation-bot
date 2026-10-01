import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { wpRequest } from "@/lib/wordpress-client";

export const RESPONSIVE_CSS_MARKER = "/* wp-bot-responsive */";

const GRID_CLASS = "wp-bot-grid";
const FLEX_CLASS = "wp-bot-flex";
const COL_CLASS = "wp-bot-col";
const FS_XL_CLASS = "wp-bot-fs-xl";
const FS_LG_CLASS = "wp-bot-fs-lg";
const PAD_X_CLASS = "wp-bot-pad-x";
const PAD_Y_CLASS = "wp-bot-pad-y";
const FIXED_H_CLASS = "wp-bot-h";

const LAYOUT_TAGS =
  /<(div|section|article|aside|main|figure|ul|ol|li|header|footer|h1|h2|h3|h4|h5|h6|p|span|a|blockquote)\b([^>]*)>/gi;

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

/** Convert a CSS length to px (px / rem / em / pt). Returns null for %, vw, auto, etc. */
function lengthToPx(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(-?\d*\.?\d+)\s*(px|rem|em|pt)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "px").toLowerCase();
  if (unit === "px") return n;
  if (unit === "pt") return n * 1.333;
  return n * 16;
}

function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Number of columns a grid-template-columns value produces, or "auto" for auto-fit/fill. */
function gridColumnCount(value: string): number | "auto" | null {
  const v = value.trim();
  if (!v || /^(none|auto|1fr|100%)$/i.test(v)) return null;
  const repeat = v.match(/repeat\(\s*([^,]+),/i);
  if (repeat) {
    const arg = repeat[1].trim();
    if (/^auto-(fit|fill)$/i.test(arg)) return "auto";
    const n = Number(arg);
    if (Number.isFinite(n) && n >= 2) return Math.floor(n);
    if (Number.isFinite(n)) return null;
  }
  const tracks = splitTopLevel(v).filter((t) => !/^\[.*\]$/.test(t));
  return tracks.length >= 2 ? tracks.length : null;
}

function paddingSides(map: Map<string, string>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const shorthand = map.get("padding");
  if (shorthand) {
    const parts = splitTopLevel(shorthand).map(lengthToPx);
    const [a, b, c, d] = parts;
    if (parts.length === 1) {
      x = y = a ?? 0;
    } else if (parts.length === 2 || parts.length === 3) {
      y = Math.max(a ?? 0, c ?? a ?? 0);
      x = b ?? 0;
    } else if (parts.length >= 4) {
      y = Math.max(a ?? 0, c ?? 0);
      x = Math.max(b ?? 0, d ?? 0);
    }
  }
  x = Math.max(
    x,
    lengthToPx(map.get("padding-left")) ?? 0,
    lengthToPx(map.get("padding-right")) ?? 0,
    lengthToPx(map.get("padding-inline")) ?? 0
  );
  y = Math.max(
    y,
    lengthToPx(map.get("padding-top")) ?? 0,
    lengthToPx(map.get("padding-bottom")) ?? 0,
    lengthToPx(map.get("padding-block")) ?? 0
  );
  return { x, y };
}

function addClasses(openTag: string, classes: string[]): string {
  const classMatch = openTag.match(/\bclass=(["'])([\s\S]*?)\1/i);
  const existing = classMatch ? classMatch[2].split(/\s+/).filter(Boolean) : [];
  const merged = [...existing];
  for (const c of classes) if (!merged.includes(c)) merged.push(c);
  if (merged.length === existing.length) return openTag;
  if (classMatch) {
    const quote = classMatch[1];
    return openTag.replace(classMatch[0], `class=${quote}${merged.join(" ")}${quote}`);
  }
  return openTag.replace(/^<\w+\b/, (head) => `${head} class="${merged.join(" ")}"`);
}

function replaceStyle(openTag: string, map: Map<string, string>): string {
  const styleMatch = openTag.match(/\bstyle=(["'])([\s\S]*?)\1/i);
  if (!styleMatch) return openTag;
  const quote = styleMatch[1];
  return openTag.replace(styleMatch[0], `style=${quote}${serializeStyle(map)}${quote}`);
}

/**
 * Tag inline-styled layout containers so Additional CSS can stack them on phones/tablets.
 * Grok (especially screenshot-led mode) emits inline display:grid / flex columns, large
 * font sizes and desktop paddings — inline styles win over theme CSS, so we add hook classes
 * and override them with !important media queries from `responsiveContentCssBlock()`.
 */
export function normalizeResponsiveLayout(html: string): string {
  if (!html.trim()) return html;

  return html.replace(LAYOUT_TAGS, (full, tag: string, rest: string) => {
    const styleMatch = rest.match(/\bstyle=(["'])([\s\S]*?)\1/i);
    if (!styleMatch) return full;
    const map = parseStyle(styleMatch[2]);
    if (map.size === 0) return full;

    const classes: string[] = [];
    let styleChanged = false;
    const tagName = tag.toLowerCase();
    const display = (map.get("display") ?? "").toLowerCase();

    if (/grid/.test(display)) {
      const cols = gridColumnCount(map.get("grid-template-columns") ?? "");
      if (cols) {
        classes.push(GRID_CLASS, `${GRID_CLASS}-${cols === "auto" ? "auto" : Math.min(cols, 4)}`);
      }
    }

    if (/flex/.test(display)) {
      const direction = (map.get("flex-direction") ?? "row").toLowerCase();
      if (!/column/.test(direction)) {
        classes.push(FLEX_CLASS);
        if (!map.has("flex-wrap")) {
          map.set("flex-wrap", "wrap");
          styleChanged = true;
        }
      }
    }

    const flex = map.get("flex") ?? "";
    const basis = map.get("flex-basis") ?? "";
    const width = map.get("width") ?? "";
    const widthPct = width.match(/^(\d*\.?\d+)%$/);
    const basisPct = basis.match(/^(\d*\.?\d+)%$/) ?? flex.match(/(\d*\.?\d+)%/);
    if (
      (widthPct && Number(widthPct[1]) < 100) ||
      (basisPct && Number(basisPct[1]) < 100) ||
      /^\s*[1-9]/.test(flex)
    ) {
      classes.push(COL_CLASS);
    }

    const fontPx = lengthToPx(map.get("font-size"));
    if (fontPx !== null) {
      if (fontPx >= 36) classes.push(FS_XL_CLASS);
      else if (fontPx >= 26) classes.push(FS_LG_CLASS);
    }

    if (!/^(a|span|li|p|h[1-6])$/.test(tagName)) {
      const { x, y } = paddingSides(map);
      if (x >= 32) classes.push(PAD_X_CLASS);
      if (y >= 72) classes.push(PAD_Y_CLASS);

      const h = lengthToPx(map.get("height"));
      const minH = lengthToPx(map.get("min-height"));
      if ((h !== null && h >= 300) || (minH !== null && minH >= 420)) {
        classes.push(FIXED_H_CLASS);
      }
    }

    if (classes.length === 0 && !styleChanged) return full;

    let open = `<${tag}${rest}>`;
    if (styleChanged) open = replaceStyle(open, map);
    if (classes.length) open = addClasses(open, classes);
    return open;
  });
}

export function responsiveContentCssBlock(): string {
  return `${RESPONSIVE_CSS_MARKER}
.${GRID_CLASS},
.${FLEX_CLASS} {
  box-sizing: border-box;
  max-width: 100%;
}
.${GRID_CLASS} > *,
.${FLEX_CLASS} > *,
.${COL_CLASS} {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
.${FLEX_CLASS} {
  flex-wrap: wrap !important;
}
.entry-content img,
.elementor-widget-container img,
.${GRID_CLASS} img,
.${FLEX_CLASS} img {
  max-width: 100%;
  height: auto;
}
@media (max-width: 1024px) {
  .${GRID_CLASS}-3,
  .${GRID_CLASS}-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
}
@media (max-width: 782px) {
  .${GRID_CLASS} {
    grid-template-columns: minmax(0, 1fr) !important;
    grid-auto-flow: row !important;
  }
  .${GRID_CLASS} > * {
    grid-column: auto !important;
    grid-row: auto !important;
  }
  .${COL_CLASS} {
    flex: 1 1 100% !important;
    width: 100% !important;
    max-width: 100% !important;
  }
  .${FS_XL_CLASS} {
    font-size: clamp(1.85rem, 8vw, 2.6rem) !important;
    line-height: 1.15 !important;
  }
  .${FS_LG_CLASS} {
    font-size: clamp(1.4rem, 6vw, 1.9rem) !important;
    line-height: 1.2 !important;
  }
  .${PAD_X_CLASS} {
    padding-left: 20px !important;
    padding-right: 20px !important;
  }
  .${PAD_Y_CLASS} {
    padding-top: 48px !important;
    padding-bottom: 48px !important;
  }
  .${FIXED_H_CLASS} {
    height: auto !important;
    min-height: 0 !important;
  }
  .entry-content table,
  .elementor-widget-container table {
    display: block;
    width: 100%;
    overflow-x: auto;
  }
}`;
}

export async function applyResponsiveContentCss(
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<void> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const block = responsiveContentCssBlock();

  try {
    const settings = await wpRequest<{ custom_css?: string }>(
      config,
      "/wp-json/wp/v2/settings"
    );
    let css = settings.custom_css ?? "";
    if (css.includes(RESPONSIVE_CSS_MARKER)) {
      css = css.replace(
        /\/\* wp-bot-responsive \*\/[\s\S]*?(?=\/\* wp-bot-|\s*$)/,
        block
      );
    } else {
      css = css.trim() ? `${css.trim()}\n\n${block}` : block;
    }
    await wpRequest(config, "/wp-json/wp/v2/settings", {
      method: "POST",
      body: JSON.stringify({ custom_css: css }),
    });
    log.info("Applied mobile-responsive layout CSS (Additional CSS).", {
      phase: "phase1",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "custom_css failed";
    log.warn(`Could not apply responsive layout CSS: ${message}`, { phase: "phase1" });
  }
}
