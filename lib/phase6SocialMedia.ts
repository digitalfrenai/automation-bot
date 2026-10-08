import { loadSiteConfig } from "@/lib/config-loader";
import { createGrokClient, extractJsonObject, GROK_MODEL } from "@/lib/grok-client";
import { createGrokChatCompletion } from "@/lib/grok-request";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import type { SocialPlatformVariant } from "@/lib/pipeline-types";
import { prisma } from "@/lib/prisma";
import {
  parseSocialPlatforms,
  publishToSocialPlatform,
  type SocialPlatform,
} from "@/lib/social-publishers";
import { prepareWatermarkedBlogImageForSocial } from "@/lib/social-blog-image";
import { mergeSocialHashtags } from "@/lib/social-hashtags";
import { fetchPostTagNames } from "@/lib/wordpress-post-media";
import { normalizeWpUrl } from "@/lib/wordpress-client";

function buildSocialSystemPrompt(): string {
  return `You are a social media strategist writing platform-specific posts from website/blog content.
Return ONLY a JSON object:
{
  "platforms": [
    {
      "platform": "x" | "linkedin" | "facebook" | "instagram",
      "caption": "platform-optimized caption",
      "hashtags": ["tag1", "tag2"],
      "promotional_snippet": "short promo blurb under 120 chars"
    }
  ]
}
Rules:
- x: punchy, under ~240 chars before hashtags, 2–4 hashtags.
- linkedin: professional, value-led, 3–6 hashtags.
- facebook: conversational, CTA, 3–5 hashtags.
- Instagram: engaging caption, emoji sparingly, 5–10 hashtags.
- Include the source URL naturally when provided.
- hashtags must be a non-empty array (at least 3 tags). Prefer supplied blog tags when relevant.
- Do not repeat the caption text inside hashtags.
- No markdown fences, no prose outside JSON.`;
}

function buildSocialUserPrompt(input: {
  title: string;
  excerpt: string;
  url?: string;
  platforms: SocialPlatform[];
  brief: {
    businessName: string;
    niche: string;
    toneOfVoice: string;
    targetAudience: string;
  };
  blogTags?: string[];
}): string {
  const tagLine =
    input.blogTags && input.blogTags.length > 0
      ? `Blog tags (use in hashtags): ${input.blogTags.join(", ")}`
      : "";
  return `Create social posts for platforms: ${input.platforms.join(", ")}.

Title: ${input.title}
Source URL: ${input.url || "N/A"}
Excerpt / content summary:
${input.excerpt.slice(0, 4000)}

Business: ${input.brief.businessName}
Niche: ${input.brief.niche}
Tone: ${input.brief.toneOfVoice}
Audience: ${input.brief.targetAudience}
${tagLine}`;
}

function parseSocialVariants(
  text: string,
  requested: SocialPlatform[]
): SocialPlatformVariant[] {
  const jsonText = extractJsonObject(text);
  const parsed = JSON.parse(jsonText) as {
    platforms?: Array<{
      platform?: string;
      caption?: string;
      hashtags?: string[];
      promotional_snippet?: string;
    }>;
  };

  if (!Array.isArray(parsed.platforms)) {
    throw new Error("Grok returned no social platform variants.");
  }

  const wanted = new Set(requested);
  const out: SocialPlatformVariant[] = [];

  for (const item of parsed.platforms) {
    const platform = (item.platform || "").toLowerCase() as SocialPlatform;
    if (!wanted.has(platform)) continue;
    if (typeof item.caption !== "string" || !item.caption.trim()) continue;
    out.push({
      platform,
      caption: item.caption.trim(),
      hashtags: Array.isArray(item.hashtags)
        ? item.hashtags.filter((h): h is string => typeof h === "string")
        : [],
      promotionalSnippet:
        typeof item.promotional_snippet === "string"
          ? item.promotional_snippet.trim()
          : "",
    });
  }

  if (out.length === 0) {
    throw new Error("No usable social variants for requested platforms.");
  }

  return out;
}

export type SocialSourceInput = {
  title: string;
  excerpt: string;
  url?: string;
  sourceType?: "blog" | "page_update" | "post_update" | "manual";
  blogPostRecordId?: string;
  wpPostId?: number;
};

