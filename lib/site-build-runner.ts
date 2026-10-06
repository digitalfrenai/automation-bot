import { loadSiteConfig, updateSiteStatus } from "@/lib/config-loader";
import { executePhase1 } from "@/lib/phase1Scaffolder";
import { executePhase2 } from "@/lib/phase2ContentGen";
import { executePhase3 } from "@/lib/phase3SeoPublisher";
import type { LogSink } from "@/lib/pipeline-logger";
import type { ScaffoledPage } from "@/lib/pipeline-types";
import {
  parseScaffoldPageMap,
  scaffoldMapKey,
} from "@/lib/scaffold-page-map";
import { deployThemeZip } from "@/lib/themeDeployer";
import { syncPrimaryNavigationMenu } from "@/lib/wordpress-menu-sync";
import {
  fetchAllWpPages,
  fetchWordPressReadingPageIds,
  resolveScaffoldPage,
} from "@/lib/wordpress-page-lookup";
import { wpRequest } from "@/lib/wordpress-client";

const PHASE2_PAGE_DELAY_MS = 1500;

export async function loadScaffoldPagesForSiteBuild(
  configId: string
): Promise<ScaffoledPage[]> {
  const config = await loadSiteConfig(configId);
  const storedMap = parseScaffoldPageMap(config.scaffoldPageIds);
  const existing = await fetchAllWpPages(config);
  const reading = await fetchWordPressReadingPageIds(config);
  const results: ScaffoledPage[] = [];

  for (const pageTitle of config.pagesToBuildList) {
    const title = pageTitle.trim();
    const mapKey = scaffoldMapKey(title);
    const found = resolveScaffoldPage({
      configTitle: title,
      pages: existing,
      storedPageId: storedMap[mapKey],
      reading,
    });

    if (!found) {
      throw new Error(
        `No WordPress page found for "${title}". Run Phase 1 (site setup) first.`
      );
    }

    results.push({
      id: found.id,
      title,
      scaffoldTitle: title,
      slug: found.slug,
      status: found.status,
    });
  }

  return results;
}

export async function runSiteBuildPhase1(
  configId: string,
  onLog: LogSink
): Promise<ScaffoledPage[]> {
  await loadSiteConfig(configId);
  await updateSiteStatus(configId, "SETTING_UP");

  onLog({
    timestamp: new Date().toISOString(),
    level: "info",
    phase: "setup",
    message: "Phase 1 started — theme deploy (if configured) and page scaffolding.",
  });

  await deployThemeZip(configId, onLog);
  const pages = await executePhase1(configId, onLog);

  if (pages.length === 0) {
    throw new Error("Phase 1 did not return any pages to process.");
  }

  await updateSiteStatus(configId, "COMPLETED");
  onLog({
    timestamp: new Date().toISOString(),
    level: "info",
    phase: "complete",
    message: `Phase 1 completed — ${pages.length} page(s) ready for content generation.`,
  });

  return pages;
}

export type SiteBuildPageFilter = {
  /** Run Phase 2/3 for a single scaffold title only (avoids Railway 15-minute HTTP limit). */
  pageTitle?: string;
};

function filterScaffoldPages(
  pages: ScaffoledPage[],
  filter?: SiteBuildPageFilter
): ScaffoledPage[] {
  const title = filter?.pageTitle?.trim();
  if (!title) return pages;
  const lower = title.toLowerCase();
  const match = pages.filter(
    (p) =>
      p.title.toLowerCase() === lower ||
      p.scaffoldTitle.toLowerCase() === lower
  );
  if (match.length === 0) {
    throw new Error(
      `No scaffold page matches pageTitle "${title}". Check Pages to build and Phase 1.`
    );
  }
  return match;
}

export async function runSiteBuildPhase2(
  configId: string,
  onLog: LogSink,
  filter?: SiteBuildPageFilter
): Promise<void> {
  await loadSiteConfig(configId);
  const allPages = await loadScaffoldPagesForSiteBuild(configId);
  const pages = filterScaffoldPages(allPages, filter);

  await updateSiteStatus(configId, "POPULATING");
  onLog({
    timestamp: new Date().toISOString(),
    level: "info",
    phase: "phase2",
    message: filter?.pageTitle
      ? `Phase 2 started — generating content for "${filter.pageTitle}" only (1 page).`
      : `Phase 2 started — generating content for ${pages.length} page(s).`,
  });

  for (const page of pages) {
    await new Promise((resolve) => setTimeout(resolve, PHASE2_PAGE_DELAY_MS));

    onLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "phase2",
      message: `Populating content for "${page.title}"…`,
      pageTitle: page.title,
      pageId: page.id,
    });

    await executePhase2(configId, page.id, page.scaffoldTitle, onLog);
  }

  await updateSiteStatus(configId, "COMPLETED");
  onLog({
    timestamp: new Date().toISOString(),
    level: "info",
    phase: "complete",
    message: filter?.pageTitle
      ? `Phase 2 completed for "${filter.pageTitle}". Run Phase 2 for other pages or Phase 3 to publish.`
      : "Phase 2 completed — page content saved (draft). Run Phase 3 to SEO-check and publish.",
  });
}

