import type { LoadedSiteConfig } from "@/lib/config-loader";
import { parseStringArray } from "@/lib/site-config";

export type SocialPlatform = "x" | "linkedin" | "facebook" | "instagram";

export const ALL_SOCIAL_PLATFORMS: SocialPlatform[] = [
  "x",
  "linkedin",
  "facebook",
  "instagram",
];

export type SocialPublishOptions = {
  imageUrl?: string;
  linkUrl?: string;
};

export function parseSocialPlatforms(value: unknown): SocialPlatform[] {
  const raw = parseStringArray(value).map((p) => p.toLowerCase());
  const allowed = new Set<string>(ALL_SOCIAL_PLATFORMS);
  const filtered = raw.filter((p): p is SocialPlatform => allowed.has(p));
  return filtered.length > 0 ? filtered : [...ALL_SOCIAL_PLATFORMS];
}

export type SocialPublishResult = {
  ok: boolean;
  externalPostId?: string;
  error?: string;
  skipped?: boolean;
};

/**
 * Platform adapters. Without tokens, posts stay prepared/scheduled locally (no remote call).
 */
export async function publishToSocialPlatform(
  config: LoadedSiteConfig,
  platform: SocialPlatform,
  caption: string,
  hashtags: string[],
  options?: SocialPublishOptions
): Promise<SocialPublishResult> {
  const text = composePostText(caption, hashtags, platform);

  switch (platform) {
    case "x":
      return publishToX(config.socialXAccessToken, text, options?.imageUrl);
    case "linkedin":
      return publishToLinkedIn(
        config.socialLinkedInAccessToken,
        config.socialLinkedInAuthorUrn,
        text,
        options
      );
    case "facebook":
      return publishToFacebook(
        config.socialFacebookPageToken,
        config.socialFacebookPageId,
        text,
        options?.imageUrl
      );
    case "instagram":
      return publishToInstagram(
        config.socialFacebookPageToken,
        config.socialInstagramAccountId,
        text,
        options?.imageUrl
      );
    default:
      return { ok: false, error: `Unsupported platform: ${platform}` };
  }
}

function composePostText(
  caption: string,
  hashtags: string[],
  platform: SocialPlatform
): string {
  const tags = hashtags
    .map((h) => (h.startsWith("#") ? h : `#${h.replace(/\s+/g, "")}`))
    .join(" ");
  const max =
    platform === "x" ? 280 : platform === "instagram" ? 2200 : 3000;
  const base = tags ? `${caption.trim()}\n\n${tags}` : caption.trim();
  if (base.length <= max) return base;
  return `${base.slice(0, max - 1).trim()}…`;
}

async function downloadImageBuffer(imageUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(imageUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function publishToX(
  token: string | null | undefined,
  text: string,
  imageUrl?: string
): Promise<SocialPublishResult> {
  if (!token?.trim()) {
    return {
      ok: false,
      skipped: true,
      error: "X access token not configured — content prepared only.",
    };
  }

  let mediaIds: string[] | undefined;
  if (imageUrl?.trim()) {
    const buffer = await downloadImageBuffer(imageUrl.trim());
    if (buffer) {
      const form = new FormData();
      const bytes = Uint8Array.from(buffer);
      form.append(
        "media",
        new Blob([bytes], { type: "image/jpeg" }),
        "share.jpg"
      );
      try {
        const upload = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
          method: "POST",
          headers: { Authorization: `Bearer ${token.trim()}` },
          body: form,
        });
        const uploadBody = await upload.text();
        if (upload.ok) {
          const json = JSON.parse(uploadBody) as { media_id_string?: string };
          if (json.media_id_string) mediaIds = [json.media_id_string];
        }
      } catch {
        /* tweet without media */
      }
    }
  }

  try {
    const body: Record<string, unknown> = { text };
    if (mediaIds?.length) {
      body.media = { media_ids: mediaIds };
    }
    const res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const resBody = await res.text();
    if (!res.ok) {
      return { ok: false, error: `X API ${res.status}: ${resBody.slice(0, 200)}` };
    }
    const json = JSON.parse(resBody) as { data?: { id?: string } };
    return { ok: true, externalPostId: json.data?.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "X publish failed.",
    };
  }
}

