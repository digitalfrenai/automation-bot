import type OpenAI from "openai";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import { extractLogoPalette } from "@/lib/logo-palette";
import { hasDesignReferenceScreenshots } from "@/lib/design-reference-vision";
import type { PreparedContent } from "@/lib/content-pipeline";
import { injectImagesIntoElementorPrepared } from "@/lib/elementor-builder";
import { diviToAuditHtml, injectImagesIntoDiviHtml } from "@/lib/divi-builder";
import {
  gutenbergToAuditHtml,
  hasGutenbergBlocks,
  preferBlockEditorPageImages,
  wpImageBlockFromMedia,
  wpImageHtmlFromMedia,
} from "@/lib/gutenberg-content";
import {
  generateGrokImage,
  imagePromptVisualSubject,
  pageImagesEnabled,
  pageImagesMaxPerPage,
  pageImagesUseAi,
} from "@/lib/grok-images";
import { createGrokClient } from "@/lib/grok-client";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import {
  buildThemeImageCatalog,
  pickThemeImagesForSlots,
  readThemeImageBytesFromZip,
  type ThemeImageAsset,
} from "@/lib/theme-image-catalog";
import { detectThemeSlugFromZip, resolveLocalThemePath } from "@/lib/themeDeployer";
import { loadThemeStyleProfile } from "@/lib/theme-style-profile";
import {
  setPageFeaturedMedia,
  uploadWordPressMedia,
  uploadWordPressMediaFromUrl,
  type WpMediaItem,
} from "@/lib/wordpress-media";
import { isHomePage } from "@/lib/wordpress-page-roles";

export type PageImageSlot = {
  id: string;
  aspectRatio: string;
  alt: string;
  prompt: string;
  role: "hero" | "section";
};

export type UploadedPageImage = PageImageSlot & {
  media: WpMediaItem;
};

type Brief = {
  businessName: string;
  niche: string;
  targetAudience: string;
  toneOfVoice: string;
  coreServices: string[];
};

function basePhotoRules(
  brief: Brief,
  matchDesignReference?: boolean,
  brandColors?: string
): string {
  const styleNote = matchDesignReference
    ? " Match photography style of the client's reference website screenshots, but color-grade toward the brand palette."
    : " Match the look of a modern WordPress business theme demo (consistent color grading and composition).";
  const brand = brandColors
    ? ` Brand color palette to echo in lighting and wardrobe if natural: ${brandColors}.`
    : "";
  return `Professional marketing photograph for ${brief.businessName} (${brief.niche}). Audience: ${brief.targetAudience}. Tone: ${brief.toneOfVoice}. Services: ${brief.coreServices.join(", ") || "general business"}.${styleNote}${brand} Photorealistic, well-lit. Do not include any visible text, signage, screens with readable UI, or logos in the scene.`;
}

export function countVisibleImages(html: string): number {
  return (html.match(/<img\b/gi) ?? []).length;
}

function aspectRatioFromPlaceholdSrc(src: string, index: number): string {
  const m = src.match(/placehold\.co\/(\d+)x(\d+)/i);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w > 0 && h > 0) {
      const ratio = w / h;
      if (ratio >= 1.65) return "16:9";
      if (ratio <= 0.85) return "3:4";
      if (ratio >= 1.2) return "4:3";
      return "1:1";
    }
  }
  return index === 0 ? "16:9" : "4:3";
}

