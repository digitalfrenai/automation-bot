import { loadSiteConfig } from "@/lib/config-loader";
import { createGrokClient, extractJsonObject, GROK_MODEL } from "@/lib/grok-client";
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
import type { BlogTopic, Phase4PostResult } from "@/lib/pipeline-types";
import { prisma } from "@/lib/prisma";
import { runSeoAudit } from "@/lib/seo-audit";
import { titleToSlug } from "@/lib/wordpress-client";
import {
  assignPostCategory,
  assignPostTags,
  listPostCategories,
  listPostTags,
} from "@/lib/blog-category";
import { assignBlogTitleBanner } from "@/lib/blog-title-banner";
import {
  createWordPressPost,
  replaceWordPressPostContent,
} from "@/lib/wordpress-post-content";
import { publishWordPressContent } from "@/lib/wordpress-publisher";

function buildTopicSystemPrompt(): string {
  return `You are an SEO content strategist for a business blog.
Return ONLY a JSON object:
{
  "topics": [
    { "topic": "compelling blog topic title", "keyword": "primary keyword phrase", "angle": "1-sentence angle", "category": "Short Category Name", "tags": ["specific tag", "another tag", "third tag"] }
  ]
}
Rules:
- Topics must be specific to the business niche and services.
- Prefer searchable, intent-driven topics (how-to, comparison, guide, FAQ-style).
- Keywords should be natural search phrases, not single generic words.
- category is the WordPress category for that post: 2–4 words, title case, reusable across similar posts.
- Reuse a category from the supplied existing list when it fits. Do not use Uncategorized.
- tags is 3 to 5 short WordPress tags for that post (1–3 words each). Reuse supplied existing tags when they fit. Tags are more specific than the category and must not all be copies of the category name.
- No markdown, no prose outside JSON.`;
}

function buildTopicUserPrompt(
  count: number,
  brief: {
    businessName: string;
    niche: string;
    targetAudience: string;
    coreServices: string[];
    targetKeywords: string[];
  },
  existingCategories: string[],
  existingTags: string[]
): string {
  const categoryLine = existingCategories.length
    ? `Existing categories (reuse when the topic fits): ${existingCategories.join(", ")}`
    : "No categories exist yet. Create a short reusable category for each topic.";
  const tagLine = existingTags.length
    ? `Existing tags (reuse when they fit): ${existingTags.slice(0, 40).join(", ")}`
    : "No tags exist yet. Create 3–5 specific tags for each topic.";
  return `Generate ${count} unique blog topics for ${brief.businessName}.

Niche: ${brief.niche}
Audience: ${brief.targetAudience}
Services: ${brief.coreServices.join(", ") || "N/A"}
Seed keywords: ${brief.targetKeywords.join(", ") || "N/A"}
${categoryLine}
${tagLine}`;
}

function buildBlogUserPrompt(
  topic: BlogTopic,
  brief: {
    businessName: string;
    niche: string;
    targetAudience: string;
    toneOfVoice: string;
    coreServices: string[];
    targetKeywords: string[];
  }
): string {
  return `Write a complete blog post.

Topic: ${topic.topic}
Primary keyword: ${topic.keyword}
Angle: ${topic.angle}

Business: ${brief.businessName}
Niche: ${brief.niche}
Audience: ${brief.targetAudience}
Tone: ${brief.toneOfVoice}
Services: ${brief.coreServices.join(", ") || "N/A"}
Related keywords: ${brief.targetKeywords.join(", ") || "N/A"}

Use article-style layout inside the theme content width (no full-bleed heroes or viewport breakout CSS). Headings, links, and image alt text.`;
}

function parseTopics(text: string, limit: number): BlogTopic[] {
  const jsonText = extractJsonObject(text);
  const parsed = JSON.parse(jsonText) as { topics?: BlogTopic[] };
  if (!Array.isArray(parsed.topics) || parsed.topics.length === 0) {
    throw new Error("Grok returned no blog topics.");
  }

  return parsed.topics
    .filter(
      (t) =>
        typeof t?.topic === "string" &&
        typeof t?.keyword === "string" &&
        t.topic.trim() &&
        t.keyword.trim()
    )
    .slice(0, limit)
    .map((t) => {
      const keyword = t.keyword.trim();
      const topic = t.topic.trim();
      const fromModel = typeof t.category === "string" ? t.category.trim() : "";
      const category =
        fromModel && fromModel.toLowerCase() !== "uncategorized"
          ? fromModel
          : keyword.split(/\s+/).slice(0, 3).join(" ") ||
            topic.split(/\s+/).slice(0, 3).join(" ");
      const rawTags = Array.isArray(t.tags) ? t.tags : [];
      const tags = rawTags
        .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
        .map((tag) => tag.trim())
        .slice(0, 5);
      return {
        topic,
        keyword,
        angle: typeof t.angle === "string" ? t.angle.trim() : "",
        category,
        tags: tags.length > 0 ? tags : [keyword, category].filter(Boolean).slice(0, 3),
      };
    });
}

