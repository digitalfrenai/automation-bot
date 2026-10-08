import type { LoadedSiteConfig } from "@/lib/config-loader";
import { loadSharp } from "@/lib/load-sharp";
import { readStoredLogoFile } from "@/lib/logo-upload-storage";
import { siteLogoConfigured } from "@/lib/site-logo";

export async function loadBusinessLogoBuffer(
  config: LoadedSiteConfig
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (config.businessLogoFilePath?.trim()) {
    const file = await readStoredLogoFile(config.businessLogoFilePath.trim());
    return { buffer: file.buffer, mimeType: file.mimeType };
  }
  const url = config.businessLogoUrl?.trim();
  if (!url) return null;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const mimeType =
    res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType };
}

/** Bottom-right logo mark for social shares (same blog hero, branded). */
export async function watermarkImageWithLogo(
  imageBuffer: Buffer,
  logo: { buffer: Buffer; mimeType: string },
  options?: { maxLogoWidthRatio?: number; padding?: number }
): Promise<{ buffer: Buffer; mimeType: string }> {
  const sharp = await loadSharp();
  const maxLogoWidthRatio = options?.maxLogoWidthRatio ?? 0.18;
  const padding = options?.padding ?? 24;

  const base = sharp(imageBuffer);
  const meta = await base.metadata();
  const width = meta.width ?? 1200;
  const height = meta.height ?? 630;
  const logoMaxW = Math.max(48, Math.floor(width * maxLogoWidthRatio));

  let logoSharp = sharp(logo.buffer);
  if (!logo.mimeType.toLowerCase().includes("svg")) {
    logoSharp = logoSharp.resize(logoMaxW, undefined, {
      fit: "inside",
      withoutEnlargement: true,
    });
  } else {
    logoSharp = logoSharp.resize(logoMaxW, undefined, { fit: "inside" });
  }
  const logoPng = await logoSharp.png().toBuffer();
  const logoMeta = await sharp(logoPng).metadata();
  const logoW = logoMeta.width ?? logoMaxW;
  const logoH = logoMeta.height ?? logoMaxW;

  const left = Math.max(padding, width - logoW - padding);
  const top = Math.max(padding, height - logoH - padding);

  const out = await base
    .composite([
      {
        input: logoPng,
        left,
        top,
        blend: "over",
      },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  return { buffer: Buffer.from(out), mimeType: "image/jpeg" };
}

export async function canWatermarkSocialImages(
  config: LoadedSiteConfig
): Promise<boolean> {
  if (!siteLogoConfigured(config)) return false;
  try {
    await loadSharp();
    return true;
  } catch {
    return false;
  }
}
