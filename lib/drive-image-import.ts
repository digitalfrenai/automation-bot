import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import {
  blogImagePublicPath,
  getBlogImageUploadDir,
  getPageImageUploadDir,
  pageImagePublicPath,
} from "@/lib/asset-upload-storage";
import { downloadDriveFile, listDriveFolderImages } from "@/lib/google-drive-folder";
import { parseStringArray, SINGLE_CONFIG_ID } from "@/lib/site-config";

export type DriveImportTarget = "page" | "blog";

export async function importImagesFromDriveFolder(options: {
  folderUrl: string;
  target: DriveImportTarget;
  replace?: boolean;
}): Promise<{ paths: string[]; downloaded: number }> {
  const max = options.target === "blog" ? 3 : 24;
  const files = await listDriveFolderImages(options.folderUrl, max);
  const uploadDir =
    options.target === "blog" ? getBlogImageUploadDir() : getPageImageUploadDir();
  await mkdir(uploadDir, { recursive: true });

  const existing = await prisma.siteConfig.findUnique({
    where: { id: SINGLE_CONFIG_ID },
  });
  const field =
    options.target === "blog" ? "blogRunImagePaths" : "pageImageUploadPaths";
  const current = options.replace
    ? []
    : parseStringArray(
        options.target === "blog"
          ? existing?.blogRunImagePaths
          : existing?.pageImageUploadPaths
      );

  const added: string[] = [];
  for (const file of files) {
    if (current.length + added.length >= max) break;
    const { buffer, mimeType } = await downloadDriveFile(file.id);
    const ext =
      mimeType === "image/png"
        ? ".png"
        : mimeType === "image/webp"
          ? ".webp"
          : mimeType === "image/gif"
            ? ".gif"
            : ".jpg";
    const filename = `${Date.now()}-drive-${file.id.slice(0, 8)}${ext}`;
    await writeFile(path.join(uploadDir, filename), buffer);
    const publicPath =
      options.target === "blog"
        ? blogImagePublicPath(filename)
        : pageImagePublicPath(filename);
    added.push(publicPath);
  }

  const merged = [...current, ...added].slice(0, max);
  await prisma.siteConfig.update({
    where: { id: SINGLE_CONFIG_ID },
    data: {
      [field]: merged,
      ...(options.target === "blog"
        ? { blogImagesDriveFolderUrl: options.folderUrl.trim() }
        : { pageImagesDriveFolderUrl: options.folderUrl.trim() }),
    },
  });

  return { paths: merged, downloaded: added.length };
}