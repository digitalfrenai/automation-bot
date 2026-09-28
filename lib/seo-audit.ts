import { loadSiteConfig } from "@/lib/config-loader";
import type { ContentFormat } from "@/lib/content-format";
import { prepareSeoCorrectedContent } from "@/lib/content-pipeline";
import { createGrokClient, extractJsonObject, GROK_MODEL } from "@/lib/grok-client";
import { createGrokChatCompletion } from "@/lib/grok-request";
import { hasGutenbergBlocks, normalizeGutenbergContent } from "@/lib/gutenberg-content";
import { normalizePageHtml } from "@/lib/page-content-html";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import type { PipelinePhase, SeoValidationPayload } from "@/lib/pipeline-types";

function buildSeoSystemPrompt(
  contentKind: "page" | "post",
  contentFormat: ContentFormat
): string {
  const formatNote =
    contentFormat === "gutenberg"
      ? "- corrected_html must remain valid Gutenberg block markup (preserve <!-- wp: --> comments)."
      : contentFormat === "elementor" || contentFormat === "divi"
        ? "- Do not rewrite page builder layout in corrected_html; repeat the input unchanged unless only alt text on <img> in snapshot HTML."
        : "- Preserve existing class attributes and theme CSS classes; do not replace theme classes with inline styles.";

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
  "corrected_html": "full corrected content if fixes needed, otherwise repeat input HTML",
  "simple_fixes_applied": ["short description of each auto-fix"]
}
Rules:
- seo_title max 60 characters — for SEO plugins and browser tabs ONLY; never copy seo_title verbatim into visible H1/H2 text.
- Visible H1 must be a short marketing headline (no pipe-separated keyword lists like "Brand | Service | City").
- meta_description max 160 characters.
- Ensure exactly one H1 and logical H2/H3 hierarchy when validation_passed is false.
- Ensure every <img> has meaningful alt text in corrected_html when applicable.
- Keep corrected_html concise: only fix heading hierarchy/H1/alt/link issues; do not rewrite the entire piece or add new sections.
${formatNote}
- No markdown, no prose outside JSON.`;
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

function parseSeoPayload(text: string): SeoValidationPayload & {
  simple_fixes_applied?: string[];
} {
  const jsonText = extractJsonObject(text);
  const parsed = JSON.parse(jsonText) as SeoValidationPayload & {
    simple_fixes_applied?: string[];
  };

  if (
    typeof parsed.seo_title !== "string" ||
    typeof parsed.meta_description !== "string" ||
    typeof parsed.slug !== "string" ||
    typeof parsed.corrected_html !== "string" ||
    typeof parsed.validation_passed !== "boolean"
  ) {
    throw new Error("Grok SEO response missing required fields.");
  }

  return parsed;
}

function normalizeStorageHtml(html: string, format: ContentFormat): string {
  if (format === "gutenberg") {
    return normalizeGutenbergContent(html);
  }
  if (format === "divi" || format === "elementor") {
    return html.trim();
  }
  return normalizePageHtml(html);
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

  const seo = parseSeoPayload(content);
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
