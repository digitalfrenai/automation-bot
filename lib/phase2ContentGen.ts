import { loadSiteConfig } from "@/lib/config-loader";
import {
  loadGenerationContext,
  buildPageSystemPrompt,
  grokUsesJsonObject,
} from "@/lib/content-generation-context";
import {
  prepareContentFromGrok,
  savePreparedPageContent,
} from "@/lib/content-pipeline";
import { enrichPreparedContentWithPageImages } from "@/lib/page-image-enrichment";
import {
  applyBusinessLogoToPreparedContent,
  ensureSiteLogoOnWordPress,
  logoPromptLine,
} from "@/lib/site-logo";
import { formatLabel, type ContentFormat } from "@/lib/content-format";
import { hasGutenbergBlocks } from "@/lib/gutenberg-content";
import { createGrokClient, GROK_MODEL } from "@/lib/grok-client";
import { createGrokChatCompletion } from "@/lib/grok-request";
import { applyContentButtonCss } from "@/lib/content-button-normalize";
import {
  buildMultimodalUserContent,
  designReferenceSystemAddon,
  designReferenceUserPreamble,
  isScreenshotLedDesignMode,
  loadDesignReferenceImages,
} from "@/lib/design-reference-vision";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import type { Phase2Result } from "@/lib/pipeline-types";
import {
  buildTemplateFillSystemPrompt,
  buildTemplateFillUserPrompt,
  canUseTemplateFill,
  extractTemplateFillPlan,
  mergeTemplateFillResponse,
  MIN_TEMPLATE_SLOTS,
} from "@/lib/template-fill";
import { isHomePage } from "@/lib/wordpress-page-roles";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { wpRequest } from "@/lib/wordpress-client";

function buildUserPrompt(
  pageTitle: string,
  brief: {
    businessName: string;
    niche: string;
    targetAudience: string;
    toneOfVoice: string;
    coreServices: string[];
    targetKeywords: string[];
  },
  logoLine?: string,
  screenshotLed?: boolean
): string {
  const structureLine = screenshotLed
    ? `Structure the page to match the reference screenshots (hero, sections, grids, cards, trust/CTA blocks). Use inline CSS where needed for colors and layout.`
    : `Structure the page with hero (reuse theme demo banner/image URLs from reference markup when available), value proposition, services/benefits, social proof or trust section, and a strong closing CTA section (not a site footer).
Use the same visual block pattern for every section (group → headings → columns/buttons) so the page looks like one theme design, not plain text in some areas and cards in others.
If the system prompt includes REFERENCE MARKUP from the active theme, mirror that block structure and class names exactly (swap text only).`;
  return `Create full page content for: "${pageTitle}".

Business name: ${brief.businessName}
Industry / niche: ${brief.niche}
Target audience: ${brief.targetAudience}
Tone of voice: ${brief.toneOfVoice}
Core services: ${brief.coreServices.join(", ") || "N/A"}
Target keywords (use naturally): ${brief.targetKeywords.join(", ") || "N/A"}

${structureLine}
The on-page H1 must be a single compelling headline — not an SEO title with pipe characters (|).
Make copy specific to the niche and audience.${logoLine ? `\n${logoLine}` : ""}`;
}

function buildHomePageAddon(brief: {
  businessName: string;
  coreServices: string[];
}): string {
  return `

This is the SITE HOME / FRONT PAGE (main landing page visitors see first).
Requirements:
- Produce a FULL landing page body with at least 6 distinct sections (hero keeps theme demo images from reference markup, value prop, services overview, benefits, trust/proof, FAQ or process, final CTA).
- Minimum ~800 words of visible copy across sections (not counting HTML tags).
- Highlight ${brief.businessName} and primary services: ${brief.coreServices.join(", ") || "core offerings"}.
- Do NOT output only a slim hero plus header/footer-like chrome — the theme supplies navigation and footer.`;
}

function buildUserPromptForPage(
  pageTitle: string,
  brief: {
    businessName: string;
    niche: string;
    targetAudience: string;
    toneOfVoice: string;
    coreServices: string[];
    targetKeywords: string[];
  },
  logoLine?: string,
  screenshotLed?: boolean
): string {
  const base = buildUserPrompt(pageTitle, brief, logoLine, screenshotLed);
  if (isHomePage(pageTitle)) {
    return base + buildHomePageAddon(brief);
  }
  return base;
}