export type Phase6SocialResult = {
  platform: SocialPlatform;
  socialPostId: string;
  status: string;
  caption: string;
};

async function recordTask(
  configId: string,
  phase: string,
  title: string,
  status: "completed" | "failed",
  message?: string
) {
  await prisma.automationTask.create({
    data: {
      siteConfigId: configId,
      phase,
      title,
      status,
      message: message ?? null,
    },
  });
}

/**
 * Phase 6: generate platform-specific captions/hashtags and prepare for schedule/publish.
 * Does nothing harmful when socialEnabled is false (caller should gate).
 */
export async function executePhase6ForSource(
  configId: string,
  source: SocialSourceInput,
  onLog?: LogSink
): Promise<Phase6SocialResult[]> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const config = await loadSiteConfig(configId);

  if (!config.socialEnabled) {
    log.info("Phase 6 skipped — social automation disabled in settings.", {
      phase: "phase6",
    });
    return [];
  }

  const platforms = parseSocialPlatforms(config.socialPlatforms);
  const client = createGrokClient(config);
  const requireApproval = config.socialRequireApproval;

  log.info(
    `Phase 6: generating social posts for "${source.title}" (${platforms.join(", ")})…`,
    { phase: "phase6", pageTitle: source.title, pageId: source.wpPostId }
  );

  let blogTags: string[] = [];
  if (source.wpPostId) {
    try {
      blogTags = await fetchPostTagNames(config, source.wpPostId);
    } catch (err) {
      log.warn(
        `Could not read blog tags for social hashtags: ${err instanceof Error ? err.message : "lookup failed"}`,
        { phase: "phase6", pageId: source.wpPostId }
      );
    }
  }

  let mediaUrl: string | null = null;
  if (source.wpPostId) {
    try {
      mediaUrl = await prepareWatermarkedBlogImageForSocial(
        config,
        source.wpPostId,
        source.title,
        onLog
      );
    } catch (err) {
      log.warn(
        `Social share image skipped: ${err instanceof Error ? err.message : "prepare failed"}`,
        { phase: "phase6", pageId: source.wpPostId }
      );
    }
  }

  const completion = await createGrokChatCompletion(
    client,
    {
      model: GROK_MODEL,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSocialSystemPrompt() },
        {
          role: "user",
          content: buildSocialUserPrompt({
            title: source.title,
            excerpt: source.excerpt,
            url: source.url,
            platforms,
            brief: {
              businessName: config.businessName,
              niche: config.niche,
              toneOfVoice: config.toneOfVoice,
              targetAudience: config.targetAudience,
            },
            blogTags,
          }),
        },
      ],
    },
    { label: `Phase 6 social for "${source.title}"`, onLog }
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`Grok returned empty social payload for "${source.title}".`);
  }

  const variants = parseSocialVariants(content, platforms);
  const results: Phase6SocialResult[] = [];
  const delayHours = Math.max(0, config.socialScheduleDelayHours);
  const scheduledAt =
    !requireApproval && delayHours > 0
      ? new Date(Date.now() + delayHours * 60 * 60 * 1000)
      : !requireApproval
        ? new Date()
        : null;

  for (const variant of variants) {
    const hashtags = mergeSocialHashtags(variant.hashtags, blogTags);
    let status = requireApproval ? "draft" : scheduledAt ? "scheduled" : "draft";
    let externalPostId: string | null = null;
    let errorMessage: string | null = null;
    let publishedAt: Date | null = null;

    // Immediate publish only when approval off and no delay
    if (!requireApproval && delayHours === 0) {
      const published = await publishToSocialPlatform(
        config,
        variant.platform,
        variant.caption,
        hashtags,
        { imageUrl: mediaUrl ?? undefined, linkUrl: source.url }
      );
      if (published.ok) {
        status = "published";
        externalPostId = published.externalPostId ?? null;
        publishedAt = new Date();
        log.info(`Published to ${variant.platform}.`, {
          phase: "phase6",
          pageTitle: source.title,
        });
      } else if (published.skipped) {
        status = "scheduled";
        errorMessage = published.error ?? null;
        log.warn(
          `${variant.platform}: ${published.error ?? "prepared only (no API token)."}`,
          { phase: "phase6", pageTitle: source.title }
        );
      } else {
        status = "failed";
        errorMessage = published.error ?? "Publish failed.";
        log.error(`Failed to publish to ${variant.platform}: ${errorMessage}`, {
          phase: "phase6",
          pageTitle: source.title,
        });
        await recordTask(
          configId,
          "social_publish",
          `${variant.platform}: ${source.title}`,
          "failed",
          errorMessage
        );
      }
    } else if (status === "scheduled") {
      log.info(
        `Scheduled ${variant.platform} post for ${scheduledAt?.toISOString()}.`,
        { phase: "phase6", pageTitle: source.title }
      );
    } else {
      log.info(
        `Saved ${variant.platform} caption as draft for approval.`,
        { phase: "phase6", pageTitle: source.title }
      );
    }

    const row = await prisma.socialPostRecord.create({
      data: {
        siteConfigId: configId,
        blogPostId: source.blogPostRecordId ?? null,
        platform: variant.platform,
        sourceType: source.sourceType ?? "blog",
        sourceTitle: source.title,
        sourceUrl: source.url ?? null,
        caption: variant.caption,
        hashtags,
        mediaUrl: mediaUrl ?? null,
        promotionalSnippet: variant.promotionalSnippet || null,
        status,
        requireApproval,
        scheduledAt: status === "scheduled" ? scheduledAt : null,
        publishedAt,
        externalPostId,
        errorMessage,
      },
    });

    results.push({
      platform: variant.platform,
      socialPostId: row.id,
      status: row.status,
      caption: row.caption,
    });
  }

  await recordTask(
    configId,
    "phase6",
    `Social for ${source.title}`,
    "completed",
    `${results.length} platform variant(s)`
  );

  log.info(
    `Phase 6 complete for "${source.title}" — ${results.length} variant(s).`,
    { phase: "phase6", pageTitle: source.title }
  );

  return results;
}

