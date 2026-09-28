import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import {
  pageMatchesScaffoldTarget,
  pickBestScaffoldMatch,
} from "@/lib/wordpress-page-lookup";
import { wpRequest, type WpPage } from "@/lib/wordpress-client";

/** Move duplicate scaffold matches to trash so old sites (e.g. prior niche) leave the nav. */
export async function trashDuplicateScaffoldPages(
  config: LoadedSiteConfig,
  existing: WpPage[],
  onLog?: LogSink
): Promise<void> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const trashed = new Set<number>();

  for (const pageTitle of config.pagesToBuildList) {
    const matches = existing.filter((p) =>
      pageMatchesScaffoldTarget(p, pageTitle)
    );
    if (matches.length <= 1) continue;

    const keeper = pickBestScaffoldMatch(matches, pageTitle);

    for (const dup of matches) {
      if (dup.id === keeper.id || trashed.has(dup.id)) continue;
      try {
        await wpRequest(config, `/wp-json/wp/v2/pages/${dup.id}`, {
          method: "DELETE",
        });
        trashed.add(dup.id);
        log.info(
          `Trashed duplicate page id ${dup.id} ("${dup.slug}") — keeping id ${keeper.id} for "${pageTitle}".`,
          { phase: "phase1", pageTitle, pageId: keeper.id }
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "trash failed";
        log.warn(`Could not trash duplicate page ${dup.id}: ${message}`, {
          phase: "phase1",
          pageTitle,
        });
      }
    }
  }
}
