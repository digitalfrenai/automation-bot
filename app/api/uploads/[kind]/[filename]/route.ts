import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { resolveStoredDesignReferencePath } from "@/lib/design-reference-storage";
import { resolveStoredLogoPath } from "@/lib/logo-upload-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set(["logos", "design-references"]);

function safeFilename(raw: string): string | null {
  const base = path.basename(raw);
  if (!base || base !== raw || base.includes("..")) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) return null;
  return base;
}

function mimeForFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string; filename: string }> }
) {
  const { kind, filename: rawFilename } = await context.params;
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filename = safeFilename(rawFilename);
  if (!filename) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const publicPath =
    kind === "logos"
      ? `/uploads/logos/${filename}`
      : `/uploads/design-references/${filename}`;

  const absolute =
    kind === "logos"
      ? resolveStoredLogoPath(publicPath)
      : resolveStoredDesignReferencePath(publicPath);

  try {
    const buffer = await readFile(absolute);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeForFilename(filename),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