export async function generateBlogTopics(
  configId: string,
  count: number,
  onLog?: LogSink,
  existingCategories: string[] = [],
  existingTags: string[] = []
): Promise<BlogTopic[]> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const config = await loadSiteConfig(configId);
  const client = createGrokClient(config);
  const n = Math.max(1, Math.min(count, 10));

  log.info(`Phase 4: generating ${n} blog topic(s)…`, { phase: "phase4" });

  const completion = await createGrokChatCompletion(
    client,
    {
      model: GROK_MODEL,
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildTopicSystemPrompt() },
        {
          role: "user",
          content: buildTopicUserPrompt(
            n,
            {
              businessName: config.businessName,
              niche: config.niche,
              targetAudience: config.targetAudience,
              coreServices: config.coreServicesList,
              targetKeywords: config.targetKeywordsList,
            },
            existingCategories,
            existingTags
          ),
        },
      ],
    },
    { label: "Phase 4 topic generation", onLog }
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Grok returned empty topic list.");
  }

  const topics = parseTopics(content, n);
  for (const topic of topics) {
    log.info(
      `Topic: "${topic.topic}" (keyword: ${topic.keyword}, category: ${topic.category}, tags: ${topic.tags.join(", ")})`,
      {
        phase: "phase4",
        pageTitle: topic.topic,
      }
    );
  }
  return topics;
}

