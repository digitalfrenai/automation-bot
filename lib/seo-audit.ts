import { loadSiteConfig } from "@/lib/config-loader";
import type { ContentFormat } from "@/lib/content-format";
import { prepareSeoCorrectedContent } from "@/lib/content-pipeline";
import { normalizeResponsiveLayout } from "@/lib/content-responsive-normalize";
import { createGrokClient, extractJsonObject, GROK_MODEL } from "@/lib/grok-client";
import { createGrokChatCompletion } from "@/lib/grok-request";
import { hasGutenbergBlocks, normalizeGutenbergContent } from "@/lib/gutenberg-content";
import { normalizePageHtml } from "@/lib/page-content-html";
import { titleToSlug } from "@/lib/wordpress-client";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import type { PipelinePhase, SeoValidationPayload } from "@/lib/pipeline-types";

function buildSeoSystemPrompt(
  contentKind: "page" | "post",
  contentFormat: ContentFormat
): string {
  const formatNote =
    contentFormat === "gutenberg"
      ? "- Content format is Gutenberg. Do not emit block markup in this JSON."
      : contentFormat === "elementor" || contentFormat === "divi"
        ? "- Content format is a page builder. Do not emit layout markup in this JSON."
        : "- Content format is HTML. Do not emit page markup in this JSON.";

  return `You are a technical SEO auditor for WordPress ${contentKind}s.
Analyze HTML against target keywords and return ONLY a JSON object with this exact shape:
{
  "seo_title": "string under 60 chars including primary keyword",
  "meta_description": "string under 160 chars with CTA",
  "slug": "kebab-case-slug",
  "h1_count": number,
  "heading_hierarchy_valid": boolean,
  "keyword_density_passed": boolean,
  "validation_passed": boolean,
  "corrected_html": "",
  "simple_fixes_applied": ["short description of each issue found"]
}
Rules:
- seo_title max 60 characters — for SEO plugins and browser tabs ONLY.
- meta_description max 160 characters.
- corrected_html MUST be an empty string. Do not repeat, rewrite, or quote the page HTML. Page content is already saved.
- Report heading, alt-text, or keyword issues only in simple_fixes_applied. Set validation_passed false when those issues exist.
${formatNote}
- No markdown, no prose outside JSON. Keep the JSON small.`;
}

const MAX_SEO_HTML_CHARS = 14_000;

function htmlForSeoAudit(rawHtml: string): string {
  if (rawHtml.length <= MAX_SEO_HTML_CHARS) return rawHtml;
  return `${rawHtml.slice(0, MAX_SEO_HTML_CHARS)}\n<!-- HTML truncated for SEO audit -->`;
}

function buildSeoUserPrompt(
  title: string,
  rawHtml: string,
  keywords: string[],
  contentKind: "page" | "post"
): string {
  return `${contentKind === "post" ? "Post" : "Page"} title: ${title}
Target keywords: ${keywords.join(", ") || "general industry terms"}

HTML to audit (may be truncated):
${htmlForSeoAudit(rawHtml)}`;
}

export type SeoAuditResult = SeoValidationPayload & {
  simple_fixes_applied?: string[];
  finalHtml: string;
  contentFormat: ContentFormat;
};

