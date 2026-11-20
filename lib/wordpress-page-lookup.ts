import { titleToSlug, wpRequest, type WpPage } from "@/lib/wordpress-client";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import { isBlogPage, isHomePage } from "@/lib/wordpress-page-roles";

export function getWpPageTitle(page: WpPage): string {
  if (typeof page.title === "string") {
    return page.title;
  }
  return page.title.raw ?? page.title.rendered ?? "";
}

function normalizeTitleForMatch(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function slugMatchesScaffoldTarget(slug: string, canonicalSlug: string): boolean {
  const s = slug.trim().toLowerCase();
  const c = canonicalSlug.trim().toLowerCase();
  if (!c) {
    return false;
  }
  if (s === c) {
    return true;
  }
  if (new RegExp(`^${escapeRegExp(c)}-\\d+$`).test(s)) {
    return true;
  }
  // Earlier runs may have published SEO slugs like "about-zest-running-shoes".
  return s.startsWith(`${c}-`);
}

export function pageMatchesScaffoldTarget(page: WpPage, configTitle: string): boolean {
  const title = configTitle.trim();
  const canonicalSlug = titleToSlug(title) || "page";
  const pageTitle = getWpPageTitle(page);

  if (normalizeTitleForMatch(pageTitle) === normalizeTitleForMatch(title)) {
    return true;
  }
  if (isHomePage(title) && isHomePage(pageTitle, page.slug)) {
    return true;
  }
  if (isBlogPage(title) && isBlogPage(pageTitle, page.slug)) {
    return true;
  }
  return slugMatchesScaffoldTarget(page.slug, canonicalSlug);
}

/** Prefer exact canonical slug, then oldest page (lowest id). */
export function pickBestScaffoldMatch(
  candidates: WpPage[],
  configTitle: string
): WpPage {
  const canonicalSlug = (titleToSlug(configTitle.trim()) || "page").toLowerCase();
  return [...candidates].sort((a, b) => {
    const aExact = a.slug.toLowerCase() === canonicalSlug ? 0 : 1;
    const bExact = b.slug.toLowerCase() === canonicalSlug ? 0 : 1;
    if (aExact !== bExact) {
      return aExact - bExact;
    }
    return a.id - b.id;
  })[0];
}

export async function fetchAllWpPages(config: LoadedSiteConfig): Promise<WpPage[]> {
  const all: WpPage[] = [];
  const perPage = 100;
  let page = 1;

  for (;;) {
    const batch = await wpRequest<WpPage[]>(
      config,
      `/wp-json/wp/v2/pages?per_page=${perPage}&page=${page}&status=draft,publish,pending,private&context=edit`
    );
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    all.push(...batch);
    if (batch.length < perPage) {
      break;
    }
    page += 1;
  }

  return all;
}

export function findExistingScaffoldPage(
  pages: WpPage[],
  configTitle: string
): WpPage | undefined {
  const matches = pages.filter((p) => pageMatchesScaffoldTarget(p, configTitle));
  if (matches.length === 0) {
    return undefined;
  }
  return pickBestScaffoldMatch(matches, configTitle);
}

export type WordPressReadingPageIds = {
  front?: number;
  posts?: number;
};

export async function fetchWordPressReadingPageIds(
  config: LoadedSiteConfig
): Promise<WordPressReadingPageIds> {
  try {
    const settings = await wpRequest<{
      page_on_front?: number;
      page_for_posts?: number;
    }>(config, "/wp-json/wp/v2/settings");
    return {
      front:
        typeof settings.page_on_front === "number"
          ? settings.page_on_front
          : undefined,
      posts:
        typeof settings.page_for_posts === "number"
          ? settings.page_for_posts
          : undefined,
    };
  } catch {
    return {};
  }
}

export function resolveScaffoldPage(options: {
  configTitle: string;
  pages: WpPage[];
  storedPageId?: number;
  reading?: WordPressReadingPageIds;
}): WpPage | undefined {
  const title = options.configTitle.trim();

  if (options.storedPageId) {
    const byId = options.pages.find((p) => p.id === options.storedPageId);
    if (byId && pageMatchesScaffoldTarget(byId, title)) {
      return byId;
    }
  }

  if (isHomePage(title) && options.reading?.front) {
    const front = options.pages.find((p) => p.id === options.reading!.front);
    if (front) {
      return front;
    }
  }

  if (isBlogPage(title) && options.reading?.posts) {
    const posts = options.pages.find((p) => p.id === options.reading!.posts);
    if (posts) {
      return posts;
    }
  }

  return findExistingScaffoldPage(options.pages, title);
}
