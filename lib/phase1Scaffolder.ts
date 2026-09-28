import { loadSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import type { ScaffoledPage } from "@/lib/pipeline-types";
import {
  parseScaffoldPageMap,
  saveScaffoldPageMap,
  scaffoldMapKey,
} from "@/lib/scaffold-page-map";
import { assignWordPressReadingSettings } from "@/lib/wordpress-page-roles";
import { trashDuplicateScaffoldPages } from "@/lib/wordpress-page-cleanup";
import { syncPrimaryNavigationMenu } from "@/lib/wordpress-menu-sync";
import { loadThemeStyleProfile } from "@/lib/theme-style-profile";
import {
  fetchAllWpPages,
  fetchWordPressReadingPageIds,
  pageMatchesScaffoldTarget,
  resolveScaffoldPage,
} from "@/lib/wordpress-page-lookup";
import { titleToSlug, wpRequest, type WpPage } from "@/lib/wordpress-client";

function pageTitleFromConfig(title: string): string {
  return title.trim();
}

export async function executePhase1(
  configId: string,
  onLog?: LogSink
): Promise<ScaffoledPage[]> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const config = await loadSiteConfig(configId);
  const storedMap = parseScaffoldPageMap(config.scaffoldPageIds);

  log.info("Phase 1: configuring WordPress site settings…", { phase: "phase1" });

  await loadThemeStyleProfile(config, onLog);

  try {
    await wpRequest(config, "/wp-json/wp/v2/settings", {
      method: "POST",
      body: JSON.stringify({
        title: config.businessName,
        description: `${config.niche} — ${config.targetAudience}`.slice(0, 160),
      }),
    });
    log.info("Site title and tagline updated.", { phase: "phase1" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Settings update failed.";
    log.warn(`Could not update site settings: ${message}`, { phase: "phase1" });
  }

  log.info("Fetching existing WordPress pages…", { phase: "phase1" });
  const existing = await fetchAllWpPages(config);
  const reading = await fetchWordPressReadingPageIds(config);

  const results: ScaffoledPage[] = [];
  const updatedMap = { ...storedMap };

  for (const pageTitle of config.pagesToBuildList) {
    const title = pageTitleFromConfig(pageTitle);
    const mapKey = scaffoldMapKey(title);
    const slug = titleToSlug(title) || "page";
    const found = resolveScaffoldPage({
      configTitle: title,
      pages: existing,
      storedPageId: storedMap[mapKey],
      reading,
    });

    if (found) {
      const duplicates = existing.filter(
        (p) => p.id !== found.id && pageMatchesScaffoldTarget(p, title)
      );
      if (duplicates.length > 0) {
        log.warn(
          `Page "${title}" has ${duplicates.length + 1} WordPress match(es); reusing id ${found.id} (also: ${duplicates.map((p) => p.id).join(", ")}). Extras will be trashed after scaffold.`,
          { phase: "phase1", pageTitle: title, pageId: found.id }
        );
      } else {
        log.info(
          `Page "${title}" already exists (id ${found.id}, slug "${found.slug}"). Skipping create; Phase 2 will update content.`,
          { phase: "phase1", pageTitle: title, pageId: found.id }
        );
      }
      updatedMap[mapKey] = found.id;
      results.push({
        id: found.id,
        title,
        scaffoldTitle: title,
        slug: found.slug,
        status: found.status,
      });
      continue;
    }

    log.info(`Creating draft page "${title}"…`, { phase: "phase1", pageTitle: title });

    const created = await wpRequest<WpPage>(config, "/wp-json/wp/v2/pages?context=edit", {
      method: "POST",
      body: JSON.stringify({
        title,
        slug,
        status: "draft",
        content: `<p>Placeholder content for ${title}. Grok will replace this in Phase 2.</p>`,
      }),
    });

    updatedMap[mapKey] = created.id;
    results.push({
      id: created.id,
      title,
      scaffoldTitle: title,
      slug: created.slug,
      status: created.status,
    });

    log.info(`Created draft page "${title}" (id ${created.id}).`, {
      phase: "phase1",
      pageTitle: title,
      pageId: created.id,
    });
  }

  await saveScaffoldPageMap(configId, updatedMap);
  await trashDuplicateScaffoldPages(config, existing, onLog);
  await assignWordPressReadingSettings(config, results, onLog);
  await syncPrimaryNavigationMenu(config, results, onLog);

  log.info(`Phase 1 complete: ${results.length} page(s) ready.`, { phase: "phase1" });
  return results;
}
