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

export function headerLogoCssBlock(logoUrl?: string): string {
  const maxH = logoMaxHeight();
  const maxW = logoMaxWidth();
  const safeUrl = logoUrl?.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const demoOverride =
    safeUrl &&
    `
#masthead.site-header .site-branding,
#mobile-header .site-branding,
.site-header-main-section-left .site-branding,
.site-header .site-branding {
  position: relative !important;
  display: block !important;
  width: min(${maxW}px, 42vw) !important;
  min-height: ${maxH}px !important;
  max-height: ${maxH}px !important;
  background: url("${safeUrl}") no-repeat left center / contain !important;
}
#masthead .site-branding img,
#masthead .site-branding svg,
#masthead .site-branding .site-title,
#masthead .site-branding .site-title a,
#masthead .site-branding .brand,
#masthead .site-branding .brand * ,
#mobile-header .site-branding img,
#mobile-header .site-branding svg,
#mobile-header .site-branding .site-title,
.site-branding img[src*="/wp-content/themes/"],
.site-branding img.custom-logo {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
  max-width: 1px !important;
  max-height: 1px !important;
  overflow: hidden !important;
  position: absolute !important;
}
.site-branding .custom-logo-link img.custom-logo {
  opacity: 1 !important;
  visibility: visible !important;
  pointer-events: auto !important;
  position: static !important;
  max-width: min(${maxW}px, 42vw) !important;
  max-height: ${maxH}px !important;
  width: auto !important;
  height: auto !important;
}
header.main-header .logo-box .logo a,
.mobile-menu .nav-logo a,
footer .footer-logo a {
  background: url("${safeUrl}") no-repeat left center / contain !important;
  display: inline-block !important;
  width: min(${maxW}px, 42vw) !important;
  min-height: ${maxH}px !important;
  height: ${maxH}px !important;
}
header.main-header .logo-box .logo img,
.mobile-menu .nav-logo img,
footer .footer-logo img {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
  max-width: 1px !important;
  max-height: 1px !important;
  overflow: hidden !important;
  position: absolute !important;
}
`;
  return `/* wp-bot-header-logo */
${demoOverride ?? ""}
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
.site-branding .custom-logo-link {
  display: inline-block;
  line-height: 0;
}
.site-branding:has(.custom-logo-link) .site-title,
.site-branding:has(img.custom-logo) .site-title,
header.site-header .site-branding .site-title {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}
.site-branding .site-title {
  font-size: clamp(0.85rem, 2vw, 1.05rem);
  line-height: 1.2;
}
.site-header .main-navigation,
.site-header nav.primary-navigation,
.site-header #site-navigation,
.site-header .header-navigation {
  display: flex !important;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 1.25rem;
}
.site-header .main-navigation ul.menu,
.site-header nav.primary-navigation ul {
  display: flex !important;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 1.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.site-branding .site-description {
  font-size: 0.75rem;
}`;
}

export const HEADER_LOGO_CSS_MARKER = "/* wp-bot-header-logo */";