export async function runSiteBuildPhase3(
  configId: string,
  onLog: LogSink,
  filter?: SiteBuildPageFilter
): Promise<void> {
  const config = await loadSiteConfig(configId);
  const allPages = await loadScaffoldPagesForSiteBuild(configId);
  const pages = filterScaffoldPages(allPages, filter);

  await updateSiteStatus(configId, "PUBLISHING");
  onLog({
    timestamp: new Date().toISOString(),
    level: "info",
    phase: "phase3",
    message: filter?.pageTitle
      ? `Phase 3 started — SEO validation and publish for "${filter.pageTitle}" only.`
      : `Phase 3 started — SEO validation and publish for ${pages.length} page(s).`,
  });

  for (const page of pages) {
    onLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "phase3",
      message: `Publishing "${page.title}"…`,
      pageTitle: page.title,
      pageId: page.id,
    });

    const wpPage = await wpRequest<{
      content?: { raw?: string; rendered?: string };
    }>(config, `/wp-json/wp/v2/pages/${page.id}?context=edit`);

    const rawHtml =
      wpPage.content?.raw?.trim() ||
      wpPage.content?.rendered?.trim() ||
      "";

    if (!rawHtml) {
      throw new Error(
        `Page "${page.title}" (id ${page.id}) has no content. Run Phase 2 first.`
      );
    }

    await executePhase3(
      configId,
      page.id,
      page.scaffoldTitle,
      rawHtml,
      onLog,
      { slug: page.slug, scaffoldTitle: page.scaffoldTitle }
    );
  }

  await syncPrimaryNavigationMenu(config, allPages, onLog);

  await updateSiteStatus(configId, "COMPLETED");
  onLog({
    timestamp: new Date().toISOString(),
    level: "info",
    phase: "complete",
    message: filter?.pageTitle
      ? `Phase 3 completed for "${filter.pageTitle}". Run Phase 3 for remaining pages if needed.`
      : "Phase 3 completed — pages SEO-validated and published.",
  });
}

export async function runSiteBuildPhases1Through3(
  configId: string,
  onLog: LogSink
): Promise<void> {
  await loadSiteConfig(configId);
  await updateSiteStatus(configId, "SETTING_UP");

  onLog({
    timestamp: new Date().toISOString(),
    level: "info",
    phase: "setup",
    message: "Phases 1–3 started — full site setup, content, and publish.",
  });

  await deployThemeZip(configId, onLog);
  const pages = await executePhase1(configId, onLog);

  if (pages.length === 0) {
    throw new Error("Phase 1 did not return any pages to process.");
  }

  for (const page of pages) {
    await new Promise((resolve) => setTimeout(resolve, PHASE2_PAGE_DELAY_MS));

    await updateSiteStatus(configId, "POPULATING");
    onLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "phase2",
      message: `Populating content for "${page.title}"…`,
      pageTitle: page.title,
      pageId: page.id,
    });

    const phase2 = await executePhase2(
      configId,
      page.id,
      page.scaffoldTitle,
      onLog
    );

    await updateSiteStatus(configId, "PUBLISHING");
    onLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "phase3",
      message: `Publishing "${page.title}"…`,
      pageTitle: page.title,
      pageId: page.id,
    });

    await executePhase3(
      configId,
      page.id,
      page.scaffoldTitle,
      phase2.html,
      onLog,
      { slug: page.slug, scaffoldTitle: page.scaffoldTitle },
      {
        contentFormat: phase2.contentFormat,
        auditHtml: phase2.auditHtml,
      }
    );
  }

  const siteConfig = await loadSiteConfig(configId);
  await syncPrimaryNavigationMenu(siteConfig, pages, onLog);

  await updateSiteStatus(configId, "COMPLETED");
  onLog({
    timestamp: new Date().toISOString(),
    level: "info",
    phase: "complete",
    message: "Phases 1–3 completed successfully — status COMPLETED.",
  });
}
