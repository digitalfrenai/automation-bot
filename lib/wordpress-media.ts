import type { LoadedSiteConfig } from "@/lib/config-loader";
import {
  getWpAuthHeader,
  normalizeWpUrl,
  WordPressApiError,
} from "@/lib/wordpress-client";

export type WpMediaItem = {
  id: number;
  source_url: string;
  alt_text?: string;
  title?: { rendered?: string };
};

function extensionForMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "png";
}

export async function uploadWordPressMedia(
  config: LoadedSiteConfig,
  file: Buffer,
  options: {
    filenameBase: string;
    mimeType: string;
    title?: string;
    altText?: string;
    caption?: string;
  }
): Promise<WpMediaItem> {
  const base = normalizeWpUrl(config.wpUrl);
  const ext = extensionForMime(options.mimeType);
  const filename = `${options.filenameBase.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-")}.${ext}`;

  const form = new FormData();
  const bytes = Uint8Array.from(file);
  form.append(
    "file",
    new Blob([bytes], { type: options.mimeType }),
    filename
  );
  if (options.title?.trim()) {
    form.append("title", options.title.trim());
  }
  if (options.caption?.trim()) {
    form.append("caption", options.caption.trim());
  }
  if (options.altText?.trim()) {
    form.append("alt_text", options.altText.trim());
  }

  const response = await fetch(`${base}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: getWpAuthHeader(config.wpUsername, config.wpAppPassword),
      Accept: "application/json",
    },
    body: form,
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new WordPressApiError(
      `WordPress media upload ${response.status}`,
      response.status,
      text.slice(0, 500)
    );
  }

  const parsed = JSON.parse(text) as WpMediaItem;
  if (!parsed.id || !parsed.source_url) {
    throw new WordPressApiError(
      "WordPress media upload returned invalid payload",
      response.status,
      text.slice(0, 200)
    );
  }

  if (options.altText?.trim() && !parsed.alt_text) {
    try {
      await fetch(`${base}/wp-json/wp/v2/media/${parsed.id}`, {
        method: "POST",
        headers: {
          Authorization: getWpAuthHeader(config.wpUsername, config.wpAppPassword),
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ alt_text: options.altText.trim() }),
        cache: "no-store",
      });
    } catch {
      /* alt on create is best-effort */
    }
  }

  return parsed;
}

export async function uploadWordPressMediaFromUrl(
  config: LoadedSiteConfig,
  imageUrl: string,
  options: {
    filenameBase: string;
    altText?: string;
    title?: string;
  }
): Promise<WpMediaItem> {
  const response = await fetch(imageUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new WordPressApiError(
      `Could not fetch image ${response.status}`,
      response.status,
      imageUrl
    );
  }
  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 500) {
    throw new WordPressApiError(
      "Fetched image was too small",
      response.status,
      imageUrl
    );
  }
  return uploadWordPressMedia(config, buffer, {
    filenameBase: options.filenameBase,
    mimeType,
    title: options.title,
    altText: options.altText,
  });
}

export async function setPageFeaturedMedia(
  config: LoadedSiteConfig,
  pageId: number,
  mediaId: number
): Promise<void> {
  const base = normalizeWpUrl(config.wpUrl);
  const response = await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, {
    method: "POST",
    headers: {
      Authorization: getWpAuthHeader(config.wpUsername, config.wpAppPassword),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ featured_media: mediaId }),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new WordPressApiError(
      `WordPress featured_media ${response.status}`,
      response.status,
      text.slice(0, 500)
    );
  }
}
