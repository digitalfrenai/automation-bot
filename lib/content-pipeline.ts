import type { LoadedSiteConfig } from "@/lib/config-loader";
import { extractJsonObject } from "@/lib/grok-client";
import type { ContentFormat } from "@/lib/content-format";
import {
  buildElementorPage,
  elementorMetaPayload,
  elementorStorageToAuditHtml,
} from "@/lib/elementor-builder";
import { buildDiviPage, diviToAuditHtml } from "@/lib/divi-builder";
import {
  gutenbergToAuditHtml,
  hasGutenbergBlocks,
  htmlToGutenbergBlocks,
  normalizeGutenbergContent,
} from "@/lib/gutenberg-content";
import { normalizeContentBounds } from "@/lib/content-layout-normalize";
import { normalizeContentButtons } from "@/lib/content-button-normalize";
import { countChromeIssues, normalizePageHtml } from "@/lib/page-content-html";
import {
  parseStructuredPagePayload,
  type StructuredPagePayload,
} from "@/lib/page-content-structure";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import {
  replaceWordPressPageContent,
  type WordPressContentWrite,
} from "@/lib/wordpress-page-content";
import {
  replaceWordPressPostContent,
  type WordPressPostWrite,
} from "@/lib/wordpress-post-content";

export type PreparedContent = {
  format: ContentFormat;
  storage: WordPressContentWrite;
  /** For SEO audits (HTML-ish, no builder JSON). */
  auditHtml: string;
};

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:html|json)?\s*([\s\S]*?)```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function prepareContentFromGrok(
  raw: string,
  format: ContentFormat,
  onLog?: LogSink,
  context?: { pageTitle?: string; phase?: string }
): PreparedContent {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const cleaned = stripCodeFences(raw);

  if (format === "elementor") {
    let payload: StructuredPagePayload;
    try {
      payload = parseStructuredPagePayload(extractJsonObject(cleaned));
    } catch (err) {
      throw new Error(
        `Elementor mode requires JSON sections: ${err instanceof Error ? err.message : "parse failed"}`
      );
    }
    const built = buildElementorPage(payload.sections);
    log.info(
      `Built Elementor layout (${payload.sections.length} section(s)).`,
      { phase: (context?.phase as "phase2") ?? "phase2", pageTitle: context?.pageTitle }
    );
    return {
      format,
      storage: {
        format: "elementor",
        html: built.storageHtml,
        meta: elementorMetaPayload(built.elementorData),
      },
      auditHtml: elementorStorageToAuditHtml(built.storageHtml),
    };
  }

  if (format === "divi") {
    let payload: StructuredPagePayload;
    try {
      payload = parseStructuredPagePayload(extractJsonObject(cleaned));
    } catch (err) {
      throw new Error(
        `Divi mode requires JSON sections: ${err instanceof Error ? err.message : "parse failed"}`
      );
    }
    const shortcodes = buildDiviPage(payload.sections);
    log.info(`Built Divi layout (${payload.sections.length} section(s)).`, {
      phase: (context?.phase as "phase2") ?? "phase2",
      pageTitle: context?.pageTitle,
    });
    return {
      format,
      storage: { format: "divi", html: shortcodes },
      auditHtml: diviToAuditHtml(shortcodes),
    };
  }

  if (format === "gutenberg") {
    let blocks = normalizeGutenbergContent(cleaned);
    if (!hasGutenbergBlocks(blocks)) {
      log.warn(
        "Gutenberg mode: model returned plain HTML; converting to core blocks.",
        { phase: (context?.phase as "phase2") ?? "phase2", pageTitle: context?.pageTitle }
      );
      blocks = htmlToGutenbergBlocks(cleaned);
    }
    const chromeCount = countChromeIssues(cleaned);
    if (chromeCount > 0) {
      log.warn(
        `Removed or converted ${chromeCount} header/footer/nav element(s) from Gutenberg content.`,
        { phase: (context?.phase as "phase2") ?? "phase2", pageTitle: context?.pageTitle }
      );
    }
    const bounded = normalizeContentButtons(normalizeContentBounds(blocks));
    return {
      format,
      storage: { format: "gutenberg", html: bounded },
      auditHtml: gutenbergToAuditHtml(bounded),
    };
  }

  const html = normalizeContentButtons(
    normalizeContentBounds(normalizePageHtml(cleaned))
  );
  const chromeCount = countChromeIssues(cleaned);
  if (chromeCount > 0) {
    log.warn(
      `Removed or converted ${chromeCount} header/footer/nav element(s) from generated HTML.`,
      { phase: (context?.phase as "phase2") ?? "phase2", pageTitle: context?.pageTitle }
    );
  }
  return {
    format: "html",
    storage: { format: "html", html },
    auditHtml: html,
  };
}

export async function savePreparedPageContent(
  config: LoadedSiteConfig,
  pageId: number,
  prepared: PreparedContent
): Promise<string> {
  return replaceWordPressPageContent(config, pageId, prepared.storage);
}

export async function savePreparedPostContent(
  config: LoadedSiteConfig,
  postId: number,
  prepared: PreparedContent
): Promise<string> {
  const write: WordPressPostWrite = prepared.storage;
  return replaceWordPressPostContent(config, postId, write);
}

/** Re-normalize SEO output without destroying builder format. */
export function prepareSeoCorrectedContent(
  corrected: string,
  format: ContentFormat
): PreparedContent {
  const cleaned = stripCodeFences(corrected);
  if (format === "elementor") {
    try {
      const payload = parseStructuredPagePayload(extractJsonObject(cleaned));
      const built = buildElementorPage(payload.sections);
      return {
        format,
        storage: {
          format: "elementor",
          html: built.storageHtml,
          meta: elementorMetaPayload(built.elementorData),
        },
        auditHtml: elementorStorageToAuditHtml(built.storageHtml),
      };
    } catch {
      /* fall through */
    }
  }
  if (format === "divi") {
    try {
      const payload = parseStructuredPagePayload(extractJsonObject(cleaned));
      const shortcodes = buildDiviPage(payload.sections);
      return {
        format,
        storage: { format: "divi", html: shortcodes },
        auditHtml: diviToAuditHtml(shortcodes),
      };
    } catch {
      /* fall through */
    }
  }
  if (format === "gutenberg") {
    const blocks = normalizeContentButtons(
      normalizeContentBounds(
        hasGutenbergBlocks(cleaned)
          ? normalizeGutenbergContent(cleaned)
          : htmlToGutenbergBlocks(cleaned)
      )
    );
    return {
      format,
      storage: { format: "gutenberg", html: blocks },
      auditHtml: gutenbergToAuditHtml(blocks),
    };
  }
  const html = normalizeContentButtons(
    normalizeContentBounds(normalizePageHtml(cleaned))
  );
  return {
    format: "html",
    storage: { format: "html", html },
    auditHtml: html,
  };
}
