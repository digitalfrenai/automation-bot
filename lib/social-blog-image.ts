import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import {
  canWatermarkSocialImages,
  loadBusinessLogoBuffer,
  watermarkImageWithLogo,
} from "@/lib/social-image-watermark";
import { titleToSlug } from "@/lib/wordpress-client";
import { uploadWordPressMedia } from "@/lib/wordpress-media";
import { fetchPostFeaturedImageUrl } from "@/lib/wordpress-post-media";

export async function prepareWatermarkedBlogImageForSocial(
  config: LoadedSiteConfig,
  wpPostId: number,
  title: string,
  onLog?: LogSink
): Promise<string | null> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const featuredUrl = await fetchPostFeaturedImageUrl(config, wpPostId);
  if (!featuredUrl) {
    log.warn("Blog has no featured image for social sharing.", {
      phase: "phase6",
      pageId: wpPostId,
    });
    return null;
  }

  const imageRes = await fetch(featuredUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!imageRes.ok) {
    log.warn(`Could not download blog featured image (${imageRes.status}).`, {
      phase: "phase6",
      pageId: wpPostId,
    });
    return null;
  }
  const rawMime =
    imageRes.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const rawBuffer = Buffer.from(await imageRes.arrayBuffer());

  let uploadBuffer = rawBuffer;
  let uploadMime = rawMime;

  if (await canWatermarkSocialImages(config)) {
    const logo = await loadBusinessLogoBuffer(config);
    if (logo) {
      try {
        const marked = await watermarkImageWithLogo(rawBuffer, logo);
        uploadBuffer = marked.buffer;
        uploadMime = marked.mimeType;
        log.info("Applied business logo watermark to the blog share image.", {
          phase: "phase6",
          pageId: wpPostId,
        });
      } catch (err) {
        log.warn(
          `Logo watermark skipped: ${err instanceof Error ? err.message : "composite failed"}`,
          { phase: "phase6", pageId: wpPostId }
        );
      }
    }
  }

  const slug = titleToSlug(title) || `post-${wpPostId}`;
  const media = await uploadWordPressMedia(config, uploadBuffer, {
    filenameBase: `${slug}-social`,
    mimeType: uploadMime,
    title: `${title} — social share`,
    altText: title,
  });
  return media.source_url;
}