async function publishToLinkedIn(
  token: string | null | undefined,
  authorUrn: string | null | undefined,
  text: string,
  options?: SocialPublishOptions
): Promise<SocialPublishResult> {
  if (!token?.trim() || !authorUrn?.trim()) {
    return {
      ok: false,
      skipped: true,
      error:
        "LinkedIn token/author URN not configured — content prepared only.",
    };
  }

  const link = options?.linkUrl?.trim();
  const imageUrl = options?.imageUrl?.trim();
  const shareContent: Record<string, unknown> = link
    ? {
        shareCommentary: { text },
        shareMediaCategory: "ARTICLE",
        media: [
          {
            status: "READY",
            originalUrl: link,
            ...(imageUrl ? { thumbnails: [{ url: imageUrl }] } : {}),
          },
        ],
      }
    : {
        shareCommentary: { text },
        shareMediaCategory: "NONE",
      };

  try {
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: authorUrn.trim(),
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": shareContent,
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `LinkedIn API ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const id = res.headers.get("x-restli-id") || undefined;
    return { ok: true, externalPostId: id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "LinkedIn publish failed.",
    };
  }
}

async function publishToFacebook(
  pageToken: string | null | undefined,
  pageId: string | null | undefined,
  text: string,
  imageUrl?: string
): Promise<SocialPublishResult> {
  if (!pageToken?.trim() || !pageId?.trim()) {
    return {
      ok: false,
      skipped: true,
      error: "Facebook page token/ID not configured — content prepared only.",
    };
  }

  try {
    if (imageUrl?.trim()) {
      const url = new URL(
        `https://graph.facebook.com/v19.0/${pageId.trim()}/photos`
      );
      url.searchParams.set("url", imageUrl.trim());
      url.searchParams.set("caption", text);
      url.searchParams.set("access_token", pageToken.trim());
      const res = await fetch(url.toString(), { method: "POST" });
      const body = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          error: `Facebook API ${res.status}: ${body.slice(0, 200)}`,
        };
      }
      const json = JSON.parse(body) as { id?: string; post_id?: string };
      return { ok: true, externalPostId: json.post_id ?? json.id };
    }

    const url = new URL(`https://graph.facebook.com/v19.0/${pageId.trim()}/feed`);
    url.searchParams.set("message", text);
    url.searchParams.set("access_token", pageToken.trim());
    const res = await fetch(url.toString(), { method: "POST" });
    const body = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `Facebook API ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const json = JSON.parse(body) as { id?: string };
    return { ok: true, externalPostId: json.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Facebook publish failed.",
    };
  }
}

async function publishToInstagram(
  pageToken: string | null | undefined,
  igAccountId: string | null | undefined,
  text: string,
  imageUrl?: string
): Promise<SocialPublishResult> {
  if (!pageToken?.trim() || !igAccountId?.trim()) {
    return {
      ok: false,
      skipped: true,
      error:
        "Instagram account/token not configured — caption prepared only (image required to publish).",
    };
  }

  if (!imageUrl?.trim()) {
    return {
      ok: false,
      skipped: true,
      error:
        "Instagram publish needs the blog share image — generate social posts after the blog featured image exists.",
    };
  }

  try {
    const createUrl = new URL(
      `https://graph.facebook.com/v19.0/${igAccountId.trim()}/media`
    );
    createUrl.searchParams.set("image_url", imageUrl.trim());
    createUrl.searchParams.set("caption", text);
    createUrl.searchParams.set("access_token", pageToken.trim());
    const createRes = await fetch(createUrl.toString(), { method: "POST" });
    const createBody = await createRes.text();
    if (!createRes.ok) {
      return {
        ok: false,
        error: `Instagram media ${createRes.status}: ${createBody.slice(0, 200)}`,
      };
    }
    const created = JSON.parse(createBody) as { id?: string };
    if (!created.id) {
      return { ok: false, error: "Instagram media container missing id." };
    }

    const publishUrl = new URL(
      `https://graph.facebook.com/v19.0/${igAccountId.trim()}/media_publish`
    );
    publishUrl.searchParams.set("creation_id", created.id);
    publishUrl.searchParams.set("access_token", pageToken.trim());
    const publishRes = await fetch(publishUrl.toString(), { method: "POST" });
    const publishBody = await publishRes.text();
    if (!publishRes.ok) {
      return {
        ok: false,
        error: `Instagram publish ${publishRes.status}: ${publishBody.slice(0, 200)}`,
      };
    }
    const published = JSON.parse(publishBody) as { id?: string };
    return { ok: true, externalPostId: published.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Instagram publish failed.",
    };
  }
}
