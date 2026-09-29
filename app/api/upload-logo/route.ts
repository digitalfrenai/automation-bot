import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getLogoUploadDir,
  logoPublicPathForFilename,
} from "@/lib/logo-upload-storage";
import { SINGLE_CONFIG_ID } from "@/lib/site-config";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
]);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("logo");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No logo file provided. Use field name 'logo'." },
        { status: 400 }
      );
    }

    const mime = (file.type || "").toLowerCase();
    const extOk = /\.(png|jpe?g|webp|svg|gif)$/i.test(file.name);
    if (!ALLOWED.has(mime) && !extOk) {
      return NextResponse.json(
        { error: "Logo must be PNG, JPG, WebP, SVG, or GIF." },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Logo file exceeds 5MB limit." },
        { status: 400 }
      );
    }

    const uploadDir = getLogoUploadDir();
    await mkdir(uploadDir, { recursive: true });

    const safeBase = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${Date.now()}-${safeBase}`;
    const absolutePath = path.join(uploadDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(absolutePath, buffer);

    const publicPath = logoPublicPathForFilename(filename);

    const existing = await prisma.siteConfig.findUnique({
      where: { id: SINGLE_CONFIG_ID },
    });
    if (existing) {
      await prisma.siteConfig.update({
        where: { id: SINGLE_CONFIG_ID },
        data: {
          businessLogoFilePath: publicPath,
          wpLogoMediaId: null,
        } as Record<string, unknown>,
      });
    }

    return NextResponse.json({
      ok: true,
      path: publicPath,
      filename,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Logo upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
