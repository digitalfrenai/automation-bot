import { readFile } from "fs/promises";
import path from "path";
import { loadSiteConfig } from "@/lib/config-loader";
import { createGrokClient, GROK_MODEL } from "@/lib/grok-client";
import { createGrokChatCompletion } from "@/lib/grok-request";
import {
  buildBlogSystemPrompt,
  grokUsesJsonObject,
  loadGenerationContext,
} from "@/lib/content-generation-context";
import { formatLabel } from "@/lib/content-format";
import {
  prepareContentFromGrok,
  savePreparedPostContent,
} from "@/lib/content-pipeline";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import type { Phase4PostResult } from "@/lib/pipeline-types";
import { prisma } from "@/lib/prisma";
import { runSeoAudit } from "@/lib/seo-audit";
import { fetchReferenceArticleText } from "@/lib/blog-reference-fetch";
import { parseStringArray } from "@/lib/site-config";
import { resolveStoredBlogImagePath } from "@/lib/asset-upload-storage";
import { titleToSlug } from "@/lib/wordpress-client";
import { uploadWordPressMedia } from "@/lib/wordpress-media";
import {
  assignPostCategory,
  assignPostTags,
} from "@/lib/blog-category";
import {
  createWordPressPost,
  replaceWordPressPostContent,
} from "@/lib/wordpress-post-content";
import { publishWordPressContent } from "@/lib/wordpress-publisher";
import { setPostFeaturedMedia } from "@/lib/wordpress-post-media";

function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function buildManualBlogUserPrompt(input: {
  contentTopic: string;
  keywords: string[];
  referenceText: string;
  brief: {
    businessName: string;
    niche: string;
    targetAudience: string;
    toneOfVoice: string;
    coreServices: string[];
  };
  imageCount: number;
}): string {
  const kw = input.keywords.length
    ? input.keywords.join(", ")
    : "Use natural phrases from the topic.";
  return `Rewrite the reference article into a new original blog post for this business.

Content topic (title / H1): ${input.contentTopic}
LSI / target keywords: ${kw}

Business: ${input.brief.businessName}
Niche: ${input.brief.niche}
Audience: ${input.brief.targetAudience}
Tone: ${input.brief.toneOfVoice}
Services: ${input.brief.coreServices.join(", ") || "N/A"}

Reference article (source material — rephrase completely, do not copy sentences):
---
${input.referenceText.slice(0, 18_000)}
---

Requirements:
- New title aligned with the content topic; weave keywords naturally.
- Use exactly ${input.imageCount} <img> tags with src="https://placehold.co/800x450" placeholders (automation replaces URLs).
- Place images: one after intro, others under major H2 sections.
- Article layout inside theme content width; no full-bleed heroes.`;
}

async function uploadBlogLibraryImages(
  config: Awaited<ReturnType<typeof loadSiteConfig>>,
  publicPaths: string[],
  slugBase: string
) {
  const mediaUrls: string[] = [];
  const mediaIds: number[] = [];

  for (let i = 0; i < publicPaths.length; i++) {
    const publicPath = publicPaths[i]!;
    const absolute = resolveStoredBlogImagePath(publicPath);
    const buffer = await readFile(absolute);
    const media = await uploadWordPressMedia(config, buffer, {
      filenameBase: `${slugBase}-blog-${i + 1}`,
      mimeType: mimeForPath(absolute),
      title: `Blog image ${i + 1}`,
      altText: `Blog image ${i + 1}`,
    });
    mediaUrls.push(media.source_url);
    mediaIds.push(media.id);
  }

  return { mediaUrls, mediaIds };
}

function injectUploadedImageUrls(html: string, urls: string[]): string {
  if (urls.length === 0) return html;
  let idx = 0;
  let out = html.replace(/https:\/\/placehold\.co\/[^"'\s)]+/gi, () => {
    const url = urls[idx % urls.length]!;
    idx += 1;
    return url;
  });
  while (idx < urls.length) {
    const url = urls[idx]!;
    const figure = `<figure class="blog-inline-image"><img src="${url}" alt="" loading="lazy" /></figure>`;
    const h2 = out.indexOf("</h2>");
    if (h2 === -1) {
      out += figure;
    } else {
      out = `${out.slice(0, h2 + 5)}${figure}${out.slice(h2 + 5)}`;
    }
    idx += 1;
  }
  return out;
}

export function manualBlogRunConfigured(
  config: Awaited<ReturnType<typeof loadSiteConfig>>
): boolean {
  const row = config as typeof config & {
    blogRunContentTopic?: string | null;
    blogReferencePostUrl?: string | null;
  };
  return Boolean(
    row.blogRunContentTopic?.trim() && row.blogReferencePostUrl?.trim()
  );
}

