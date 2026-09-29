import type OpenAI from "openai";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import { hasDesignReferenceScreenshots } from "@/lib/design-reference-vision";
import type { PreparedContent } from "@/lib/content-pipeline";
import { injectImagesIntoElementorPrepared } from "@/lib/elementor-builder";
import { diviToAuditHtml, injectImagesIntoDiviHtml } from "@/lib/divi-builder";
import {
  gutenbergToAuditHtml,
  hasGutenbergBlocks,
  useBlockEditorImagesForPages,
  wpImageBlockFromMedia,
} from "@/lib/gutenberg-content";
import {
  generateGrokImage,
  pageImagesEnabled,
  pageImagesUseAi,
} from "@/lib/grok-images";
import { createGrokClient } from "@/lib/grok-client";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import {
  buildThemeImageCatalog,
  extractImageUrlsFromMarkup,
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

function basePhotoRules(brief: Brief, matchDesignReference?: boolean): string {
  const styleNote = matchDesignReference
    ? " Match color mood and photography style of the client's reference website screenshots (same visual design language as the target site)."
    : " Match the look of a modern WordPress business theme demo (consistent color grading and composition).";
  return `Professional marketing photograph for "${brief.businessName}" (${brief.niche}). Audience: ${brief.targetAudience}. Tone: ${brief.toneOfVoice}. Services: ${brief.coreServices.join(", ") || "general business"}.${styleNote} Photorealistic, well-lit, no text overlays, no logos, no watermarks.`;
}

export function countVisibleImages(html: string): number {
  return (html.match(/<img\b/gi) ?? []).length;
}

export function planPageImageSlots(
  pageTitle: string,
  brief: Brief,
  matchDesignReference?: boolean
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
        prompt: `${basePhotoRules(brief, matchDesignReference)} Wide hero banner in the same visual style as the active WordPress theme demo.`,
      },
      {
        id: "services-visual",
        role: "section",
        aspectRatio: "4:3",
        alt: `${brief.businessName} services`,
        prompt: `${basePhotoRules(brief, matchDesignReference)} Section image matching theme demo service/feature photography.`,
      },
      {
        id: "trust-visual",
        role: "section",
        aspectRatio: "4:3",
        alt: `Trusted ${brief.niche} team at work`,
        prompt: `${basePhotoRules(brief, matchDesignReference)} Trust section image consistent with theme demo imagery.`,
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
        prompt: `${basePhotoRules(brief, matchDesignReference)} About page hero matching theme demo style.`,
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
        prompt: `${basePhotoRules(brief, matchDesignReference)} Services hero image matching theme demo style.`,
      },
      {
        id: "services-detail",
        role: "section",
        aspectRatio: "4:3",
        alt: `${brief.businessName} service detail`,
        prompt: `${basePhotoRules(brief, matchDesignReference)} Services detail image matching theme demo style.`,
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
      prompt: `${basePhotoRules(brief, matchDesignReference)} Page hero image matching theme demo style for "${pageTitle}".`,
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

function countPlaceholderImages(html: string): number {
  let count = 0;
  const re = /<img\b[^>]*\bsrc=(["'])(.*?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (isPlaceholderImgSrc(m[2])) count++;
  }
  return count;
}

function hasThemeBundledImages(html: string): boolean {
  const re = /<img\b[^>]*\bsrc=(["'])(.*?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (isThemeBundledImgSrc(m[2])) return true;
  }
  return false;
}

function imageBlockForUpload(upload: UploadedPageImage): string {
  return wpImageBlockFromMedia(upload.media, upload.alt);
}

function htmlHeroFigure(url: string, alt: string): string {
  const safeAlt = alt.replace(/"/g, "&quot;");
  return `<figure class="page-hero-banner"><img src="${url}" alt="${safeAlt}" loading="eager" decoding="async"/></figure>`;
}

function htmlSectionFigure(url: string, alt: string): string {
  const safeAlt = alt.replace(/"/g, "&quot;");
  return `<figure class="page-section-image"><img src="${url}" alt="${safeAlt}" loading="lazy" decoding="async"/></figure>`;
}

const LOGO_IMG_ATTR =
  /\b(?:custom-logo|site-logo|logo-img|brand-logo|navbar-brand|wp-custom-logo)\b/i;

function shouldSwapImgSrc(attrs: string, src: string): boolean {
  if (LOGO_IMG_ATTR.test(attrs)) return false;
  if (isPlaceholderImgSrc(src)) return true;
  if (isThemeBundledImgSrc(src) && !/\blogo\b/i.test(src)) return true;
  return false;
}

function replaceSwappableImgSources(
  html: string,
  images: UploadedPageImage[]
): string {
  if (images.length === 0) return html;
  let index = 0;
  return html.replace(/<img\b([^>]*?)>/gi, (full, attrs: string) => {
    if (index >= images.length) return full;
    const srcMatch = attrs.match(/\bsrc=(["'])(.*?)\1/i);
    const currentSrc = srcMatch?.[2] ?? "";
    if (!shouldSwapImgSrc(attrs, currentSrc)) return full;

    const img = images[index++];
    let nextAttrs = attrs;
    if (srcMatch) {
      nextAttrs = nextAttrs.replace(
        srcMatch[0],
        `src="${img.media.source_url}"`
      );
    } else {
      nextAttrs = `${nextAttrs} src="${img.media.source_url}"`;
    }
    if (/\balt=(["']).*?\1/i.test(nextAttrs)) {
      nextAttrs = nextAttrs.replace(
        /\balt=(["']).*?\1/i,
        `alt="${img.alt.replace(/"/g, "&quot;")}"`
      );
    } else {
      nextAttrs = `${nextAttrs} alt="${img.alt.replace(/"/g, "&quot;")}"`;
    }
    return `<img${nextAttrs}>`;
  });
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
  if (html.includes(hero.media.source_url)) return html;
  const figure = htmlHeroFigure(hero.media.source_url, hero.alt);
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
    const fig = htmlSectionFigure(sec.media.source_url, sec.alt);
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
  const hero = images.find((i) => i.role === "hero");
  const sections = images.filter((i) => i.role === "section");
  let out = replaceSwappableImgSources(html, images);
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
  const hero = images.find((i) => i.role === "hero");
  const sections = images.filter((i) => i.role === "section");
  let out = replaceSwappableImgSources(html, images);
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
    useBlockEditorImagesForPages() ||
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
    const withElementor = injectImagesIntoElementorPrepared(
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
    const visibleHtml = applyImagesAsBlockStorage(
      withElementor.storage.html,
      images
    );
    return {
      format: "gutenberg",
      storage: {
        format: "gutenberg",
        html: visibleHtml,
        meta: withElementor.storage.meta,
      },
      auditHtml: gutenbergToAuditHtml(visibleHtml),
    };
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

async function resolveFeaturedMediaFromMarkup(
  config: LoadedSiteConfig,
  html: string,
  pageTitle: string,
  altFallback: string
): Promise<WpMediaItem | null> {
  const urls = extractImageUrlsFromMarkup(html, config.wpUrl);
  const themeFirst =
    urls.find((u) => isThemeBundledImgSrc(u)) ?? urls[0];
  if (!themeFirst) return null;

  try {
    return await uploadWordPressMediaFromUrl(config, themeFirst, {
      filenameBase: `${pageTitle.trim().toLowerCase().replace(/\s+/g, "-") || "page"}-featured`,
      altText: altFallback,
      title: altFallback,
    });
  } catch {
    return null;
  }
}

export async function enrichPreparedContentWithPageImages(
  config: LoadedSiteConfig,
  prepared: PreparedContent,
  pageTitle: string,
  brief: Brief,
  pageId: number,
  onLog?: LogSink
): Promise<PreparedContent> {
  if (!pageImagesEnabled()) {
    return prepared;
  }

  const contentHtml = prepared.storage.html;
  const matchDesignRef = hasDesignReferenceScreenshots(config);
  const slots = planPageImageSlots(pageTitle, brief, matchDesignRef);

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
    { phase: "phase2", pageTitle, pageId }
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
      { phase: "phase2", pageTitle, pageId }
    );
  }

  if (uploaded.length === 0) {
    log.warn("No images uploaded for this page; content saved without images.", {
      phase: "phase2",
      pageTitle,
      pageId,
    });
    return prepared;
  }

  const enriched = applyUploadedImages(prepared, uploaded);

  const hero = uploaded.find((u) => u.role === "hero") ?? uploaded[0];
  try {
    await setPageFeaturedMedia(config, pageId, hero.media.id);
    log.info(`Set featured image (media #${hero.media.id}) on page ${pageId}.`, {
      phase: "phase2",
      pageTitle,
      pageId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "featured_media failed";
    log.warn(`Could not set featured image: ${message}`, {
      phase: "phase2",
      pageTitle,
      pageId,
    });
  }

  return enriched;
}
