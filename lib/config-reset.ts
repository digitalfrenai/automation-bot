import fs from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SINGLE_CONFIG_ID } from "@/lib/site-config";
import { resolveStoredThemePath } from "@/lib/theme-upload-storage";

async function safeUnlink(filePath: string | null | undefined) {
  if (!filePath?.trim()) return;
  try {
    const resolved = filePath.startsWith("/uploads/")
      ? path.join(process.cwd(), "public", filePath.replace(/^\//, ""))
      : filePath;
    await fs.unlink(resolved);
  } catch {
    /* missing file */
  }
}

async function deleteUploadPaths(paths: string[]) {
  for (const p of paths) {
    await safeUnlink(p);
  }
}

/** Clears SFTP fields and uploaded theme zip (Hosting & Theme tab). */
export async function clearHostingAndTheme(configId: string = SINGLE_CONFIG_ID) {
  const config = await prisma.siteConfig.findUnique({ where: { id: configId } });
  if (!config) {
    throw new Error("No site configuration to clear.");
  }

  if (config.activeThemeZipPath) {
    try {
      const local = resolveStoredThemePath(config.activeThemeZipPath);
      await fs.unlink(local);
    } catch {
      /* ignore */
    }
  }

  await prisma.siteConfig.update({
    where: { id: configId },
    data: {
      sftpHost: null,
      sftpPort: null,
      sftpUsername: null,
      sftpPassword: null,
      activeThemeZipPath: null,
    },
  });
}

/**
 * Resets dashboard state for a new client/site while keeping API + WordPress credentials.
 * Does not delete WordPress pages/posts on the remote site.
 */
export async function resetAllDashboardState(configId: string = SINGLE_CONFIG_ID) {
  const config = await prisma.siteConfig.findUnique({ where: { id: configId } });
  if (!config) {
    throw new Error("No site configuration to reset.");
  }

  const designRefs = Array.isArray(config.designReferencePaths)
    ? (config.designReferencePaths as string[])
    : [];
  const blogImages = Array.isArray(config.blogRunImagePaths)
    ? (config.blogRunImagePaths as string[])
    : [];
  const pageImages = Array.isArray(config.pageImageUploadPaths)
    ? (config.pageImageUploadPaths as string[])
    : [];

  await deleteUploadPaths([
    config.businessLogoFilePath ?? "",
    config.activeThemeZipPath ?? "",
    ...designRefs,
    ...blogImages,
    ...pageImages,
  ]);

  if (config.activeThemeZipPath) {
    try {
      await fs.unlink(resolveStoredThemePath(config.activeThemeZipPath));
    } catch {
      /* ignore */
    }
  }

  await prisma.socialPostRecord.deleteMany({ where: { siteConfigId: configId } });
  await prisma.blogPostRecord.deleteMany({ where: { siteConfigId: configId } });
  await prisma.contentUpdateRecord.deleteMany({ where: { siteConfigId: configId } });
  await prisma.automationTask.deleteMany({ where: { siteConfigId: configId } });

  await prisma.siteConfig.update({
    where: { id: configId },
    data: {
      status: "IDLE",
      scaffoldPageIds: Prisma.JsonNull,
      wpLogoMediaId: null,
      businessName: "",
      businessLogoUrl: null,
      businessLogoFilePath: null,
      designReferencePaths: [],
      niche: "",
      targetAudience: "",
      toneOfVoice: "",
      coreServices: [],
      targetKeywords: [],
      pagesToBuild: ["Home", "About", "Services", "Contact", "FAQ"],
      activeThemeZipPath: null,
      sftpHost: null,
      sftpPort: null,
      sftpUsername: null,
      sftpPassword: null,
      blogPostsPerRun: 1,
      blogCategory: "",
      blogReferencePostUrl: null,
      blogRunContentTopic: null,
      blogRunKeywords: [],
      blogRunImagePaths: [],
      blogImagesDriveFolderUrl: null,
      pageImageUploadPaths: [],
      pageImagesDriveFolderUrl: null,
    },
  });
}