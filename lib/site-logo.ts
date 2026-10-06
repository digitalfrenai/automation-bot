import type { LoadedSiteConfig } from "@/lib/config-loader";
import { prisma } from "@/lib/prisma";
import {
  HEADER_LOGO_CSS_MARKER,
  headerLogoCssBlock,
  normalizeLogoForSiteHeader,
} from "@/lib/logo-normalize";
import { readStoredLogoFile } from "@/lib/logo-upload-storage";
import type { PreparedContent } from "@/lib/content-pipeline";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { uploadWordPressMedia } from "@/lib/wordpress-media";
import { formatWordPressApiError } from "@/lib/wordpress-nav-rest";
import { wpRequest } from "@/lib/wordpress-client";

export type ResolvedSiteLogo = {
  mediaId: number;
  sourceUrl: string;
  alt: string;
};

const syncCache = new Map<string, ResolvedSiteLogo>();

function logoCacheKey(config: LoadedSiteConfig): string {
  return `${config.id}|${config.businessLogoFilePath ?? ""}|${config.businessLogoUrl ?? ""}`;
}

export function siteLogoConfigured(config: LoadedSiteConfig): boolean {
  return Boolean(
    config.businessLogoUrl?.trim() || config.businessLogoFilePath?.trim()
  );
}

export function clearSiteLogoSyncCache(configId?: string): void {
  if (configId) {
    for (const key of syncCache.keys()) {
      if (key.startsWith(`${configId}|`)) syncCache.delete(key);
    }
    return;
  }
  syncCache.clear();
}

async function prepareLogoBytes(
  buffer: Buffer,
  mimeType: string,
  onLog?: LogSink
): Promise<{ buffer: Buffer; mimeType: string }> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const normalized = await normalizeLogoForSiteHeader(buffer, mimeType);
  if (normalized.buffer.length !== buffer.length || normalized.mimeType !== mimeType) {
    log.info(
      `Logo resized for header (max ${process.env.LOGO_MAX_WIDTH ?? "280"}×${process.env.LOGO_MAX_HEIGHT ?? "72"}px).`,
      { phase: "phase1" }
    );
  }
  return normalized;
}

async function uploadLogoToWordPress(
  config: LoadedSiteConfig,
  alt: string,
  onLog?: LogSink
): Promise<ResolvedSiteLogo> {
  const slugBase =
    config.businessName.trim().replace(/\s+/g, "-").toLowerCase() || "logo";

  if (config.businessLogoFilePath?.trim()) {
    const file = await readStoredLogoFile(config.businessLogoFilePath.trim());
    const prepared = await prepareLogoBytes(file.buffer, file.mimeType, onLog);
    const media = await uploadWordPressMedia(config, prepared.buffer, {
      filenameBase: `${slugBase}-logo`,
      mimeType: prepared.mimeType,
      title: `${config.businessName} logo`,
      altText: alt,
    });
    return { mediaId: media.id, sourceUrl: media.source_url, alt };
  }

  const url = config.businessLogoUrl?.trim();
  if (!url) {
    throw new Error("No logo URL or file configured.");
  }

  const fetched = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!fetched.ok) {
    throw new Error(`Could not fetch logo URL (${fetched.status}).`);
  }
  const rawMime =
    fetched.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const rawBuffer = Buffer.from(await fetched.arrayBuffer());
  const prepared = await prepareLogoBytes(rawBuffer, rawMime, onLog);

  const media = await uploadWordPressMedia(config, prepared.buffer, {
    filenameBase: `${slugBase}-logo`,
    mimeType: prepared.mimeType,
    title: `${config.businessName} logo`,
    altText: alt,
  });
  return { mediaId: media.id, sourceUrl: media.source_url, alt };
}

