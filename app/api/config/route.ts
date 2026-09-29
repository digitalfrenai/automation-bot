import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSiteConfigJsonIntegrity } from "@/lib/repair-site-config";
import {
  DEFAULT_PAGES,
  SINGLE_CONFIG_ID,
  normalizeMaintenanceSettings,
  parseStringArray,
  siteConfigToClient,
  type SiteConfigInput,
} from "@/lib/site-config";

function buildConfigData(body: SiteConfigInput) {
  const pagesToBuild = parseStringArray(body.pagesToBuild);
  const maintenance = normalizeMaintenanceSettings(body);
  return {
    xaiApiKey: body.xaiApiKey.trim(),
    wpUrl: body.wpUrl.trim(),
    wpUsername: body.wpUsername.trim(),
    wpAppPassword: body.wpAppPassword.trim(),
    sftpHost: body.sftpHost?.trim() || null,
    sftpPort: body.sftpPort?.trim() || null,
    sftpUsername: body.sftpUsername?.trim() || null,
    sftpPassword: body.sftpPassword?.trim() || null,
    businessName: body.businessName.trim(),
    businessLogoUrl: body.businessLogoUrl?.trim() || null,
    businessLogoFilePath: body.businessLogoFilePath?.trim() || null,
    designReferencePaths: parseStringArray(body.designReferencePaths),
    niche: body.niche.trim(),
    targetAudience: body.targetAudience.trim(),
    toneOfVoice: body.toneOfVoice.trim(),
    coreServices: parseStringArray(body.coreServices),
    targetKeywords: parseStringArray(body.targetKeywords),
    pagesToBuild: pagesToBuild.length > 0 ? pagesToBuild : [...DEFAULT_PAGES],
    activeThemeZipPath: body.activeThemeZipPath?.trim() || null,
    ...maintenance,
    ...(body.status ? { status: body.status } : {}),
  };
}

export async function GET() {
  try {
    await ensureSiteConfigJsonIntegrity(SINGLE_CONFIG_ID);

    const config = await prisma.siteConfig.findUnique({
      where: { id: SINGLE_CONFIG_ID },
    });

    if (!config) {
      return NextResponse.json({ config: null });
    }

    return NextResponse.json({ config: siteConfigToClient(config) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load config.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SiteConfigInput;

    if (
      !body.xaiApiKey?.trim() ||
      !body.wpUrl?.trim() ||
      !body.wpUsername?.trim() ||
      !body.wpAppPassword?.trim() ||
      !body.businessName?.trim() ||
      !body.niche?.trim() ||
      !body.targetAudience?.trim() ||
      !body.toneOfVoice?.trim()
    ) {
      return NextResponse.json(
        { error: "Missing required configuration fields." },
        { status: 400 }
      );
    }

    const data = buildConfigData(body);

    const config = await prisma.siteConfig.upsert({
      where: { id: SINGLE_CONFIG_ID },
      create: { id: SINGLE_CONFIG_ID, ...data },
      update: data,
    });

    return NextResponse.json({ config: siteConfigToClient(config) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save config.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
