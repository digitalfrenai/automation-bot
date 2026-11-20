import { NextRequest, NextResponse } from "next/server";
import {
  clearHostingAndTheme,
  resetAllDashboardState,
} from "@/lib/config-reset";
import { SINGLE_CONFIG_ID } from "@/lib/site-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      scope?: "hosting" | "all";
      configId?: string;
    };
    const configId = body.configId?.trim() || SINGLE_CONFIG_ID;
    const scope = body.scope === "hosting" ? "hosting" : "all";

    if (scope === "hosting") {
      await clearHostingAndTheme(configId);
      return NextResponse.json({
        ok: true,
        message: "Hosting, SFTP, and theme zip cleared.",
      });
    }

    await resetAllDashboardState(configId);
    return NextResponse.json({
      ok: true,
      message:
        "Dashboard reset — brief, uploads, scaffold map, and job history cleared. Credentials unchanged.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reset failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}