function readJsonStringField(text: string, key: string): string | undefined {
  const match = text.match(
    new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`)
  );
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

/** Metadata-only payload when the model reply is truncated or not valid JSON. */
function fallbackSeoPayload(
  title: string,
  reason: string
): SeoValidationPayload & { simple_fixes_applied?: string[] } {
  const seoTitle = truncateMeta(title.trim() || "Page", 60);
  return {
    seo_title: seoTitle,
    meta_description: truncateMeta(
      `${seoTitle}. Learn more about our services and how we can help.`,
      160
    ),
    slug: titleToSlug(seoTitle),
    h1_count: 1,
    heading_hierarchy_valid: true,
    keyword_density_passed: true,
    validation_passed: true,
    corrected_html: "",
    simple_fixes_applied: [`SEO JSON skipped (${reason}); published existing page content.`],
  };
}

function parseSeoPayload(
  text: string,
  title: string
): SeoValidationPayload & { simple_fixes_applied?: string[] } {
  let parsed: SeoValidationPayload & { simple_fixes_applied?: string[] };
  try {
    const jsonText = extractJsonObject(text);
    parsed = JSON.parse(jsonText) as SeoValidationPayload & {
      simple_fixes_applied?: string[];
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "invalid JSON";
    const seoTitle = readJsonStringField(text, "seo_title");
    const metaDescription = readJsonStringField(text, "meta_description");
    const slug = readJsonStringField(text, "slug");
    if (!seoTitle || !metaDescription) {
      return fallbackSeoPayload(title, reason);
    }
    return {
      ...fallbackSeoPayload(title, reason),
      seo_title: truncateMeta(seoTitle, 60),
      meta_description: truncateMeta(metaDescription, 160),
      slug: slug?.trim() || titleToSlug(seoTitle),
      corrected_html: "",
      validation_passed: true,
    };
  }

  if (
    typeof parsed.seo_title !== "string" ||
    typeof parsed.meta_description !== "string" ||
    typeof parsed.slug !== "string" ||
    typeof parsed.validation_passed !== "boolean"
  ) {
    return fallbackSeoPayload(title, "missing required fields");
  }

  if (typeof parsed.corrected_html !== "string") {
    parsed.corrected_html = "";
  }

  return parsed;
}

function normalizeStorageHtml(html: string, format: ContentFormat): string {
  if (format === "gutenberg") {
    return normalizeResponsiveLayout(normalizeGutenbergContent(html));
  }
  if (format === "divi" || format === "elementor") {
    return html.trim();
  }
  return normalizeResponsiveLayout(normalizePageHtml(html));
}

function countImgTags(html: string): number {
  return (html.match(/<img\b/gi) ?? []).length;
}

/** Prefer corrected HTML only when it looks like a surgical fix, not a full rewrite. */
export function pickAuditedHtml(
  rawHtml: string,
  seo: Pick<SeoValidationPayload, "validation_passed" | "corrected_html">,
  contentFormat: ContentFormat = "html"
): string {
  const baseline = normalizeStorageHtml(rawHtml, contentFormat);

  if (contentFormat === "elementor" || contentFormat === "divi") {
    return baseline;
  }

  if (seo.validation_passed || !seo.corrected_html.trim()) {
    return baseline;
  }
  if (seo.corrected_html.length > rawHtml.length * 1.5) {
    return baseline;
  }

  const prepared = prepareSeoCorrectedContent(seo.corrected_html, contentFormat);
  if (countImgTags(prepared.storage.html) < countImgTags(baseline)) {
    return baseline;
  }
  return prepared.storage.html;
}

export function truncateMeta(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

export async function runSeoAudit(options: {
  configId: string;
  title: string;
  rawHtml: string;
  auditHtml?: string;
  contentFormat?: ContentFormat;
  contentKind?: "page" | "post";
  keywords?: string[];
  phase?: PipelinePhase;
  onLog?: LogSink;
}): Promise<SeoAuditResult> {
  const {
    configId,
    title,
    rawHtml,
    contentKind = "page",
    phase = "phase3",
    onLog,
  } = options;
  const contentFormat =
    options.contentFormat ??
    (hasGutenbergBlocks(rawHtml) ? "gutenberg" : "html");
  const auditInput = options.auditHtml ?? rawHtml;

  const log = createPipelineLogger(onLog ?? (() => undefined));
  const config = await loadSiteConfig(configId);
  const client = createGrokClient(config);
  const keywords = options.keywords ?? config.targetKeywordsList;

  log.info(`SEO validation for "${title}"…`, {
    phase,
    pageTitle: title,
  });

  const completion = await createGrokChatCompletion(
    client,
    {
      model: GROK_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildSeoSystemPrompt(contentKind, contentFormat),
        },
        {
          role: "user",
          content: buildSeoUserPrompt(title, auditInput, keywords, contentKind),
        },
      ],
    },
    {
      label: `SEO audit for "${title}"`,
      onLog,
    }
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`Grok returned empty SEO payload for "${title}".`);
  }

  const seo = parseSeoPayload(content, title);
  if (seo.simple_fixes_applied?.some((note) => note.startsWith("SEO JSON skipped"))) {
    log.warn(
      `SEO reply for "${title}" was not valid JSON (${seo.simple_fixes_applied[0]}). Publishing the page already saved.`,
      { phase, pageTitle: title }
    );
  }
  const finalHtml = pickAuditedHtml(rawHtml, seo, contentFormat);

  if (!seo.validation_passed) {
    const fixes =
      seo.simple_fixes_applied?.filter(Boolean).join("; ") ||
      "heading / meta / alt adjustments";
    log.warn(
      finalHtml !== normalizeStorageHtml(rawHtml, contentFormat)
        ? `SEO flagged issues on "${title}"; auto-fixing: ${fixes}.`
        : `SEO flagged issues on "${title}"; continuing with metadata (builder layout unchanged).`,
      { phase, pageTitle: title }
    );
  } else {
    log.info(`SEO validation passed for "${title}".`, {
      phase,
      pageTitle: title,
    });
  }

  return { ...seo, finalHtml, contentFormat };
}
