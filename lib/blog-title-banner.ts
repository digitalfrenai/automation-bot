import type { LoadedSiteConfig } from "@/lib/config-loader";
import { generateGrokImage } from "@/lib/grok-images";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { titleToSlug } from "@/lib/wordpress-client";
import { uploadWordPressMedia } from "@/lib/wordpress-media";
import {
  activeThemeIsBraine,
  ensureBotBridgeInstalled,
} from "@/lib/wordpress-bot-bridge";
import { wpRequest } from "@/lib/wordpress-client";

const BANNER_ROUTE = "/wp-json/wordpress-bot/v1/post-banner";

function bannerPrompt(topic: string, niche: string, businessName: string): string {
  return [
    "Wide photographic website banner, no text, no letters, no logo, no watermark.",
    `Scene that illustrates this blog topic: ${topic}.`,
    `Business: ${businessName}. Niche: ${niche}.`,
    "Photorealistic, slightly dark so a white headline can sit on top, 16:9 composition.",
  ].join(" ");
}

async function saveBraineTitleBanner(
  config: LoadedSiteConfig,
  postId: number,
  mediaId: number,
  sourceUrl: string,
  onLog?: LogSink
): Promise<boolean> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const send = () =>
    wpRequest<{ banner?: string }>(config, BANNER_ROUTE, {
      method: "POST",
      body: JSON.stringify({
        post_id: postId,
        media_id: mediaId,
        source_url: sourceUrl,
      }),
    });

  try {
    const result = await send();
    if (result.banner?.trim()) return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!message.includes("404")) {
      log.warn(`Blog title banner route failed: ${message}`, {
        phase: "phase4",
        pageId: postId,
      });
    }
  }

  const installed = await ensureBotBridgeInstalled(config, onLog);
  if (!installed) return false;
  try {
    const result = await send();
    return Boolean(result.banner?.trim());
  } catch (err) {
    const message = err instanceof Error ? err.message : "banner save failed";
    log.warn(`Could not save the blog title background: ${message}`, {
      phase: "phase4",
      pageId: postId,
    });
    return false;
  }
}

export async function assignBlogTitleBanner(
  config: LoadedSiteConfig,
  postId: number,
  topic: { topic: string; keyword: string },
  onLog?: LogSink
): Promise<void> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  log.info(`Generating a title background for "${topic.topic}"…`, {
    phase: "phase4",
    pageTitle: topic.topic,
    pageId: postId,
  });

  const image = await generateGrokImage(
    config,
    bannerPrompt(topic.topic, config.niche, config.businessName),
    { aspectRatio: "16:9" }
  );
  const media = await uploadWordPressMedia(config, image.buffer, {
    filenameBase: `${titleToSlug(topic.topic) || "blog"}-banner`,
    mimeType: image.mimeType,
    title: `${topic.topic} banner`,
    altText: topic.topic,
  });

  await wpRequest(config, `/wp-json/wp/v2/posts/${postId}`, {
    method: "POST",
    body: JSON.stringify({ featured_media: media.id }),
  });

  const braine = await activeThemeIsBraine(config);
  if (!braine) {
    log.info(`Set featured image (media #${media.id}) on the blog post.`, {
      phase: "phase4",
      pageTitle: topic.topic,
      pageId: postId,
    });
    return;
  }

  const saved = await saveBraineTitleBanner(
    config,
    postId,
    media.id,
    media.source_url,
    onLog
  );
  if (saved) {
    log.info(
      `Blog title background set from an image about "${topic.keyword}" (media #${media.id}).`,
      { phase: "phase4", pageTitle: topic.topic, pageId: postId }
    );
    return;
  }
  log.warn(
    `Featured image #${media.id} was uploaded, but Braine's title band was not updated.`,
    { phase: "phase4", pageTitle: topic.topic, pageId: postId }
  );
}
