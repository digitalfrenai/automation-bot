import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { ContentFormat } from "@/lib/content-format";
import {
  hasGutenbergBlocks,
  normalizeGutenbergContent,
} from "@/lib/gutenberg-content";
import { normalizeContentBounds } from "@/lib/content-layout-normalize";
import { normalizePageHtml } from "@/lib/page-content-html";
import { wpRequest, type WpPage } from "@/lib/wordpress-client";

type ContentPayload = {
  content: string | { raw: string };
};

export type WordPressContentWrite = {
  format: ContentFormat;
  html: string;
  meta?: Record<string, string>;
};

function normalizeForWrite(write: WordPressContentWrite): string {
  const gutenbergStorage =
    write.format === "gutenberg" || hasGutenbergBlocks(write.html);
  if (gutenbergStorage) {
    return normalizeContentBounds(normalizeGutenbergContent(write.html));
  }
  if (write.format === "divi" || write.format === "elementor") {
    return write.html.trim();
  }
  return normalizeContentBounds(normalizePageHtml(write.html));
}

/**
 * Fully replaces page body content (avoids Gutenberg appending another HTML block on re-runs).
 */
export async function replaceWordPressPageContent(
  config: LoadedSiteConfig,
  pageId: number,
  content: string | WordPressContentWrite
): Promise<string> {
  const write: WordPressContentWrite =
    typeof content === "string"
      ? {
          format: hasGutenbergBlocks(content) ? "gutenberg" : "html",
          html: content,
        }
      : {
          ...content,
          format:
            content.format === "html" && hasGutenbergBlocks(content.html)
              ? "gutenberg"
              : content.format,
        };

  const normalized = normalizeForWrite(write);
  const endpoint = `/wp-json/wp/v2/pages/${pageId}?context=edit`;

  await wpRequest<WpPage>(config, endpoint, {
    method: "POST",
    body: JSON.stringify({ content: "" } satisfies ContentPayload),
  });

  const bodyWithMeta: Record<string, unknown> = {
    content: { raw: normalized },
  };
  if (write.meta && Object.keys(write.meta).length > 0) {
    bodyWithMeta.meta = write.meta;
  }

  const payloads: Record<string, unknown>[] = [
    bodyWithMeta,
    { content: normalized, ...(write.meta ? { meta: write.meta } : {}) },
    { content: { raw: normalized } },
    { content: normalized },
  ];

  let lastError: unknown;

  for (const payload of payloads) {
    try {
      await wpRequest<WpPage>(config, endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return normalized;
    } catch (err) {
      lastError = err;
    }
  }

  if (write.meta) {
    try {
      await wpRequest<WpPage>(config, endpoint, {
        method: "POST",
        body: JSON.stringify({ content: { raw: normalized } }),
      });
      return normalized;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to replace WordPress page content.");
}
