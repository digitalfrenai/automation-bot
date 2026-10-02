import type { LoadedSiteConfig } from "@/lib/config-loader";
import { readStoredLogoFile } from "@/lib/logo-upload-storage";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { loadSharp } from "@/lib/load-sharp";
import { wpRequest } from "@/lib/wordpress-client";

export type LogoPalette = {
  primary: string;
  secondary: string;
  accent: string;
  onPrimary: string;
  muted: string;
  hexes: string[];
};

const cache = new Map<string, LogoPalette | null>();

export const LOGO_PALETTE_CSS_MARKER = "/* wp-bot-logo-palette */";

function cacheKey(config: LoadedSiteConfig): string {
  return `${config.id}|${config.businessLogoFilePath ?? ""}|${config.businessLogoUrl ?? ""}`;
}

function toHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
      .join("")
  );
}

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

function isNearWhiteOrBlack(r: number, g: number, b: number): boolean {
  const lum = luminance(r, g, b);
  return lum > 0.92 || lum < 0.06;
}

type Bucket = { r: number; g: number; b: number; n: number; sat: number };

async function sampleLogoPixels(
  buffer: Buffer
): Promise<Array<{ r: number; g: number; b: number; a: number }>> {
  const sharp = await loadSharp();
  const { data, info } = await sharp(buffer, { density: 144 })
    .resize(80, 80, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels: Array<{ r: number; g: number; b: number; a: number }> = [];
  const channels = info.channels;
  for (let i = 0; i < data.length; i += channels) {
    pixels.push({
      r: data[i] ?? 0,
      g: data[i + 1] ?? 0,
      b: data[i + 2] ?? 0,
      a: channels >= 4 ? data[i + 3] ?? 255 : 255,
    });
  }
  return pixels;
}

function quantize(pixels: Array<{ r: number; g: number; b: number; a: number }>): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const p of pixels) {
    if (p.a < 40) continue;
    if (isNearWhiteOrBlack(p.r, p.g, p.b)) continue;
    const r = Math.round(p.r / 24) * 24;
    const g = Math.round(p.g / 24) * 24;
    const b = Math.round(p.b / 24) * 24;
    const key = `${r},${g},${b}`;
    const existing = map.get(key);
    if (existing) {
      existing.n += 1;
    } else {
      map.set(key, {
        r,
        g,
        b,
        n: 1,
        sat: saturation(r, g, b),
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    const score = (x: Bucket) => x.n * (0.55 + x.sat);
    return score(b) - score(a);
  });
}

function bucketsToPalette(buckets: Bucket[]): LogoPalette | null {
  if (buckets.length === 0) return null;
  const colorful = buckets.filter((b) => b.sat > 0.12);
  const ranked = colorful.length >= 2 ? colorful : buckets;
  const primary = ranked[0];
  const secondary = ranked[1] ?? ranked[0];
  const accent = ranked[2] ?? secondary;
  const hexes = ranked.slice(0, 5).map((c) => toHex(c.r, c.g, c.b));
  const onPrimary =
    luminance(primary.r, primary.g, primary.b) > 0.55 ? "#111827" : "#ffffff";
  const muted =
    luminance(primary.r, primary.g, primary.b) > 0.45
      ? toHex(
          Math.min(255, primary.r + 40),
          Math.min(255, primary.g + 40),
          Math.min(255, primary.b + 40)
        )
      : toHex(
          Math.max(0, primary.r - 30),
          Math.max(0, primary.g - 30),
          Math.max(0, primary.b - 30)
        );

  return {
    primary: toHex(primary.r, primary.g, primary.b),
    secondary: toHex(secondary.r, secondary.g, secondary.b),
    accent: toHex(accent.r, accent.g, accent.b),
    onPrimary,
    muted,
    hexes,
  };
}

async function readLogoBuffer(
  config: LoadedSiteConfig
): Promise<Buffer | null> {
  if (config.businessLogoFilePath?.trim()) {
    try {
      const file = await readStoredLogoFile(config.businessLogoFilePath.trim());
      return file.buffer;
    } catch {
      /* try URL */
    }
  }
  const url = config.businessLogoUrl?.trim();
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function extractLogoPalette(
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<LogoPalette | null> {
  if (!config.businessLogoFilePath?.trim() && !config.businessLogoUrl?.trim()) {
    return null;
  }

  const key = cacheKey(config);
  if (cache.has(key)) return cache.get(key) ?? null;

  const log = createPipelineLogger(onLog ?? (() => undefined));
  try {
    const buffer = await readLogoBuffer(config);
    if (!buffer) {
      cache.set(key, null);
      return null;
    }
    const pixels = await sampleLogoPixels(buffer);
    const palette = bucketsToPalette(quantize(pixels));
    cache.set(key, palette);
    if (palette) {
      log.info(
        `Brand colors from logo: ${palette.primary} / ${palette.secondary} / ${palette.accent}.`,
        { phase: "phase2" }
      );
    }
    return palette;
  } catch (err) {
    const message = err instanceof Error ? err.message : "logo palette failed";
    log.warn(`Could not read colors from logo: ${message}`, { phase: "phase2" });
    cache.set(key, null);
    return null;
  }
}

export function formatLogoPalettePrompt(palette: LogoPalette | null): string {
  if (!palette) return "";
  return `BRAND COLORS FROM THE BUSINESS LOGO (required — use these hex values in page content):
- Primary: ${palette.primary} (buttons, headings, filled section bands, card accents)
- Secondary: ${palette.secondary} (secondary buttons, links, borders)
- Accent: ${palette.accent} (highlights, badges, hover)
- Text on primary backgrounds: ${palette.onPrimary}
- Soft/muted companion: ${palette.muted}
- Extra swatches: ${palette.hexes.join(", ")}
Use these colors for inline styles, Gutenberg has-*-background-color only if they match; otherwise use inline background-color / color with the hex values above.
If reference screenshots are attached: keep their layout, but restyle colors to this logo palette (do not copy the screenshot site's brand colors).`;
}

export function logoPaletteCssBlock(palette: LogoPalette): string {
  return `${LOGO_PALETTE_CSS_MARKER}
:root {
  --wp-bot-primary: ${palette.primary};
  --wp-bot-secondary: ${palette.secondary};
  --wp-bot-accent: ${palette.accent};
  --wp-bot-on-primary: ${palette.onPrimary};
  --wp-bot-muted: ${palette.muted};
}
.entry-content a.wp-bot-cta,
.entry-content button.wp-bot-cta,
.entry-content .wp-block-button__link,
.entry-content .wp-element-button {
  background-color: var(--wp-bot-primary) !important;
  color: var(--wp-bot-on-primary) !important;
  border-color: var(--wp-bot-primary) !important;
}
.entry-content a.wp-bot-social,
.entry-content button.wp-bot-social {
  background-color: var(--wp-bot-primary) !important;
  color: var(--wp-bot-on-primary) !important;
}
.entry-content h1, .entry-content h2, .entry-content .wp-block-heading {
  color: var(--wp-bot-primary);
}`;
}

export async function applyLogoPaletteCss(
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<void> {
  const palette = await extractLogoPalette(config, onLog);
  if (!palette) return;
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const block = logoPaletteCssBlock(palette);
  try {
    const settings = await wpRequest<{ custom_css?: string }>(
      config,
      "/wp-json/wp/v2/settings"
    );
    let css = settings.custom_css ?? "";
    if (css.includes(LOGO_PALETTE_CSS_MARKER)) {
      css = css.replace(
        /\/\* wp-bot-logo-palette \*\/[\s\S]*?(?=\/\* wp-bot-|\s*$)/,
        block
      );
    } else {
      css = css.trim() ? `${css.trim()}\n\n${block}` : block;
    }
    await wpRequest(config, "/wp-json/wp/v2/settings", {
      method: "POST",
      body: JSON.stringify({ custom_css: css }),
    });
    log.info("Applied logo brand colors to Additional CSS.", { phase: "phase1" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "custom_css failed";
    log.warn(`Could not apply logo palette CSS: ${message}`, { phase: "phase1" });
  }
}
