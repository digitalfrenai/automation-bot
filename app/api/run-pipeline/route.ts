import { NextRequest } from "next/server";
import { loadSiteConfig, updateSiteStatus } from "@/lib/config-loader";
import { executePhase1 } from "@/lib/phase1Scaffolder";
import { executePhase2 } from "@/lib/phase2ContentGen";
import { executePhase3 } from "@/lib/phase3SeoPublisher";
import type { PipelineLogEntry } from "@/lib/pipeline-types";
import { deployThemeZip } from "@/lib/themeDeployer";
import { SINGLE_CONFIG_ID } from "@/lib/site-config";
import { syncPrimaryNavigationMenu } from "@/lib/wordpress-menu-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

function sseEncode(entry: PipelineLogEntry | { type: "done" } | { type: "error"; message: string }) {
  return `data: ${JSON.stringify(entry)}\n\n`;
}

export async function POST(request: NextRequest) {
  let configId = SINGLE_CONFIG_ID;

  try {
    const body = (await request.json()) as { configId?: string };
    if (body.configId?.trim()) {
      configId = body.configId.trim();
    }
  } catch {
    /* use default config id */
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const push = (
        entry: PipelineLogEntry | { type: "done" } | { type: "error"; message: string }
      ) => {
        controller.enqueue(encoder.encode(sseEncode(entry)));
      };

      const onLog = (entry: PipelineLogEntry) => {
        push(entry);
      };

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      (async () => {
        try {
          await loadSiteConfig(configId);
          await updateSiteStatus(configId, "SETTING_UP");

          push({
            timestamp: new Date().toISOString(),
            level: "info",
            phase: "setup",
            message: "Pipeline started — status SETTING_UP.",
          });

          await deployThemeZip(configId, onLog);
          const pages = await executePhase1(configId, onLog);

          if (pages.length === 0) {
            throw new Error("Phase 1 did not return any pages to process.");
          }

          for (const page of pages) {
            await new Promise((resolve) => setTimeout(resolve, 1500));

            await updateSiteStatus(configId, "POPULATING");
            push({
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
            push({
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
          push({
            timestamp: new Date().toISOString(),
            level: "info",
            phase: "complete",
            message: "Pipeline completed successfully — status COMPLETED.",
          });
          push({ type: "done" });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Pipeline execution failed.";
          try {
            await updateSiteStatus(configId, "FAILED");
          } catch {
            /* ignore secondary failure */
          }
          push({ type: "error", message });
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
