import { NextRequest, NextResponse } from "next/server";
import { importImagesFromDriveFolder } from "@/lib/drive-image-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      folderUrl?: string;
      target?: "page" | "blog";
      replace?: boolean;
    };
    const folderUrl = body.folderUrl?.trim();
    if (!folderUrl) {
      return NextResponse.json({ error: "folderUrl is required." }, { status: 400 });
    }
    const target = body.target === "blog" ? "blog" : "page";
    const result = await importImagesFromDriveFolder({
      folderUrl,
      target,
      replace: body.replace === true,
    });
    return NextResponse.json({
      ok: true,
      paths: result.paths,
      downloaded: result.downloaded,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Drive import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}