import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SINGLE_CONFIG_ID } from "@/lib/site-config";

const DEFAULT_PLATFORMS = ["x", "linkedin", "facebook", "instagram"];

function jsonFieldToString(value: Prisma.JsonValue | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function coerceStringArray(value: Prisma.JsonValue | null | undefined): string[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.filter((p): p is string => typeof p === "string");
  }

  const trimmed = jsonFieldToString(value).trim();
  if (trimmed === "") return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((p): p is string => typeof p === "string");
    }
  } catch {
    try {
      const wrapped = JSON.parse(`[${trimmed}]`);
      if (Array.isArray(wrapped)) {
        return wrapped.filter((p): p is string => typeof p === "string");
      }
    } catch {
      /* invalid */
    }
  }
  return null;
}

async function repairDesignReferencePaths(configId: string): Promise<void> {
  const row = await prisma.siteConfig.findUnique({
    where: { id: configId },
    select: { designReferencePaths: true },
  });
  if (!row) return;

  const coerced = coerceStringArray(row.designReferencePaths);
  if (coerced !== null) return;

  await prisma.siteConfig.update({
    where: { id: configId },
    data: { designReferencePaths: [] },
  });
}

async function repairSocialPlatforms(configId: string): Promise<void> {
  const row = await prisma.siteConfig.findUnique({
    where: { id: configId },
    select: { socialPlatforms: true },
  });
  if (!row) return;

  const coerced = coerceStringArray(row.socialPlatforms);
  if (coerced !== null) {
    if (coerced.length === 0) {
      await prisma.siteConfig.update({
        where: { id: configId },
        data: { socialPlatforms: DEFAULT_PLATFORMS },
      });
    }
    return;
  }

  await prisma.siteConfig.update({
    where: { id: configId },
    data: { socialPlatforms: DEFAULT_PLATFORMS },
  });
}

/**
 * Repair corrupted SiteConfig JSON columns (empty strings or invalid JSON).
 */
export async function ensureSiteConfigJsonIntegrity(
  configId: string = SINGLE_CONFIG_ID
): Promise<void> {
  try {
    await repairDesignReferencePaths(configId);
  } catch (err) {
    console.error("[ensureSiteConfigJsonIntegrity] designReferencePaths", err);
  }

  try {
    await repairSocialPlatforms(configId);
  } catch (err) {
    console.error("[ensureSiteConfigJsonIntegrity]", err);
  }
}