export async function executeManualBlogRun(
  configId: string,
  onLog?: LogSink
): Promise<Phase4PostResult> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const config = await loadSiteConfig(configId);
  const row = config as typeof config & {
    blogRunContentTopic?: string | null;
    blogReferencePostUrl?: string | null;
    blogRunKeywords?: unknown;
    blogRunImagePaths?: unknown;
    blogCategory?: string | null;
  };

  const contentTopic = row.blogRunContentTopic?.trim() ?? "";
  const referenceUrl = row.blogReferencePostUrl?.trim() ?? "";
  if (!contentTopic || !referenceUrl) {
    throw new Error(
      "Manual blog run requires Content Topic and Reference blog URL on the Blog tab."
    );
  }

  const keywords = parseStringArray(row.blogRunKeywords);
  const imagePaths = parseStringArray(row.blogRunImagePaths).slice(0, 3);

  log.info(`Phase 4 manual: fetching reference article…`, { phase: "phase4" });
  const referenceText = await fetchReferenceArticleText(referenceUrl);

  const client = createGrokClient(config);
  const genCtx = await loadGenerationContext(config, onLog);
  const requireApproval = config.blogRequireApproval;
  const publishStatus = requireApproval ? "draft" : "publish";

  log.info(
    `Phase 4 manual: writing ${formatLabel(genCtx.format)} post "${contentTopic}"…`,
    { phase: "phase4", pageTitle: contentTopic }
  );

  const completion = await createGrokChatCompletion(
    client,
    {
      model: GROK_MODEL,
      temperature: 0.65,
      ...(grokUsesJsonObject(genCtx.format)
        ? { response_format: { type: "json_object" as const } }
        : {}),
      messages: [
        {
          role: "system",
          content: buildBlogSystemPrompt(
            genCtx.format,
            genCtx.themeGuide,
            false
          ),
        },
        {
          role: "user",
          content: buildManualBlogUserPrompt({
            contentTopic,
            keywords,
            referenceText,
            imageCount: Math.max(imagePaths.length, 3),
            brief: {
              businessName: config.businessName,
              niche: config.niche,
              targetAudience: config.targetAudience,
              toneOfVoice: config.toneOfVoice,
              coreServices: config.coreServicesList,
            },
          }),
        },
      ],
    },
    { label: `Phase 4 manual blog "${contentTopic}"`, onLog }
  );

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error("Grok returned empty blog content.");
  }

  let prepared = prepareContentFromGrok(raw, genCtx.format, onLog, {
    pageTitle: contentTopic,
    phase: "phase4",
  });

  const slugBase = titleToSlug(contentTopic) || "blog-post";
  const draftPost = await createWordPressPost(config, {
    title: contentTopic,
    slug: slugBase,
    status: "draft",
    content: "",
  });

  const category =
    config.blogCategory?.trim() ||
    keywords[0]?.split(/\s+/).slice(0, 3).join(" ") ||
    contentTopic.split(/\s+/).slice(0, 3).join(" ");
  await assignPostCategory(config, draftPost.id, category, onLog);
  if (keywords.length > 0) {
    await assignPostTags(config, draftPost.id, keywords.slice(0, 5), onLog);
  }

  let html = prepared.storage.html;
  if (imagePaths.length > 0) {
    log.info(
      `Phase 4 manual: uploading ${imagePaths.length} blog image(s) (no Grok images).`,
      { phase: "phase4", pageId: draftPost.id }
    );
    const { mediaUrls, mediaIds } = await uploadBlogLibraryImages(
      config,
      imagePaths,
      slugBase
    );
    html = injectUploadedImageUrls(html, mediaUrls);
    prepared = {
      ...prepared,
      storage: { ...prepared.storage, html },
      auditHtml: html,
    };
    if (mediaIds[0]) {
      try {
        await setPostFeaturedMedia(config, draftPost.id, mediaIds[0]);
      } catch {
        /* optional */
      }
    }
  }

  html = await savePreparedPostContent(config, draftPost.id, prepared);

  const primaryKeyword = keywords[0] || contentTopic;
  const seo = await runSeoAudit({
    configId,
    title: contentTopic,
    rawHtml: html,
    auditHtml: prepared.auditHtml,
    contentFormat: prepared.format,
    contentKind: "post",
    keywords: [primaryKeyword, ...keywords, ...config.targetKeywordsList],
    phase: "phase4",
    onLog,
  });

  html = await replaceWordPressPostContent(config, draftPost.id, {
    format: prepared.format,
    html: seo.finalHtml,
    meta: prepared.storage.meta,
  });

  const slug =
    seo.slug?.trim() || titleToSlug(seo.seo_title || contentTopic) || slugBase;

  const published = await publishWordPressContent({
    config,
    contentKind: "post",
    id: draftPost.id,
    status: publishStatus,
    seo: {
      seoTitle: seo.seo_title || contentTopic,
      metaDescription: seo.meta_description,
      slug,
    },
    titleLabel: contentTopic,
    phase: "phase4",
    onLog,
  });

  const record = await prisma.blogPostRecord.create({
    data: {
      siteConfigId: configId,
      topic: contentTopic,
      keyword: primaryKeyword,
      wpPostId: draftPost.id,
      title: published.title,
      slug: published.slug,
      status: published.status,
      seoPassed: seo.validation_passed,
      requireApproval,
    },
  });

  if (config.socialEnabled && config.socialAutoGenerateOnBlog) {
    try {
      const { buildPublicPostUrl, executePhase6ForSource } = await import(
        "@/lib/phase6SocialMedia"
      );
      const sharePath =
        imagePaths.length > 0
          ? imagePaths[Math.floor(Math.random() * imagePaths.length)]
          : undefined;
      await executePhase6ForSource(
        configId,
        {
          title: published.title,
          excerpt: seo.meta_description || contentTopic,
          url: buildPublicPostUrl(config.wpUrl, published.slug),
          sourceType: "blog",
          blogPostRecordId: record.id,
          wpPostId: draftPost.id,
          shareImagePublicPath: sharePath,
        },
        onLog,
        { publishNow: true }
      );
    } catch (err) {
      log.warn(
        `Phase 6 social generation failed (blog still saved): ${err instanceof Error ? err.message : "unknown"}`,
        { phase: "phase4", pageTitle: contentTopic, pageId: draftPost.id }
      );
    }
  }

  return {
    topic: contentTopic,
    keyword: primaryKeyword,
    wpPostId: draftPost.id,
    title: published.title,
    slug: published.slug,
    status: published.status,
    seoPassed: seo.validation_passed,
    blogPostRecordId: record.id,
  };
}