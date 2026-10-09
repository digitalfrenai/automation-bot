import type { LoadedSiteConfig } from "@/lib/config-loader";
import { generateGrokImage, imagePromptPhysicalScene } from "@/lib/grok-images";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import type { PipelinePhase } from "@/lib/pipeline-types";
import { titleToSlug } from "@/lib/wordpress-client";
import { uploadWordPressMedia } from "@/lib/wordpress-media";
import {
  activeThemeIsBraine,
  applyPostTitleBannerViaWpCli,
  ensureBotBridgeInstalled,
} from "@/lib/wordpress-bot-bridge";
import { hasRemoteShellCredentials } from "@/lib/wordpress-ssh";
import { wpRequest } from "@/lib/wordpress-client";

const BANNER_ROUTE = "/wp-json/wordpress-bot/v1/post-banner";

function bannerPromptForScene(niche: string, sceneHint: string, kind: "page" | "post"): string {
  const header =
    kind === "page"
      ? "Wide cinematic photograph for a website page header background."
      : "Wide cinematic photograph for a blog header background.";
  return [
    header,
    imagePromptPhysicalScene({ niche, slotHint: sceneHint }),
    "Workshop or studio, photorealistic, slightly dark for a white HTML headline overlay, 16:9.",
    "No monitors facing camera, no brochures, no painted slogans.",
  ].join(" ");
}

async function saveBraineTitleBannerMeta(
  config: LoadedSiteConfig,
  contentId: number,
  mediaId: number,
  sourceUrl: string,
  phase: PipelinePhase,
  onLog?: LogSink
): Promise<boolean> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const send = () =>
    wpRequest<{ banner?: string }>(config, BANNER_ROUTE, {
      method: "POST",
      body: JSON.stringify({
        post_id: contentId,
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
      log.warn(`Title banner REST route failed: ${message}`, {
        phase,
        pageId: contentId,
      });
    }
  }

  const installed = await ensureBotBridgeInstalled(config, onLog);
  if (installed) {
    try {
      const result = await send();
      if (result.banner?.trim()) return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "banner save failed";
      log.warn(`Title banner REST retry failed: ${message}`, {
        phase,
        pageId: contentId,
      });
    }
  }

  if (hasRemoteShellCredentials(config)) {
    return applyPostTitleBannerViaWpCli(
      config,
      contentId,
      mediaId,
      sourceUrl,
      onLog
    );
  }

  log.warn(
    "Install wordpress-bot-rest-bridge.php in wp-content/mu-plugins/ (SFTP auto-install or manual upload), then re-run the phase.",
    { phase, pageId: contentId }
  );
  return false;
}

export type BraineTitleBannerTarget = {
  id: number;
  title: string;
  sceneHint: string;
  kind: "page" | "post";
  phase: PipelinePhase;
};

export async function assignBraineTitleBanner(
  config: LoadedSiteConfig,
  target: BraineTitleBannerTarget,
  onLog?: LogSink
): Promise<void> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const { id, title, sceneHint, kind, phase } = target;

  log.info(`Generating Braine title background for "${title}"…`, {
    phase,
    pageTitle: title,
    pageId: id,
  });

  const image = await generateGrokImage(
    config,
    bannerPromptForScene(config.niche, sceneHint, kind),
    {
      aspectRatio: "16:9",
      onLog,
      logMeta: { phase, pageTitle: title, slotId: "title-banner" },
    }
  );

  const slugBase = titleToSlug(title) || (kind === "page" ? "page" : "blog");
  const media = await uploadWordPressMedia(config, image.buffer, {
    filenameBase: `${slugBase}-title-banner`,
    mimeType: image.mimeType,
    title: `${title} title banner`,
    altText: title,
  });

  const restCollection = kind === "page" ? "pages" : "posts";
  await wpRequest(config, `/wp-json/wp/v2/${restCollection}/${id}`, {
    method: "POST",
    body: JSON.stringify({ featured_media: media.id }),
  });

  const braine = await activeThemeIsBraine(config);
  if (!braine) {
    log.info(`Set featured image (media #${media.id}) on ${kind} ${id}.`, {
      phase,
      pageTitle: title,
      pageId: id,
    });
    return;
  }

  const saved = await saveBraineTitleBannerMeta(
    config,
    id,
    media.id,
    media.source_url,
    phase,
    onLog
  );
  if (saved) {
    log.info(`Title background set behind "${title}" (media #${media.id}).`, {
      phase,
      pageTitle: title,
      pageId: id,
    });
    return;
  }

  log.warn(
    `Featured image #${media.id} uploaded, but Braine's title band was not updated (banner_page_background).`,
    { phase, pageTitle: title, pageId: id }
  );
}

export async function assignPageTitleBanner(
  config: LoadedSiteConfig,
  pageId: number,
  pageTitle: string,
  onLog?: LogSink
): Promise<void> {
  await assignBraineTitleBanner(
    config,
    {
      id: pageId,
      title: pageTitle,
      sceneHint: pageTitle,
      kind: "page",
      phase: "phase2",
    },
    onLog
  );
}

export async function assignBlogTitleBanner(
  config: LoadedSiteConfig,
  postId: number,
  topic: { topic: string; keyword: string },
  onLog?: LogSink
): Promise<void> {
  await assignBraineTitleBanner(
    config,
    {
      id: postId,
      title: topic.topic,
      sceneHint: topic.keyword || topic.topic,
      kind: "post",
      phase: "phase4",
    },
    onLog
  );
}