async function resolveTemplateMarkup(
  config: Awaited<ReturnType<typeof loadSiteConfig>>,
  pageId: number,
  genCtx: Awaited<ReturnType<typeof loadGenerationContext>>
): Promise<{ markup: string; source: string } | null> {
  if (genCtx.screenshotLedDesign || isScreenshotLedDesignMode(config)) {
    return null;
  }

  const candidates: { markup: string; source: string }[] = [];

  const fromTheme = genCtx.templateMarkup?.trim() ?? "";
  if (fromTheme.length >= 200) {
    candidates.push({
      markup: fromTheme,
      source: genCtx.templateMarkupSource ?? "active theme reference",
    });
  }

  try {
    const page = await wpRequest<{ content?: { raw?: string } }>(
      config,
      `/wp-json/wp/v2/pages/${pageId}?context=edit`
    );
    const raw = page.content?.raw?.trim() ?? "";
    if (raw.length >= 400) {
      candidates.push({ markup: raw, source: "existing page content" });
    }
  } catch {
    /* optional candidate */
  }

  if (candidates.length === 0) return null;

  if (genCtx.format === "gutenberg") {
    const withBlocks = candidates.find((c) => hasGutenbergBlocks(c.markup));
    if (withBlocks) return withBlocks;
  }

  return candidates[0] ?? null;
}