function altFromImgAttrs(attrs: string, fallback: string): string {
  const m = attrs.match(/\balt=(["'])(.*?)\1/i);
  const alt = m?.[2]?.trim();
  return alt && alt.length > 2 ? alt : fallback;
}

/** Images Grok marked with placeholders or theme demo URLs — each needs a real upload. */
export function countSwappableImagesInHtml(html: string): number {
  let count = 0;
  const re = /<img\b([^>]*?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1] ?? "";
    const srcMatch = attrs.match(/\bsrc=(["'])(.*?)\1/i);
    const src = srcMatch?.[2] ?? "";
    if (shouldSwapImgSrc(attrs, src)) count++;
  }
  return count;
}

export function htmlHasUnfilledImagePlaceholders(html: string): boolean {
  return countSwappableImagesInHtml(html) > 0;
}

function planPageImageSlotsFromHtml(
  html: string,
  pageTitle: string,
  brief: Brief,
  matchDesignReference?: boolean,
  brandColors?: string
): PageImageSlot[] {
  const max = pageImagesMaxPerPage();
  const slots: PageImageSlot[] = [];
  const re = /<img\b([^>]*?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (slots.length >= max) break;
    const attrs = m[1] ?? "";
    const srcMatch = attrs.match(/\bsrc=(["'])(.*?)\1/i);
    const src = srcMatch?.[2] ?? "";
    if (!shouldSwapImgSrc(attrs, src)) continue;
    const index = slots.length;
    const alt = altFromImgAttrs(
      attrs,
      index === 0
        ? `${brief.businessName} — ${pageTitle}`
        : `${pageTitle} section image ${index + 1}`
    );
    slots.push({
      id: `content-img-${index + 1}`,
      role: index === 0 ? "hero" : "section",
      aspectRatio: aspectRatioFromPlaceholdSrc(src, index),
      alt,
      prompt: `${basePhotoRules(brief, matchDesignReference, brandColors)} Scene related to ${imagePromptVisualSubject(pageTitle)} — layout image ${index + 1}. Match reference composition for this slot if provided.`,
    });
  }
  return slots;
}

/** Prefer HTML-derived slots (every placeholder/demo img); fall back to fixed theme-demo plan. */
export function resolvePageImageSlots(
  html: string,
  pageTitle: string,
  brief: Brief,
  matchDesignReference?: boolean,
  brandColors?: string
): PageImageSlot[] {
  const fromHtml = planPageImageSlotsFromHtml(
    html,
    pageTitle,
    brief,
    matchDesignReference,
    brandColors
  );
  if (fromHtml.length > 0) return fromHtml;
  return planPageImageSlots(pageTitle, brief, matchDesignReference, brandColors);
}

export function planPageImageSlots(
  pageTitle: string,
  brief: Brief,
  matchDesignReference?: boolean,
  brandColors?: string
): PageImageSlot[] {
  const home = isHomePage(pageTitle);
  const title = pageTitle.trim().toLowerCase();

  if (home) {
    return [
      {
        id: "hero-banner",
        role: "hero",
        aspectRatio: "16:9",
        alt: `${brief.businessName} — home page banner`,
        prompt: `${basePhotoRules(brief, matchDesignReference, brandColors)} Wide hero banner in the same visual style as the active WordPress theme demo.`,
      },
      {
        id: "services-visual",
        role: "section",
        aspectRatio: "4:3",
        alt: `${brief.businessName} services`,
        prompt: `${basePhotoRules(brief, matchDesignReference, brandColors)} Section image matching theme demo service/feature photography.`,
      },
      {
        id: "trust-visual",
        role: "section",
        aspectRatio: "4:3",
        alt: `Trusted ${brief.niche} team at work`,
        prompt: `${basePhotoRules(brief, matchDesignReference, brandColors)} Trust section image consistent with theme demo imagery.`,
      },
    ];
  }

  if (title.includes("about")) {
    return [
      {
        id: "about-hero",
        role: "hero",
        aspectRatio: "16:9",
        alt: `About ${brief.businessName}`,
        prompt: `${basePhotoRules(brief, matchDesignReference, brandColors)} About page hero matching theme demo style.`,
      },
    ];
  }

  if (title.includes("service")) {
    return [
      {
        id: "services-hero",
        role: "hero",
        aspectRatio: "16:9",
        alt: `${brief.businessName} services overview`,
        prompt: `${basePhotoRules(brief, matchDesignReference, brandColors)} Services hero image matching theme demo style.`,
      },
      {
        id: "services-detail",
        role: "section",
        aspectRatio: "4:3",
        alt: `${brief.businessName} service detail`,
        prompt: `${basePhotoRules(brief, matchDesignReference, brandColors)} Services detail image matching theme demo style.`,
      },
    ];
  }

  if (title.includes("contact") || title.includes("faq")) {
    return [];
  }

  return [
    {
      id: "page-hero",
      role: "hero",
      aspectRatio: "16:9",
      alt: `${pageTitle} — ${brief.businessName}`,
      prompt: `${basePhotoRules(brief, matchDesignReference, brandColors)} Page hero image matching theme demo style; subject: ${imagePromptVisualSubject(pageTitle)}.`,
    },
  ];
}

const PLACEHOLDER_SRC =
  /placehold\.co|via\.placeholder|picsum\.photos|dummyimage\.com|placeholder\.com/i;

function isPlaceholderImgSrc(src: string): boolean {
  const s = src.trim();
  if (!s) return true;
  return PLACEHOLDER_SRC.test(s);
}

function isThemeBundledImgSrc(src: string): boolean {
  return /\/wp-content\/themes\//i.test(src);
}

function imageBlockForUpload(upload: UploadedPageImage): string {
  return wpImageBlockFromMedia(upload.media, upload.alt);
}

function htmlSectionFigure(url: string, alt: string, mediaId?: number): string {
  const safeAlt = alt.replace(/"/g, "&quot;");
  const imgClass = mediaId ? ` class="wp-image-${mediaId}"` : "";
  const dataId = mediaId ? ` data-id="${mediaId}"` : "";
  return `<figure class="page-section-image"><img src="${url}" alt="${safeAlt}"${imgClass}${dataId} loading="lazy" decoding="async"/></figure>`;
}

const LOGO_IMG_ATTR =
  /\b(?:custom-logo|site-logo|logo-img|brand-logo|navbar-brand|wp-custom-logo)\b/i;

function shouldSwapImgSrc(attrs: string, src: string): boolean {
  if (LOGO_IMG_ATTR.test(attrs)) return false;
  if (isPlaceholderImgSrc(src)) return true;
  if (isThemeBundledImgSrc(src) && !/\blogo\b/i.test(src)) return true;
  return false;
}

function stampImgAttrsWithMedia(
  attrs: string,
  media: { id: number; source_url: string },
  alt: string
): string {
  let next = attrs;
  const srcMatch = next.match(/\bsrc=(["'])(.*?)\1/i);
  if (srcMatch) {
    next = next.replace(srcMatch[0], `src="${media.source_url.replace(/"/g, "&quot;")}"`);
  } else {
    next = `${next} src="${media.source_url.replace(/"/g, "&quot;")}"`;
  }
  const safeAlt = alt.replace(/"/g, "&quot;");
  if (/\balt=(["']).*?\1/i.test(next)) {
    next = next.replace(/\balt=(["']).*?\1/i, `alt="${safeAlt}"`);
  } else {
    next = `${next} alt="${safeAlt}"`;
  }
  if (/\bdata-id=(["']?)\d+\1/i.test(next)) {
    next = next.replace(/\bdata-id=(["']?)\d+\1/i, `data-id="${media.id}"`);
  } else {
    next = `${next} data-id="${media.id}"`;
  }
  if (/\bclass=(["'])([\s\S]*?)\1/i.test(next)) {
    next = next.replace(/\bclass=(["'])([\s\S]*?)\1/i, (_m, q: string, cls: string) => {
      const cleaned = cls
        .split(/\s+/)
        .filter((c) => c && !/^wp-image-\d+$/i.test(c))
        .join(" ");
      return `class=${q}${`${cleaned} wp-image-${media.id}`.trim()}${q}`;
    });
  } else {
    next = `${next} class="wp-image-${media.id}"`;
  }
  return next;
}

function markupNeedsMediaSwap(markup: string): boolean {
  const srcMatch = markup.match(/\bsrc=(["'])(.*?)\1/i);
  const src = srcMatch?.[2] ?? "";
  const bgMatch = markup.match(/background-image\s*:\s*url\((['"]?)([^)'"]+)\1\)/i);
  const bg = bgMatch?.[2] ?? "";
  return (
    shouldSwapImgSrc("", src) ||
    (bg.length > 0 && (isPlaceholderImgSrc(bg) || isThemeBundledImgSrc(bg)))
  );
}

function bindMarkupImagesToMedia(
  html: string,
  images: UploadedPageImage[]
): { html: string; remaining: UploadedPageImage[] } {
  if (images.length === 0) return { html, remaining: images };
  const pool = [...images];

  let out = html.replace(
    /<!--\s*wp:image\b[\s\S]*?<!--\s*\/wp:image\s*-->/gi,
    (block) => {
      if (pool.length === 0) return block;
      if (!markupNeedsMediaSwap(block)) return block;
      const img = pool.shift();
      if (!img) return block;
      return wpImageBlockFromMedia(img.media, img.alt);
    }
  );

  out = out.replace(/<img\b([^>]*?)>/gi, (full, attrs: string) => {
    if (pool.length === 0) return full;
    const srcMatch = attrs.match(/\bsrc=(["'])(.*?)\1/i);
    const currentSrc = srcMatch?.[2] ?? "";
    if (!shouldSwapImgSrc(attrs, currentSrc) && /wp-image-\d+/i.test(attrs)) {
      return full;
    }
    if (!shouldSwapImgSrc(attrs, currentSrc)) return full;
    const img = pool.shift();
    if (!img) return full;
    return `<img${stampImgAttrsWithMedia(attrs, img.media, img.alt)}>`;
  });

  out = out.replace(
    /background-image\s*:\s*url\((['"]?)([^)'"]+)\1\)/gi,
    (full, _q: string, url: string) => {
      if (pool.length === 0) return full;
      if (!isPlaceholderImgSrc(url) && !isThemeBundledImgSrc(url)) return full;
      const img = pool.shift();
      if (!img) return full;
      return `background-image:url("${img.media.source_url.replace(/"/g, "&quot;")}")`;
    }
  );

  return { html: out, remaining: pool };
}

function contentInsertIndex(html: string): number {
  const openers = [
    /<div[^>]*class="[^"]*\bentry-content\b[^"]*"[^>]*>/i,
    /<div[^>]*class="[^"]*\bcontent-wrap\b[^"]*"[^>]*>/i,
    /<main\b[^>]*>/i,
    /<article\b[^>]*>/i,
    /<section\b[^>]*>/i,
  ];
  for (const re of openers) {
    const m = html.match(re);
    if (m?.index != null) {
      return m.index + m[0].length;
    }
  }
  return 0;
}

function injectHeroHtml(html: string, hero: UploadedPageImage): string {
  if (html.includes(hero.media.source_url) || html.includes(`wp-image-${hero.media.id}`)) {
    return html;
  }
  const figure = `<figure class="page-hero-banner">${wpImageHtmlFromMedia(hero.media, hero.alt)}</figure>`;
  const at = contentInsertIndex(html);
  return html.slice(0, at) + figure + html.slice(at);
}

function injectSectionImagesHtml(
  html: string,
  sections: UploadedPageImage[]
): string {
  if (sections.length === 0) return html;
  let out = html;
  const h2Positions: number[] = [];
  const h2Re = /<h2\b/gi;
  let m: RegExpExecArray | null;
  while ((m = h2Re.exec(out))) {
    h2Positions.push(m.index);
  }

  if (h2Positions.length === 0) {
    const block = sections
      .map((s) => htmlSectionFigure(s.media.source_url, s.alt))
      .join("\n");
    return `${out}\n${block}`;
  }

  let offset = 0;
  sections.forEach((sec, idx) => {
    if (out.includes(sec.media.source_url)) return;
    const posIndex = Math.min(idx + 1, h2Positions.length - 1);
    const insertAt = h2Positions[posIndex] + offset;
    const fig = htmlSectionFigure(sec.media.source_url, sec.alt, sec.media.id);
    out = out.slice(0, insertAt) + fig + out.slice(insertAt);
    offset += fig.length;
  });
  return out;
}

function injectHeroAsBlock(content: string, hero: UploadedPageImage): string {
  if (content.includes(hero.media.source_url)) return content;
  const imageBlock = imageBlockForUpload(hero);
  return `${imageBlock}\n\n${content}`;
}

function applyImagesToHtmlStorage(
  html: string,
  images: UploadedPageImage[]
): string {
  if (images.length === 0) return html;
  const bound = bindMarkupImagesToMedia(html, images);
  const remaining = bound.remaining;
  const hero = remaining.find((i) => i.role === "hero");
  const sections = remaining.filter((i) => i.role === "section");
  let out = bound.html;
  if (hero) out = injectHeroHtml(out, hero);
  out = injectSectionImagesHtml(out, sections);
  return out;
}

function injectSectionImagesAsBlocks(
  content: string,
  sections: UploadedPageImage[]
): string {
  if (sections.length === 0) return content;
  let out = content;
  const h2Re = /<!-- wp:heading \{"level":2[^}]*\} -->|<h2\b/gi;
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = h2Re.exec(out))) positions.push(m.index);

  const mk = (s: UploadedPageImage) => `\n\n${imageBlockForUpload(s)}\n\n`;

  if (positions.length === 0) {
    return out + sections.map(mk).join("");
  }

  let offset = 0;
  sections.forEach((sec, idx) => {
    if (out.includes(sec.media.source_url)) return;
    const posIndex = Math.min(idx + 1, positions.length - 1);
    const insertAt = positions[posIndex] + offset;
    const block = mk(sec);
    out = out.slice(0, insertAt) + block + out.slice(insertAt);
    offset += block.length;
  });
  return out;
}

function applyImagesAsBlockStorage(
  html: string,
  images: UploadedPageImage[]
): string {
  if (images.length === 0) return html;
  const bound = bindMarkupImagesToMedia(html, images);
  const remaining = bound.remaining;
  const hero = remaining.find((i) => i.role === "hero");
  const sections = remaining.filter((i) => i.role === "section");
  let out = bound.html;
  if (hero) out = injectHeroAsBlock(out, hero);
  out = injectSectionImagesAsBlocks(out, sections);
  return out;
}

function applyUploadedImages(
  prepared: PreparedContent,
  images: UploadedPageImage[]
): PreparedContent {
  if (images.length === 0) return prepared;

  const useBlocks =
    preferBlockEditorPageImages() ||
    prepared.format === "gutenberg" ||
    hasGutenbergBlocks(prepared.storage.html);

  if (useBlocks && prepared.format !== "elementor" && prepared.format !== "divi") {
    const html = applyImagesAsBlockStorage(prepared.storage.html, images);
    return {
      format: "gutenberg",
      storage: { format: "gutenberg", html },
      auditHtml: gutenbergToAuditHtml(html),
    };
  }

  if (prepared.format === "html") {
    const html = applyImagesToHtmlStorage(prepared.storage.html, images);
    return {
      format: "html",
      storage: { format: "html", html },
      auditHtml: html,
    };
  }

  if (prepared.format === "gutenberg") {
    const html = applyImagesAsBlockStorage(prepared.storage.html, images);
    return {
      format: "gutenberg",
      storage: { format: "gutenberg", html },
      auditHtml: gutenbergToAuditHtml(html),
    };
  }

  if (prepared.format === "elementor") {
    return injectImagesIntoElementorPrepared(
      {
        format: "elementor",
        storage: {
          format: "elementor",
          html: prepared.storage.html,
          meta: prepared.storage.meta,
        },
        auditHtml: prepared.auditHtml,
      },
      images
    );
  }

  if (prepared.format === "divi") {
    const html = injectImagesIntoDiviHtml(prepared.storage.html, images);
    return {
      format: "divi",
      storage: { format: "divi", html },
      auditHtml: diviToAuditHtml(html),
    };
  }

  return prepared;
}

async function uploadThemeAsset(
  config: LoadedSiteConfig,
  asset: ThemeImageAsset,
  slot: PageImageSlot,
  pageTitle: string,
  themeSlug: string,
  cache: Map<string, WpMediaItem>
): Promise<WpMediaItem> {
  const cached = cache.get(asset.key);
  if (cached) return cached;

  const slugBase =
    pageTitle.trim().toLowerCase().replace(/\s+/g, "-") || "page";
  const filenameBase = `${slugBase}-${slot.id}-${asset.filename.replace(/\.[^.]+$/, "")}`;

  try {
    const media = await uploadWordPressMediaFromUrl(config, asset.publicUrl, {
      filenameBase,
      altText: slot.alt,
      title: slot.alt,
    });
    cache.set(asset.key, media);
    return media;
  } catch {
    const fromZip = readThemeImageBytesFromZip(config, asset, themeSlug);
    if (!fromZip) throw new Error(`Could not fetch ${asset.relativePath}`);
    const media = await uploadWordPressMedia(config, fromZip.buffer, {
      filenameBase,
      mimeType: fromZip.mimeType,
      altText: slot.alt,
      title: slot.alt,
    });
    cache.set(asset.key, media);
    return media;
  }
}

async function fillSlotsFromThemeCatalog(
  config: LoadedSiteConfig,
  pageTitle: string,
  slots: PageImageSlot[],
  catalog: ThemeImageAsset[],
  themeSlug: string,
  onLog?: LogSink
): Promise<UploadedPageImage[]> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const picks = pickThemeImagesForSlots(
    catalog,
    slots.map((s) => ({ role: s.role }))
  );
  const uploaded: UploadedPageImage[] = [];
  const cache = new Map<string, WpMediaItem>();

  for (let i = 0; i < picks.length; i++) {
    const asset = picks[i];
    const slot = slots[i];
    if (!asset || !slot) break;
    try {
      log.info(`Using theme demo image "${asset.relativePath}" for ${slot.id}.`, {
        phase: "phase2",
        pageTitle,
      });
      const media = await uploadThemeAsset(
        config,
        asset,
        slot,
        pageTitle,
        themeSlug,
        cache
      );
      uploaded.push({ ...slot, media });
    } catch (err) {
      const message = err instanceof Error ? err.message : "theme image upload failed";
      log.warn(`Theme image for "${slot.id}" skipped: ${message}`, {
        phase: "phase2",
        pageTitle,
      });
    }
  }

  return uploaded;
}

async function fillRemainingSlotsWithAi(
  config: LoadedSiteConfig,
  pageTitle: string,
  slots: PageImageSlot[],
  already: UploadedPageImage[],
  client: OpenAI,
  onLog?: LogSink
): Promise<UploadedPageImage[]> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const filledIds = new Set(already.map((u) => u.id));
  const remaining = slots.filter((s) => !filledIds.has(s.id));
  const slugBase =
    pageTitle.trim().toLowerCase().replace(/\s+/g, "-") || "page";
  const out = [...already];

  for (const slot of remaining) {
    try {
      log.info(`AI fallback image (${slot.id})…`, { phase: "phase2", pageTitle });
      const generated = await generateGrokImage(config, slot.prompt, {
        aspectRatio: slot.aspectRatio,
        client,
      });
      const media = await uploadWordPressMedia(config, generated.buffer, {
        filenameBase: `${slugBase}-${slot.id}`,
        mimeType: generated.mimeType,
        title: slot.alt,
        altText: slot.alt,
      });
      out.push({ ...slot, media });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Image step failed";
      log.warn(`Skipped AI image "${slot.id}": ${message}`, {
        phase: "phase2",
        pageTitle,
      });
    }
  }

  return out;
}

export type PageImageEnrichmentOptions = {
  /** Blog posts set featured media via title banner — do not overwrite. */
  skipFeaturedMedia?: boolean;
  phase?: "phase2" | "phase4";
};

export async function enrichPreparedContentWithPageImages(
  config: LoadedSiteConfig,
  prepared: PreparedContent,
  pageTitle: string,
  brief: Brief,
  pageId: number,
  onLog?: LogSink,
  options?: PageImageEnrichmentOptions
): Promise<PreparedContent> {
  const logPhase = options?.phase ?? "phase2";
  if (!pageImagesEnabled()) {
    return prepared;
  }

  const contentHtml = prepared.storage.html;
  const matchDesignRef = hasDesignReferenceScreenshots(config);
  const logoPalette = await extractLogoPalette(config, onLog);
  const brandColors = logoPalette
    ? `${logoPalette.primary}, ${logoPalette.secondary}, ${logoPalette.accent}`
    : undefined;
  const slots = resolvePageImageSlots(
    contentHtml,
    pageTitle,
    brief,
    matchDesignRef,
    brandColors
  );

  if (slots.length === 0) {
    return prepared;
  }

  const log = createPipelineLogger(onLog ?? (() => undefined));
  const profile = await loadThemeStyleProfile(config, onLog);
  const catalog = buildThemeImageCatalog(config, profile, contentHtml);
  const themeSlug =
    profile.themeSlug?.trim() ||
    (config.activeThemeZipPath?.trim()
      ? detectThemeSlugFromZip(resolveLocalThemePath(config.activeThemeZipPath))
      : "");

  const slotsToFill = slots;

  log.info(
    `Page images: ${slotsToFill.length} slot(s) for "${pageTitle}" (theme catalog: ${catalog.length}, AI fallback: ${pageImagesUseAi() ? "on" : "off"})…`,
    { phase: logPhase, pageTitle, pageId }
  );

  let uploaded = await fillSlotsFromThemeCatalog(
    config,
    pageTitle,
    slotsToFill,
    catalog,
    themeSlug,
    onLog
  );

  if (uploaded.length < slotsToFill.length && pageImagesUseAi()) {
    const client = createGrokClient(config);
    uploaded = await fillRemainingSlotsWithAi(
      config,
      pageTitle,
      slotsToFill,
      uploaded,
      client,
      onLog
    );
  } else if (uploaded.length < slotsToFill.length) {
    log.warn(
      "Some image slots unfilled (theme upload failed and PAGE_IMAGES_AI=false).",
      { phase: logPhase, pageTitle, pageId }
    );
  }

  if (uploaded.length === 0) {
    log.warn("No images uploaded for this page; content saved without images.", {
      phase: logPhase,
      pageTitle,
      pageId,
    });
    return prepared;
  }

  const enriched = applyUploadedImages(prepared, uploaded);

  if (!options?.skipFeaturedMedia) {
    const hero = uploaded.find((u) => u.role === "hero") ?? uploaded[0];
    try {
      await setPageFeaturedMedia(config, pageId, hero.media.id);
      log.info(`Set featured image (media #${hero.media.id}) on page ${pageId}.`, {
        phase: logPhase,
        pageTitle,
        pageId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "featured_media failed";
      log.warn(`Could not set featured image: ${message}`, {
        phase: logPhase,
        pageTitle,
        pageId,
      });
    }
  }

  return enriched;
}
