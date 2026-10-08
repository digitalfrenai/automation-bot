import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { WordPressApiError, wpRequest } from "@/lib/wordpress-client";

type WpCategory = {
  id: number;
  name: string;
  slug: string;
};

function cleanCategoryName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 40);
}

export async function listPostCategories(
  config: LoadedSiteConfig
): Promise<WpCategory[]> {
  const all: WpCategory[] = [];
  for (let page = 1; page <= 5; page += 1) {
    try {
      const batch = await wpRequest<WpCategory[]>(
        config,
        `/wp-json/wp/v2/categories?per_page=100&page=${page}&hide_empty=false&_fields=id,name,slug`
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 100) break;
    } catch (err) {
      if (err instanceof WordPressApiError && err.status === 400) break;
      throw err;
    }
  }
  return all.filter((category) => category.slug !== "uncategorized");
}

export async function ensureWordPressCategory(
  config: LoadedSiteConfig,
  name: string,
  existing?: WpCategory[]
): Promise<number> {
  const wanted = cleanCategoryName(name);
  if (!wanted || wanted.toLowerCase() === "uncategorized") {
    throw new Error("Blog category name is empty.");
  }
  const categories = existing ?? (await listPostCategories(config));
  const found = categories.find(
    (category) => category.name.toLowerCase() === wanted.toLowerCase()
  );
  if (found) return found.id;

  const created = await wpRequest<WpCategory>(config, "/wp-json/wp/v2/categories", {
    method: "POST",
    body: JSON.stringify({ name: wanted }),
  });
  if (!created.id) {
    throw new Error(`WordPress did not create category "${wanted}".`);
  }
  categories.push(created);
  return created.id;
}

export async function listPostTags(config: LoadedSiteConfig): Promise<WpCategory[]> {
  const all: WpCategory[] = [];
  for (let page = 1; page <= 5; page += 1) {
    try {
      const batch = await wpRequest<WpCategory[]>(
        config,
        `/wp-json/wp/v2/tags?per_page=100&page=${page}&hide_empty=false&_fields=id,name,slug`
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 100) break;
    } catch (err) {
      if (err instanceof WordPressApiError && err.status === 400) break;
      throw err;
    }
  }
  return all;
}

function uniqueTagNames(names: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const name of names) {
    const cleaned = cleanCategoryName(name);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(cleaned);
    if (tags.length >= 5) break;
  }
  return tags;
}

export async function assignPostTags(
  config: LoadedSiteConfig,
  postId: number,
  tagNames: string[],
  onLog?: LogSink,
  existing?: WpCategory[]
): Promise<number[]> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const wanted = uniqueTagNames(tagNames);
  if (wanted.length === 0) return [];

  try {
    const tags = existing ?? (await listPostTags(config));
    const ids: number[] = [];
    for (const name of wanted) {
      const found = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
      if (found) {
        ids.push(found.id);
        continue;
      }
      const created = await wpRequest<WpCategory>(config, "/wp-json/wp/v2/tags", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (!created.id) continue;
      tags.push(created);
      ids.push(created.id);
    }
    if (ids.length === 0) return [];
    await wpRequest(config, `/wp-json/wp/v2/posts/${postId}`, {
      method: "POST",
      body: JSON.stringify({ tags: ids }),
    });
    log.info(`Assigned blog tags: ${wanted.join(", ")}.`, {
      phase: "phase4",
      pageId: postId,
    });
    return ids;
  } catch (err) {
    const message = err instanceof Error ? err.message : "tag assign failed";
    log.warn(`Could not assign blog tags: ${message}`, {
      phase: "phase4",
      pageId: postId,
    });
    return [];
  }
}

export async function assignPostCategory(
  config: LoadedSiteConfig,
  postId: number,
  categoryName: string,
  onLog?: LogSink,
  existing?: WpCategory[]
): Promise<number | null> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  try {
    const categoryId = await ensureWordPressCategory(config, categoryName, existing);
    await wpRequest(config, `/wp-json/wp/v2/posts/${postId}`, {
      method: "POST",
      body: JSON.stringify({ categories: [categoryId] }),
    });
    log.info(`Assigned blog category "${cleanCategoryName(categoryName)}".`, {
      phase: "phase4",
      pageId: postId,
    });
    return categoryId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "category assign failed";
    log.warn(`Could not assign a blog category: ${message}`, {
      phase: "phase4",
      pageId: postId,
    });
    return null;
  }
}