export function buildPublicPostUrl(
  wpUrl: string,
  slug: string | null | undefined
): string | undefined {
  if (!slug?.trim()) return undefined;
  return `${normalizeWpUrl(wpUrl)}/${slug.trim()}/`;
}

/**
 * Process due scheduled social posts (cron / Phase 8).
 */
export async function publishDueSocialPosts(
  configId: string,
  onLog?: LogSink
): Promise<number> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const config = await loadSiteConfig(configId);
  const now = new Date();

  const due = await prisma.socialPostRecord.findMany({
    where: {
      siteConfigId: configId,
      status: "scheduled",
      scheduledAt: { lte: now },
    },
    take: 20,
  });

  if (due.length === 0) {
    log.info("No scheduled social posts due.", { phase: "phase6" });
    return 0;
  }

  let published = 0;

  for (const post of due) {
    const hashtags = Array.isArray(post.hashtags)
      ? (post.hashtags as string[])
      : [];
    const result = await publishToSocialPlatform(
      config,
      post.platform as SocialPlatform,
      post.caption,
      hashtags,
      {
        imageUrl: post.mediaUrl ?? undefined,
        linkUrl: post.sourceUrl ?? undefined,
      }
    );

    if (result.ok) {
      await prisma.socialPostRecord.update({
        where: { id: post.id },
        data: {
          status: "published",
          publishedAt: new Date(),
          externalPostId: result.externalPostId ?? null,
          errorMessage: null,
        },
      });
      published += 1;
      log.info(`Published scheduled ${post.platform} post ${post.id}.`, {
        phase: "phase6",
        pageTitle: post.sourceTitle ?? undefined,
      });
    } else if (result.skipped) {
      await prisma.socialPostRecord.update({
        where: { id: post.id },
        data: {
          status: "draft",
          errorMessage: result.error ?? "Missing platform credentials.",
        },
      });
      log.warn(
        `Scheduled ${post.platform} kept as draft: ${result.error}`,
        { phase: "phase6" }
      );
    } else {
      await prisma.socialPostRecord.update({
        where: { id: post.id },
        data: {
          status: "failed",
          errorMessage: result.error ?? "Publish failed.",
        },
      });
      await recordTask(
        configId,
        "social_publish",
        `${post.platform}: ${post.sourceTitle ?? post.id}`,
        "failed",
        result.error
      );
      log.error(`Scheduled publish failed: ${result.error}`, {
        phase: "phase6",
      });
    }
  }

  return published;
}
