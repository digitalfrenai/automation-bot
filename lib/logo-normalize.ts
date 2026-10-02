import { loadSharp, type SharpFactory } from "@/lib/load-sharp";

const DEFAULT_MAX_WIDTH = 280;
const DEFAULT_MAX_HEIGHT = 72;

export function logoMaxWidth(): number {
  const n = Number(process.env.LOGO_MAX_WIDTH);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_WIDTH;
}

export function logoMaxHeight(): number {
  const n = Number(process.env.LOGO_MAX_HEIGHT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_HEIGHT;
}

/** Header-sized logo file for WordPress custom/site logo (not page hero art). */
export async function normalizeLogoForSiteHeader(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const mime = mimeType.toLowerCase();
  if (mime.includes("svg") || mime.includes("gif")) {
    return { buffer, mimeType };
  }

  let sharp: SharpFactory;
  try {
    sharp = await loadSharp();
  } catch {
    return { buffer, mimeType };
  }

  const maxW = logoMaxWidth();
  const maxH = logoMaxHeight();
  const meta = await sharp(buffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  if (w > 0 && h > 0 && w <= maxW && h <= maxH) {
    return { buffer, mimeType };
  }

  const out = await sharp(buffer)
    .resize(maxW, maxH, { fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { buffer: out, mimeType: "image/png" };
}

export function headerLogoCssBlock(): string {
  const maxH = logoMaxHeight();
  const maxW = logoMaxWidth();
  return `/* wp-bot-header-logo */
.site-header .custom-logo,
.site-header .brand img,
.site-header .site-logo img,
.site-branding .custom-logo-link img,
.site-branding img.custom-logo,
header .custom-logo-link img,
.wp-block-site-logo img,
.kadence-custom-logo img {
  max-height: ${maxH}px !important;
  width: auto !important;
  max-width: min(${maxW}px, 42vw) !important;
  height: auto !important;
  object-fit: contain !important;
}
.site-branding .site-title {
  font-size: clamp(0.85rem, 2vw, 1.05rem);
  line-height: 1.2;
}
.site-branding .site-description {
  font-size: 0.75rem;
}`;
}

export const HEADER_LOGO_CSS_MARKER = "/* wp-bot-header-logo */";
