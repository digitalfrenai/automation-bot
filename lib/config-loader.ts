import type { SiteConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureSiteConfigJsonIntegrity } from "@/lib/repair-site-config";
import { parseStringArray } from "@/lib/site-config";

export type SiteLogoConfigFields = {
  businessLogoUrl: string | null;
  businessLogoFilePath: string | null;
  wpLogoMediaId: number | null;
};

export type LoadedSiteConfig = SiteConfig &
  SiteLogoConfigFields & {
    designReferencePathsList: string[];
    coreServicesList: string[];
    targetKeywordsList: string[];
    pagesToBuildList: string[];
  };

function readLogoFields(config: SiteConfig): SiteLogoConfigFields {
  const row = config as SiteConfig & Partial<SiteLogoConfigFields>;
  return {
    businessLogoUrl: row.businessLogoUrl ?? null,
    businessLogoFilePath: row.businessLogoFilePath ?? null,
    wpLogoMediaId: row.wpLogoMediaId ?? null,
  };
}

export async function loadSiteConfig(
  configId: string
): Promise<LoadedSiteConfig> {
  await ensureSiteConfigJsonIntegrity(configId);

  const config = await prisma.siteConfig.findUnique({ where: { id: configId } });
  if (!config) {
    throw new Error(`Site configuration not found for id "${configId}".`);
  }

  const row = config as SiteConfig & { designReferencePaths?: unknown };

  return {
    ...config,
    ...readLogoFields(config),
    designReferencePathsList: parseStringArray(row.designReferencePaths),
    coreServicesList: parseStringArray(config.coreServices),
    targetKeywordsList: parseStringArray(config.targetKeywords),
    pagesToBuildList: parseStringArray(config.pagesToBuild),
  };
}

export async function updateSiteStatus(
  configId: string,
  status: SiteConfig["status"]
): Promise<void> {
  await prisma.siteConfig.update({
    where: { id: configId },
    data: { status },
  });
}
