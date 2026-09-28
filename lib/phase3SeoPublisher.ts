import { loadSiteConfig } from "@/lib/config-loader";
import type { ContentFormat } from "@/lib/content-format";
import { inferContentFormatFromStorage } from "@/lib/content-format";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import type { ScaffoledPage, SeoValidationPayload } from "@/lib/pipeline-types";
import {
  assignWordPressReadingSettings,
  isHomePage,
  publishSlugForPage,
} from "@/lib/wordpress-page-roles";
import { runSeoAudit, truncateMeta } from "@/lib/seo-audit";
import { replaceWordPressPageContent } from "@/lib/wordpress-page-content";
import { pageDisplayTitle } from "@/lib/page-display-title";
import { wpRequest, type WpPage } from "@/lib/wordpress-client";

export async function executePhase3(
  configId: string,
  pageId: number,
  pageTitle: string,
  rawHtml: string,
  onLog?: LogSink,
  pageMeta?: Pick<ScaffoledPage, "slug" | "scaffoldTitle">,
  options?: { contentFormat?: ContentFormat; auditHtml?: string }
): Promise<SeoValidationPayload> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const config = await loadSiteConfig(configId);

  const contentFormat =
    options?.contentFormat ?? inferContentFormatFromStorage(rawHtml);

  log.info(`Phase 3: SEO validation for "${pageTitle}" (${contentFormat})…`, {
    phase: "phase3",
    pageTitle,
    pageId,
  });

  const seo = await runSeoAudit({
    configId,
    title: pageTitle,
    rawHtml,
    auditHtml: options?.auditHtml,
    contentFormat,
    contentKind: "page",
    phase: "phase3",
    onLog,
  });

  await replaceWordPressPageContent(config, pageId, {
    format: contentFormat,
    html: seo.finalHtml,
  });

  const seoTitle = truncateMeta(seo.seo_title, 60);
  const metaDescription = truncateMeta(seo.meta_description, 160);
  const scaffoldTitle = pageMeta?.scaffoldTitle?.trim() || pageTitle;
  const wpTitle = pageDisplayTitle(scaffoldTitle);
  const existingSlug = pageMeta?.slug ?? "";
  const slug = publishSlugForPage(scaffoldTitle, existingSlug, seo.slug);

  const publishBody: Record<string, unknown> = {
    status: "publish",
    slug,
    title: wpTitle,
    excerpt: metaDescription,
    meta: {
      _yoast_wpseo_title: seoTitle,
      _yoast_wpseo_metadesc: metaDescription,
      rank_math_title: seoTitle,
      rank_math_description: metaDescription,
    },
  };

  try {
    await wpRequest<WpPage>(
      config,
      `/wp-json/wp/v2/pages/${pageId}?context=edit`,
      {
        method: "POST",
        body: JSON.stringify(publishBody),
      }
    );
    log.info(`Page "${pageTitle}" published with SEO metadata.`, {
      phase: "phase3",
      pageTitle,
      pageId,
    });
  } catch (err) {
    log.warn(
      "Meta fields may be restricted; retrying publish without custom meta keys.",
      { phase: "phase3", pageTitle, pageId }
    );

    await wpRequest<WpPage>(
      config,
      `/wp-json/wp/v2/pages/${pageId}?context=edit`,
      {
        method: "POST",
        body: JSON.stringify({
          status: "publish",
          slug,
          title: wpTitle,
          excerpt: metaDescription,
        }),
      }
    );

    log.info(`Page "${pageTitle}" published (title/excerpt only).`, {
      phase: "phase3",
      pageTitle,
      pageId,
    });

    if (err instanceof Error) {
      log.warn(err.message, { phase: "phase3", pageTitle, pageId });
    }
  }

  log.info(
    `SEO summary — H1: ${seo.h1_count}, hierarchy: ${seo.heading_hierarchy_valid}, keywords: ${seo.keyword_density_passed}`,
    { phase: "phase3", pageTitle, pageId }
  );

  if (isHomePage(scaffoldTitle, slug ?? existingSlug)) {
    await assignWordPressReadingSettings(
      config,
      [
        {
          id: pageId,
          title: scaffoldTitle,
          scaffoldTitle,
          slug: slug ?? existingSlug,
          status: "publish",
        },
      ],
      onLog
    );
  }

  return seo;
}
