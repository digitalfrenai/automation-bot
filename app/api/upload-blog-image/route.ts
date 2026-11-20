import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  blogImagePublicPath,
  getBlogImageUploadDir,
} from "@/lib/asset-upload-storage";
import { parseStringArray, SINGLE_CONFIG_ID } from "@/lib/site-config";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 3;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("images").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      const single = formData.get("image");
      if (single instanceof File) {
        files.push(single);
      }
    }
    if (files.length === 0) {
      return NextResponse.json({ error: "No image files provided." }, { status: 400 });
    }

    const uploadDir = getBlogImageUploadDir();
    await mkdir(uploadDir, { recursive: true });

    const existing = await prisma.siteConfig.findUnique({
      where: { id: SINGLE_CONFIG_ID },
    });
    const current = parseStringArray(existing?.blogRunImagePaths).slice(0, MAX_FILES);
    const added: string[] = [];

    for (const file of files) {
      if (current.length + added.length >= MAX_FILES) break;
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: `Image ${file.name} exceeds 8MB.` },
          { status: 400 }
        );
      }
      const safeBase = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filename = `${Date.now()}-${safeBase}`;
      const absolutePath = path.join(uploadDir, filename);
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(absolutePath, buffer);
      added.push(blogImagePublicPath(filename));
    }

    const merged = [...current, ...added].slice(0, MAX_FILES);
    await prisma.siteConfig.update({
      where: { id: SINGLE_CONFIG_ID },
      data: { blogRunImagePaths: merged },
    });

    return NextResponse.json({ ok: true, paths: merged, added: added.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await prisma.siteConfig.update({
      where: { id: SINGLE_CONFIG_ID },
      data: { blogRunImagePaths: [] },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clear failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}