export async function executePhase2(
  configId: string,
  pageId: number,
  pageTitle: string,
  onLog?: LogSink
): Promise<Phase2Result> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const config = await loadSiteConfig(configId);
  const client = createGrokClient(config);
  const genCtx = await loadGenerationContext(config, onLog);

  const brief = {
    businessName: config.businessName,
    niche: config.niche,
    targetAudience: config.targetAudience,
    toneOfVoice: config.toneOfVoice,
    coreServices: config.coreServicesList,
    targetKeywords: config.targetKeywordsList,
  };

  const siteLogo = await ensureSiteLogoOnWordPress(config, onLog);
  const logoLine = logoPromptLine(siteLogo);

  const templateResolved = await resolveTemplateMarkup(config, pageId, genCtx);
  const templateFillActive =
    templateResolved &&
    canUseTemplateFill(genCtx.format, templateResolved.markup);

  let fillPlan: ReturnType<typeof extractTemplateFillPlan> | null = null;
  if (templateFillActive && templateResolved) {
    fillPlan = extractTemplateFillPlan(templateResolved.markup);
    if (fillPlan.slots.length < MIN_TEMPLATE_SLOTS) {
      fillPlan = null;
    }
  }

  let useTemplateFill = Boolean(fillPlan && templateResolved);

  const pageNotes =
    isHomePage(pageTitle) && useTemplateFill
      ? "This is the site HOME / front page — expand copy in every slot (hero, services, trust, CTA) while keeping the same layout."
      : undefined;

  await applyContentButtonCss(config, onLog).catch(() => undefined);

  const designImages = await loadDesignReferenceImages(config);
  const hasDesignRef = designImages.length > 0;
  if (hasDesignRef && useTemplateFill) {
    log.info(
      "Design reference screenshots set — generating full page layout to match reference (template-fill disabled).",
      { phase: "phase2", pageTitle, pageId }
    );
    useTemplateFill = false;
  } else if (genCtx.screenshotLedDesign) {
    log.info(
      "Screenshot-led mode: no theme zip — page HTML will follow reference screenshots.",
      { phase: "phase2", pageTitle, pageId }
    );
  } else if (hasDesignRef) {
    log.info(
      `Phase 2 will match layout/style from ${designImages.length} reference screenshot(s).`,
      { phase: "phase2", pageTitle, pageId }
    );
  } else {
    log.info(
      useTemplateFill
        ? `Phase 2: template-fill (${fillPlan!.slots.length} slots, ${formatLabel(genCtx.format)}) for "${pageTitle}" from ${templateResolved!.source}…`
        : `Phase 2: generating ${formatLabel(genCtx.format)} content for "${pageTitle}"…`,
      {
        phase: "phase2",
        pageTitle,
        pageId,
      }
    );
  }

  const designSystemAddon = designReferenceSystemAddon(config);

  function buildUserMessageContent(text: string) {
    if (!hasDesignRef) return text;
    return buildMultimodalUserContent(
      `${designReferenceUserPreamble(config)}\n\n${text}`,
      designImages
    );
  }

  const messages: ChatCompletionMessageParam[] = useTemplateFill
    ? [
        {
          role: "system",
          content:
            buildTemplateFillSystemPrompt(
              genCtx.format,
              genCtx.themeGuide,
              templateResolved!.source
            ) + designSystemAddon,
        },
        {
          role: "user",
          content: buildUserMessageContent(
            buildTemplateFillUserPrompt(
              pageTitle,
              brief,
              fillPlan!.slots,
              pageNotes
            )
          ),
        },
      ]
    : [
        {
          role: "system",
          content:
            buildPageSystemPrompt(genCtx.format, genCtx.themeGuide, {
              screenshotLedDesign: genCtx.screenshotLedDesign,
            }) + designSystemAddon,
        },
        {
          role: "user",
          content: buildUserMessageContent(
            buildUserPromptForPage(
              pageTitle,
              brief,
              logoLine,
              genCtx.screenshotLedDesign
            )
          ),
        },
      ];

  const completion = await createGrokChatCompletion(
    client,
    {
      model: GROK_MODEL,
      temperature: useTemplateFill ? 0.35 : hasDesignRef ? 0.55 : 0.7,
      ...(useTemplateFill || grokUsesJsonObject(genCtx.format)
        ? { response_format: { type: "json_object" as const } }
        : {}),
      messages,
    },
    {
      label: useTemplateFill
        ? `Phase 2 template-fill for "${pageTitle}"`
        : `Phase 2 content for "${pageTitle}"`,
      onLog,
    }
  );

  const rawResponse = completion.choices[0]?.message?.content?.trim();
  if (!rawResponse) {
    throw new Error(`Grok returned empty content for page "${pageTitle}".`);
  }

  let rawForPipeline = rawResponse;
  if (useTemplateFill && fillPlan) {
    try {
      rawForPipeline = mergeTemplateFillResponse(rawResponse, fillPlan);
      log.info(
        `Template-fill merged ${fillPlan.slots.length} text slot(s); HTML structure unchanged.`,
        { phase: "phase2", pageTitle, pageId }
      );
    } catch (firstErr) {
      log.warn(
        `Template-fill merge failed (${firstErr instanceof Error ? firstErr.message : "unknown"}); retrying once…`,
        { phase: "phase2", pageTitle, pageId }
      );
      const retry = await createGrokChatCompletion(
        client,
        {
          model: GROK_MODEL,
          temperature: 0.25,
          response_format: { type: "json_object" as const },
          messages: [
            {
              role: "system",
              content: buildTemplateFillSystemPrompt(
                genCtx.format,
                genCtx.themeGuide,
                templateResolved!.source
              ),
            },
            {
              role: "user",
              content: `${buildTemplateFillUserPrompt(pageTitle, brief, fillPlan.slots, pageNotes)}

IMPORTANT: Return valid JSON only. Every slot id must appear in replacements.`,
            },
          ],
        },
        {
          label: `Phase 2 template-fill retry for "${pageTitle}"`,
          onLog,
        }
      );
      const retryRaw = retry.choices[0]?.message?.content?.trim();
      if (!retryRaw) {
        throw new Error(
          `Template-fill failed for "${pageTitle}" and retry returned empty content.`
        );
      }
      rawForPipeline = mergeTemplateFillResponse(retryRaw, fillPlan);
      log.info(`Template-fill retry succeeded for "${pageTitle}".`, {
        phase: "phase2",
        pageTitle,
        pageId,
      });
    }
  }

  let storageFormat: ContentFormat = genCtx.format;
  if (
    useTemplateFill &&
    genCtx.format === "gutenberg" &&
    !hasGutenbergBlocks(rawForPipeline)
  ) {
    storageFormat = "html";
    log.info(
      "Template-fill reference has no Gutenberg blocks; saving as theme HTML to preserve classes and layout.",
      { phase: "phase2", pageTitle, pageId }
    );
  }

  let prepared = prepareContentFromGrok(rawForPipeline, storageFormat, onLog, {
    pageTitle,
    phase: "phase2",
  });

  prepared = await enrichPreparedContentWithPageImages(
    config,
    prepared,
    pageTitle,
    brief,
    pageId,
    onLog
  );

  if (siteLogo) {
    prepared = applyBusinessLogoToPreparedContent(prepared, siteLogo);
  }

  if (
    isHomePage(pageTitle) &&
    genCtx.format === "html" &&
    prepared.auditHtml.length < 2500
  ) {
    log.warn(
      `Home page HTML looks short (${prepared.auditHtml.length} chars); saving anyway — re-run Phase 2 if the front page looks empty.`,
      { phase: "phase2", pageTitle, pageId }
    );
  }

  const html = await savePreparedPageContent(config, pageId, prepared);

  log.info(`Phase 2: content saved to WordPress page ${pageId}.`, {
    phase: "phase2",
    pageTitle,
    pageId,
  });

  return {
    pageId,
    pageTitle,
    html,
    contentFormat: prepared.format,
    auditHtml: prepared.auditHtml,
  };
}
