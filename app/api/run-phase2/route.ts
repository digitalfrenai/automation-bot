import { NextRequest } from "next/server";
import { runSiteBuildPhase2 } from "@/lib/site-build-runner";
import { createPipelineSseResponse } from "@/lib/sse-pipeline";
import { SINGLE_CONFIG_ID } from "@/lib/site-config";
import { updateSiteStatus } from "@/lib/config-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  let configId = SINGLE_CONFIG_ID;

  try {
    const body = (await request.json()) as { configId?: string };
    if (body.configId?.trim()) {
      configId = body.configId.trim();
    }
  } catch {
    /* default */
  }

  return createPipelineSseResponse(async (onLog) => {
    try {
      await runSiteBuildPhase2(configId, onLog);
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
