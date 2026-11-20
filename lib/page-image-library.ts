import { readFile } from "fs/promises";
import path from "path";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import type { PageImageSlot, UploadedPageImage } from "@/lib/page-image-enrichment";
import { parseStringArray } from "@/lib/site-config";
import { resolveStoredPageImagePath } from "@/lib/asset-upload-storage";
import { uploadWordPressMedia } from "@/lib/wordpress-media";
import { titleToSlug } from "@/lib/wordpress-client";

function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

export function hasPageImageLibrary(config: LoadedSiteConfig): boolean {
  const row = config as LoadedSiteConfig & { pageImageUploadPaths?: unknown };
  return parseStringArray(row.pageImageUploadPaths).length > 0;
}

export async function fillSlotsFromUploadedLibrary(
  config: LoadedSiteConfig,
  pageTitle: string,
  slots: PageImageSlot[],
  onLog?: LogSink,
  logPhase: "phase2" | "phase4" = "phase2"
): Promise<UploadedPageImage[]> {
  const row = config as LoadedSiteConfig & { pageImageUploadPaths?: unknown };
  const paths = parseStringArray(row.pageImageUploadPaths);
  if (paths.length === 0 || slots.length === 0) {
    return [];
  }

  const log = createPipelineLogger(onLog ?? (() => undefined));
  const slugBase = titleToSlug(pageTitle) || "page";
  const uploaded: UploadedPageImage[] = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const publicPath = paths[i % paths.length]!;
    try {
      const absolute = resolveStoredPageImagePath(publicPath);
      const buffer = await readFile(absolute);
      const media = await uploadWordPressMedia(config, buffer, {
        filenameBase: `${slugBase}-${slot.id}-lib`,
        mimeType: mimeForPath(absolute),
        title: slot.alt,
        altText: slot.alt,
      });
      uploaded.push({ ...slot, media });
    } catch (err) {
      const message = err instanceof Error ? err.message : "library upload failed";
      log.warn(`Page image library slot "${slot.id}" skipped: ${message}`, {
        phase: logPhase,
        pageTitle,
      });
    }
  }

  if (uploaded.length > 0) {
    log.info(
      `Page images: used ${uploaded.length} uploaded library file(s) (no Grok image generation).`,
      { phase: logPhase, pageTitle }
    );
  }

  return uploaded;
}