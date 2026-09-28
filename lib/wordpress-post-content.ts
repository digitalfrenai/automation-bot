import type { LoadedSiteConfig } from "@/lib/config-loader";
import {
  hasGutenbergBlocks,
  normalizeGutenbergContent,
} from "@/lib/gutenberg-content";
import { normalizeContentBounds } from "@/lib/content-layout-normalize";
import { normalizePageHtml } from "@/lib/page-content-html";
import type { WordPressContentWrite } from "@/lib/wordpress-page-content";
import { wpRequest, type WpPost } from "@/lib/wordpress-client";

type ContentPayload = {
  content: string | { raw: string };
};

export type WordPressPostWrite = WordPressContentWrite;

function normalizeForWrite(write: WordPressPostWrite): string {
  if (write.format === "gutenberg") {
    return normalizeContentBounds(normalizeGutenbergContent(write.html));
  }
  if (write.format === "divi" || write.format === "elementor") {
    return write.html.trim();
  }
  return normalizeContentBounds(normalizePageHtml(write.html));
}

/**
 * Fully replaces blog post body content (avoids Gutenberg stacking on re-runs).
 */
export async function replaceWordPressPostContent(
  config: LoadedSiteConfig,
  postId: number,
  content: string | WordPressPostWrite
): Promise<string> {
  const write: WordPressPostWrite =
    typeof content === "string"
      ? {
          format: hasGutenbergBlocks(content) ? "gutenberg" : "html",
          html: content,
        }
      : content;

  const normalized = normalizeForWrite(write);
  const endpoint = `/wp-json/wp/v2/posts/${postId}?context=edit`;

  await wpRequest<WpPost>(config, endpoint, {
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
      await wpRequest<WpPost>(config, endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return normalized;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to replace WordPress post content.");
}

export async function createWordPressPost(
  config: LoadedSiteConfig,
  data: {
    title: string;
    slug?: string;
    status?: "draft" | "publish";
    content?: string;
  }
): Promise<WpPost> {
  return wpRequest<WpPost>(config, "/wp-json/wp/v2/posts?context=edit", {
    method: "POST",
    body: JSON.stringify({
      title: data.title,
      slug: data.slug,
      status: data.status ?? "draft",
      content: data.content ?? "",
    }),
  });
}
