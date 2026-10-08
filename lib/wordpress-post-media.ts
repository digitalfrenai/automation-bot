import type { LoadedSiteConfig } from "@/lib/config-loader";
import { wpRequest } from "@/lib/wordpress-client";

type WpPostWithMedia = {
  featured_media?: number;
  tags?: number[];
};

type WpMedia = {
  source_url?: string;
};

type WpTag = {
  id: number;
  name: string;
};

export async function fetchPostFeaturedImageUrl(
  config: LoadedSiteConfig,
  postId: number
): Promise<string | null> {
  const post = await wpRequest<WpPostWithMedia>(
    config,
    `/wp-json/wp/v2/posts/${postId}?context=edit&_fields=featured_media`
  );
  const mediaId = post.featured_media;
  if (!mediaId || mediaId <= 0) return null;
  const media = await wpRequest<WpMedia>(
    config,
    `/wp-json/wp/v2/media/${mediaId}?_fields=source_url`
  );
  return media.source_url?.trim() || null;
}

export async function fetchPostTagNames(
  config: LoadedSiteConfig,
  postId: number
): Promise<string[]> {
  const post = await wpRequest<WpPostWithMedia>(
    config,
    `/wp-json/wp/v2/posts/${postId}?context=edit&_fields=tags`
  );
  const tagIds = post.tags ?? [];
  if (tagIds.length === 0) return [];

  const names: string[] = [];
  for (const id of tagIds.slice(0, 12)) {
    try {
      const tag = await wpRequest<WpTag>(
        config,
        `/wp-json/wp/v2/tags/${id}?_fields=name`
      );
      if (tag.name?.trim()) names.push(tag.name.trim());
    } catch {
      /* skip missing tag */
    }
  }
  return names;
}