async function applyHeaderLogoCss(
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<void> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const block = headerLogoCssBlock();

  try {
    const settings = await wpRequest<{ custom_css?: string }>(
      config,
      "/wp-json/wp/v2/settings"
    );
    let css = settings.custom_css ?? "";
    if (css.includes(HEADER_LOGO_CSS_MARKER)) {
      css = css.replace(
        /\/\* wp-bot-header-logo \*\/[\s\S]*?(?=\/\* wp-bot-|\s*$)/,
        block
      );
    } else {
      css = css.trim() ? `${css.trim()}\n\n${block}` : block;
    }
    await wpRequest(config, "/wp-json/wp/v2/settings", {
      method: "POST",
      body: JSON.stringify({ custom_css: css }),
    });
    log.info("Applied header logo size CSS (Customizer Additional CSS).", {
      phase: "phase1",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "custom_css failed";
    log.warn(
      `Could not apply header logo CSS (theme may still size logo via Customizer): ${message}`,
      { phase: "phase1" }
    );
  }
}

async function assignWordPressSiteLogo(
  config: LoadedSiteConfig,
  mediaId: number,
  onLog?: LogSink
): Promise<void> {
  const log = createPipelineLogger(onLog ?? (() => undefined));

  try {
    await wpRequest(config, "/wp-json/wp/v2/settings", {
      method: "POST",
      body: JSON.stringify({ site_logo: mediaId }),
    });
  } catch (err) {
    log.warn(
      `Could not set site_logo via REST: ${formatWordPressApiError(err)}`,
      { phase: "phase1" }
    );
    return;
  }

  try {
    const settings = await wpRequest<{ site_logo?: number }>(
      config,
      "/wp-json/wp/v2/settings"
    );
    if (settings.site_logo === mediaId) {
      log.info(
        `WordPress site logo set via REST (media #${mediaId}; drives Kadence/custom_logo through core site_logo sync).`,
        { phase: "phase1" }
      );
      return;
    }
    log.warn(
      `site_logo POST succeeded but GET returned ${settings.site_logo ?? "empty"} (expected ${mediaId}). Check user can manage_options.`,
      { phase: "phase1" }
    );
  } catch (err) {
    log.info(`WordPress site logo updated (media #${mediaId}).`, {
      phase: "phase1",
    });
    log.warn(
      `Could not verify site_logo after update: ${formatWordPressApiError(err)}`,
      { phase: "phase1" }
    );
  }
}

export async function ensureSiteLogoOnWordPress(
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<ResolvedSiteLogo | null> {
  if (!siteLogoConfigured(config)) {
    return null;
  }

  const cacheKey = logoCacheKey(config);
  if (process.env.LOGO_FORCE_RESYNC === "true") {
    clearSiteLogoSyncCache(config.id);
  }
  const cached = syncCache.get(cacheKey);
  if (cached) return cached;

  const log = createPipelineLogger(onLog ?? (() => undefined));
  const alt = `${config.businessName} logo`;

  log.info("Syncing business logo to WordPress (Customizer site logo / Kadence header)…", {
    phase: "phase1",
  });

  const resolved = await uploadLogoToWordPress(config, alt, onLog);
  await assignWordPressSiteLogo(config, resolved.mediaId, onLog);
  await applyHeaderLogoCss(config, onLog);

  log.info(
    `Logo media #${resolved.mediaId} uploaded. If the header still shows the theme demo (e.g. Braine), run Phase 1 again after saving logo in the dashboard, or set LOGO_FORCE_RESYNC=true once on Railway.`,
    { phase: "phase1" }
  );

  try {
    await prisma.siteConfig.update({
      where: { id: config.id },
      data: { wpLogoMediaId: resolved.mediaId } as Record<string, unknown>,
    });
  } catch {
    /* optional cache */
  }

  syncCache.set(cacheKey, resolved);
  return resolved;
}

const LOGO_IMG_HINT =
  /(?:\bclass=(["'])[^"']*\b(?:custom-logo|site-logo|logo-img|brand-logo|navbar-brand|wp-custom-logo|logo-image)[^"']*\1)|(?:\bclass=(["'])[^"']*\blogo\b[^"']*\2)|(?:\bid=(["'])logo\3)|(?:\balt=(["'])[^"']*logo[^"']*\4)/i;

const THEME_DEMO_LOGO_PATH = /\/wp-content\/themes\/[^"']*(?:logo|brand|mark)[^"']*\.(?:png|jpe?g|svg|webp)/i;

function replaceLogoImgTag(
  attrs: string,
  sourceUrl: string,
  alt: string
): string {
  const safeAlt = alt.replace(/"/g, "&quot;");
  let next = attrs;
  const srcMatch = next.match(/\bsrc=(["'])(.*?)\1/i);
  if (srcMatch) {
    next = next.replace(srcMatch[0], `src="${sourceUrl}"`);
  } else {
    next = `${next} src="${sourceUrl}"`;
  }
  if (/\balt=(["']).*?\1/i.test(next)) {
    next = next.replace(/\balt=(["']).*?\1/i, `alt="${safeAlt}"`);
  } else {
    next = `${next} alt="${safeAlt}"`;
  }
  return next;
}

export function applyBusinessLogoToHtml(
  html: string,
  logo: ResolvedSiteLogo
): string {
  if (!html.trim()) return html;

  return html.replace(/<img\b([^>]*?)>/gi, (full, attrs: string) => {
    const srcMatch = attrs.match(/\bsrc=(["'])(.*?)\1/i);
    const src = srcMatch?.[2] ?? "";
    const isLogoSlot =
      LOGO_IMG_HINT.test(attrs) ||
      THEME_DEMO_LOGO_PATH.test(src) ||
      (/\blogo\b/i.test(src) && /\/wp-content\/themes\//i.test(src));
    if (!isLogoSlot) return full;
    const maxH = process.env.LOGO_MAX_HEIGHT ?? "72";
    const withSize = replaceLogoImgTag(attrs, logo.sourceUrl, logo.alt);
    if (/\bstyle=(["'])/i.test(withSize)) {
      return `<img${withSize}>`;
    }
    return `<img${withSize} style="max-height:${maxH}px;width:auto;height:auto;object-fit:contain">`;
  });
}

export function applyBusinessLogoToPreparedContent(
  prepared: PreparedContent,
  logo: ResolvedSiteLogo
): PreparedContent {
  const html = applyBusinessLogoToHtml(prepared.storage.html, logo);
  if (html === prepared.storage.html) {
    return prepared;
  }

  return {
    format: prepared.format,
    storage: { ...prepared.storage, html },
    auditHtml: applyBusinessLogoToHtml(prepared.auditHtml, logo),
  };
}

export function logoPromptLine(logo: ResolvedSiteLogo | null): string {
  if (!logo) return "";
  return `Business logo (use this exact URL for any logo/branding image in page sections — not in theme header): ${logo.sourceUrl}`;
}
