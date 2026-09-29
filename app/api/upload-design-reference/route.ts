import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  designReferencePublicPathForFilename,
  getDesignReferenceUploadDir,
} from "@/lib/design-reference-storage";
import { designReferenceMaxCount } from "@/lib/design-reference-vision";
import { ensureSiteConfigJsonIntegrity } from "@/lib/repair-site-config";
import { parseStringArray, SINGLE_CONFIG_ID } from "@/lib/site-config";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

function isAllowedImage(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  const extOk = /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  return ALLOWED.has(mime) || extOk;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("screenshots")
      .filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No screenshots provided. Use field name 'screenshots' (multiple allowed)." },
        { status: 400 }
      );
    }

    for (const file of files) {
      if (!isAllowedImage(file)) {
        return NextResponse.json(
          { error: "Screenshots must be PNG, JPG, WebP, or GIF." },
          { status: 400 }
        );
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: "Each screenshot must be 8MB or smaller." },
          { status: 400 }
        );
      }
    }

    await ensureSiteConfigJsonIntegrity(SINGLE_CONFIG_ID);

    const existing = await prisma.siteConfig.findUnique({
      where: { id: SINGLE_CONFIG_ID },
    });
    const current = existing
      ? parseStringArray(
          (existing as { designReferencePaths?: unknown }).designReferencePaths
        )
      : [];

    const max = designReferenceMaxCount();
    const room = max - current.length;
    if (room <= 0) {
      return NextResponse.json(
        { error: `Maximum ${max} reference screenshots allowed. Remove some before uploading.` },
        { status: 400 }
      );
    }

    const toSave = files.slice(0, room);
    const uploadDir = getDesignReferenceUploadDir();
    await mkdir(uploadDir, { recursive: true });

    const added: string[] = [];
    for (const file of toSave) {
      const safeBase = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;
      const absolutePath = path.join(uploadDir, filename);
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(absolutePath, buffer);
      added.push(designReferencePublicPathForFilename(filename));
    }

    const paths = [...current, ...added];

    if (existing) {
      await prisma.siteConfig.update({
        where: { id: SINGLE_CONFIG_ID },
        data: {
          designReferencePaths: paths,
        } as Record<string, unknown>,
      });
    }

    return NextResponse.json({
      ok: true,
      paths,
      added: added.length,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Design reference upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
