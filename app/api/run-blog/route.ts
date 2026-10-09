import { NextRequest } from "next/server";
import { loadSiteConfig, updateSiteStatus } from "@/lib/config-loader";
import { executePhase4 } from "@/lib/phase4BlogGenerator";
import { SINGLE_CONFIG_ID } from "@/lib/site-config";
import { createPipelineSseResponse } from "@/lib/sse-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  let configId = SINGLE_CONFIG_ID;
  let topicCount: number | undefined;
  let blogCategory: string | undefined;

  try {
    const body = (await request.json()) as {
      configId?: string;
      topicCount?: number;
      blogCategory?: string;
    };
    if (body.configId?.trim()) {
      configId = body.configId.trim();
    }
    if (typeof body.topicCount === "number" && body.topicCount > 0) {
      topicCount = Math.min(10, Math.floor(body.topicCount));
    }
    if (typeof body.blogCategory === "string" && body.blogCategory.trim()) {
      blogCategory = body.blogCategory.trim();
    }
  } catch {
    /* use defaults */
  }

  return createPipelineSseResponse(async (onLog) => {
    try {
      await loadSiteConfig(configId);
      await updateSiteStatus(configId, "BLOGGING");

      onLog({
        timestamp: new Date().toISOString(),
        level: "info",
        phase: "phase4",
        message: "Phase 4 blog pipeline started — status BLOGGING.",
      });

      await executePhase4(configId, onLog, { topicCount, blogCategory });

      await updateSiteStatus(configId, "COMPLETED");
      onLog({
        timestamp: new Date().toISOString(),
        level: "info",
        phase: "complete",
        message: "Phase 4 completed successfully — status COMPLETED.",
      });
    } catch (err) {
      try {
        await updateSiteStatus(configId, "FAILED");
      } catch {
        /* ignore */
      }
      throw err;
    }
  });
}