export async function generateAndPublishBlogPost(
  configId: string,
  topic: BlogTopic,
  onLog?: LogSink
): Promise<Phase4PostResult> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const config = await loadSiteConfig(configId);
  const client = createGrokClient(config);
  const requireApproval = config.blogRequireApproval;
  const publishStatus = requireApproval ? "draft" : "publish";
  const genCtx = await loadGenerationContext(config, onLog);

  log.info(
    `Phase 4: writing ${formatLabel(genCtx.format)} blog post for "${topic.topic}"…`,
    {
      phase: "phase4",
      pageTitle: topic.topic,
    }
  );

  const completion = await createGrokChatCompletion(
    client,
    {
      model: GROK_MODEL,
      temperature: 0.7,
      ...(grokUsesJsonObject(genCtx.format)
        ? { response_format: { type: "json_object" as const } }
        : {}),
      messages: [
        {
          role: "system",
          content: buildBlogSystemPrompt(
            genCtx.format,
            genCtx.themeGuide,
            config.blogIncludeExternalLinks
          ),
        },
        {
          role: "user",
          content: buildBlogUserPrompt(topic, {
            businessName: config.businessName,
            niche: config.niche,
            targetAudience: config.targetAudience,
            toneOfVoice: config.toneOfVoice,
            coreServices: config.coreServicesList,
            targetKeywords: config.targetKeywordsList,
          }),
        },
      ],
    },
    { label: `Phase 4 blog for "${topic.topic}"`, onLog }
  );

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error(`Grok returned empty content for topic "${topic.topic}".`);
  }

  const prepared = prepareContentFromGrok(raw, genCtx.format, onLog, {
    pageTitle: topic.topic,
    phase: "phase4",
  });

  const draftPost = await createWordPressPost(config, {
    title: topic.topic,
    slug: titleToSlug(topic.topic),
    status: "draft",
    content: "",
  });

  await assignPostCategory(config, draftPost.id, topic.category, onLog);
  await assignPostTags(config, draftPost.id, topic.tags, onLog);

  let html = await savePreparedPostContent(config, draftPost.id, prepared);

  const seo = await runSeoAudit({
    configId,
    title: topic.topic,
    rawHtml: html,
    auditHtml: prepared.auditHtml,
    contentFormat: prepared.format,
    contentKind: "post",
    keywords: [topic.keyword, ...config.targetKeywordsList],
    phase: "phase4",
    onLog,
  });

  html = await replaceWordPressPostContent(config, draftPost.id, {
    format: prepared.format,
    html: seo.finalHtml,
    meta: prepared.storage.meta,
  });

  const slug =
    seo.slug?.trim() || titleToSlug(seo.seo_title || topic.topic) || titleToSlug(topic.topic);

  const published = await publishWordPressContent({
    config,
    contentKind: "post",
    id: draftPost.id,
    status: publishStatus,
    seo: {
      seoTitle: seo.seo_title || topic.topic,
      metaDescription: seo.meta_description,
      slug,
    },
    titleLabel: topic.topic,
    phase: "phase4",
    onLog,
  });

  if (requireApproval) {
    log.info(
      `Saved as WordPress draft for human approval (post ${draftPost.id}).`,
      { phase: "phase4", pageTitle: topic.topic, pageId: draftPost.id }
    );
  }

  try {
    await assignBlogTitleBanner(config, draftPost.id, topic, onLog);
  } catch (err) {
    log.warn(
      `Blog title background skipped: ${err instanceof Error ? err.message : "image generation failed"}`,
      { phase: "phase4", pageTitle: topic.topic, pageId: draftPost.id }
    );
  }

  const record = await prisma.blogPostRecord.create({
    data: {
      siteConfigId: configId,
      topic: topic.topic,
      keyword: topic.keyword,
      wpPostId: draftPost.id,
      title: published.title,
      slug: published.slug,
      status: published.status,
      seoPassed: seo.validation_passed,
      requireApproval,
    },
  });

  log.info(
    `SEO summary — H1: ${seo.h1_count}, hierarchy: ${seo.heading_hierarchy_valid}, keywords: ${seo.keyword_density_passed}`,
    { phase: "phase4", pageTitle: topic.topic, pageId: draftPost.id }
  );

  // Optional Phase 6 hook — only when socialEnabled (default false keeps prior flow).
  if (config.socialEnabled && config.socialAutoGenerateOnBlog) {
    try {
      const { buildPublicPostUrl, executePhase6ForSource } = await import(
        "@/lib/phase6SocialMedia"
      );
      await executePhase6ForSource(
        configId,
        {
          title: published.title,
          excerpt: `${topic.topic}. Keyword: ${topic.keyword}. ${seo.meta_description}`,
          url: buildPublicPostUrl(config.wpUrl, published.slug),
          sourceType: "blog",
          blogPostRecordId: record.id,
          wpPostId: draftPost.id,
        },
        onLog
      );
    } catch (err) {
      log.warn(
        `Phase 6 social generation failed (blog still saved): ${err instanceof Error ? err.message : "unknown error"}`,
        { phase: "phase4", pageTitle: topic.topic, pageId: draftPost.id }
      );
    }
  }

  return {
    topic: topic.topic,
    keyword: topic.keyword,
    wpPostId: draftPost.id,
    title: published.title,
    slug: published.slug,
    status: published.status,
    seoPassed: seo.validation_passed,
    blogPostRecordId: record.id,
  };
}

/**
 * Full Phase 4 workflow: Topic/Keyword → Grok → Blog → SEO → Auto-Fix → Publish/Draft
 */
export async function executePhase4(
  configId: string,
  onLog?: LogSink,
  options?: { topicCount?: number }
): Promise<Phase4PostResult[]> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const config = await loadSiteConfig(configId);
  const count = options?.topicCount ?? config.blogPostsPerRun;

  log.info(
    `Phase 4 started — ${count} post(s), approval=${config.blogRequireApproval ? "draft" : "auto-publish"}.`,
    { phase: "phase4" }
  );

  let categoryNames: string[] = [];
  let tagNames: string[] = [];
  try {
    categoryNames = (await listPostCategories(config)).map((category) => category.name);
  } catch (err) {
    log.warn(
      `Could not read existing categories: ${err instanceof Error ? err.message : "lookup failed"}`,
      { phase: "phase4" }
    );
  }
  try {
    tagNames = (await listPostTags(config)).map((tag) => tag.name);
  } catch (err) {
    log.warn(
      `Could not read existing tags: ${err instanceof Error ? err.message : "lookup failed"}`,
      { phase: "phase4" }
    );
  }

  const topics = await generateBlogTopics(
    configId,
    count,
    onLog,
    categoryNames,
    tagNames
  );
  const results: Phase4PostResult[] = [];

  for (const topic of topics) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = await generateAndPublishBlogPost(configId, topic, onLog);
    results.push(result);
  }

  log.info(
    `Phase 4 complete — ${results.length} post(s) processed (${results.filter((r) => r.status === "publish").length} published, ${results.filter((r) => r.status === "draft").length} draft).`,
    { phase: "phase4" }
  );

  return results;
}
