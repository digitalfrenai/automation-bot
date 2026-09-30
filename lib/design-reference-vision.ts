import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import { readStoredDesignReferenceFile } from "@/lib/design-reference-storage";
import { prepareDesignReferenceBuffersForVision } from "@/lib/design-reference-vision-compress";
import type { ThemeStyleProfile } from "@/lib/theme-style-profile";

export function designReferenceMaxCount(): number {
  const n = Number(process.env.DESIGN_REFERENCE_MAX ?? "6");
  if (!Number.isFinite(n)) return 6;
  return Math.min(12, Math.max(1, Math.floor(n)));
}

export function parseDesignReferencePaths(config: LoadedSiteConfig): string[] {
  return config.designReferencePathsList.filter((p) =>
    p.startsWith("/uploads/design-references/")
  );
}

export function hasDesignReferenceScreenshots(config: LoadedSiteConfig): boolean {
  return parseDesignReferencePaths(config).length > 0;
}

/** No theme zip — reference screenshots drive page layout and styling. */
export function isScreenshotLedDesignMode(config: LoadedSiteConfig): boolean {
  return (
    hasDesignReferenceScreenshots(config) &&
    !config.activeThemeZipPath?.trim()
  );
}

export const DESIGN_REFERENCE_SYSTEM_ADDON = `
DESIGN REFERENCE SCREENSHOTS (vision):
The user attached screenshot(s) of a target website design. Your job is to recreate that look in WordPress page content:
- Match section structure (hero, feature grids, split columns, testimonials, pricing-style blocks, CTAs).
- Match visual rhythm: spacing, heading sizes, card layouts, background bands, button style.
- Use theme CSS classes and palette from the theme guide when they produce a similar effect.
- When the theme lacks an equivalent pattern, use semantic HTML (<section>, columns, cards) and minimal inline style on sections (background-color, padding) — never break out of the content column (no 100vw, no negative margins).
- Do NOT copy text, brand names, logos, or photos from the screenshots — all copy from the business brief; images from theme demo URLs or placeholders until enrichment runs.
- Output must still be valid for the detected content format (Gutenberg blocks, JSON sections, or theme HTML).`;

export const SCREENSHOT_LED_DESIGN_ADDON = `

SCREENSHOT-LED MODE (no theme zip was uploaded):
- The reference screenshots are the PRIMARY and authoritative design — not the active WordPress theme demo.
- Do NOT mirror theme REFERENCE MARKUP or default block patterns; recreate the screenshot layout in HTML.
- Match colors, typography scale, button shapes, card styles, spacing, and section backgrounds as closely as practical using semantic HTML plus inline style on sections, cards, and buttons (background, color, padding, border-radius, box-shadow, display:grid/flex, gap, font-size, text-align).
- CTA buttons must not be cramped: use inline-block or flex-wrap with gap; padding at least 12px 20px; avoid width:100% on paired hero buttons.
- Team/card social icons: 40px circles with inline SVG (Facebook/X/Instagram/LinkedIn). Never output letter labels like "f", "x", or play triangles as social buttons.
- Wrap the page in a single outer <div style="max-width:1200px;margin:0 auto;"> if needed so layout stays inside the editor content column (no 100vw, no negative margins).
- Use https://placehold.co/WxH placeholder images with descriptive alt text until images are enriched — do not embed screenshot photos. Photos must be <img> tags in the layout slot, never CSS background-image.`;

export function designReferenceSystemAddon(config: LoadedSiteConfig): string {
  if (!hasDesignReferenceScreenshots(config)) return "";
  return isScreenshotLedDesignMode(config)
    ? DESIGN_REFERENCE_SYSTEM_ADDON + SCREENSHOT_LED_DESIGN_ADDON
    : DESIGN_REFERENCE_SYSTEM_ADDON;
}

export function formatScreenshotLedThemeGuide(profile: ThemeStyleProfile): string {
  const paletteHint = profile.palette.length
    ? `Live site palette (optional hints only): ${profile.palette
        .slice(0, 8)
        .map((p) => `${p.name} ${p.color}`)
        .join("; ")}`
    : "";
  return `SCREENSHOT-LED DESIGN (no uploaded theme zip):
- Reference screenshots attached to the user message define layout and visual design.
- WordPress renders header, navigation, and footer outside this HTML — output only the page body.
- Build section-based landing page HTML that visually matches the screenshots; inline CSS is expected and encouraged for fidelity.
${paletteHint}`.trim();
}

export function designReferenceUserPreamble(config: LoadedSiteConfig): string {
  if (isScreenshotLedDesignMode(config)) {
    return `No custom theme zip was uploaded — treat the attached screenshot(s) as the full page design spec (layout, colors, components). Recreate that design in HTML for the WordPress content area. Use the business brief for all text only.`;
  }
  return `The attached image(s) show the reference website design to follow (layout + visual style only).

Study them before writing content. Mirror their layout and design language while using the business brief below for all wording.`;
}

export async function loadDesignReferenceImages(
  config: LoadedSiteConfig
): Promise<Array<{ dataUrl: string; name: string }>> {
  const paths = parseDesignReferencePaths(config);
  const raw: Array<{ buffer: Buffer; mimeType: string; filename: string }> =
    [];

  for (const publicPath of paths.slice(0, designReferenceMaxCount())) {
    try {
      const file = await readStoredDesignReferenceFile(publicPath);
      raw.push({
        buffer: file.buffer,
        mimeType: file.mimeType,
        filename: file.filename,
      });
    } catch {
      /* skip missing files */
    }
  }

  if (raw.length === 0) return [];

  const prepared = await prepareDesignReferenceBuffersForVision(raw);
  return prepared.map(({ buffer, mimeType, filename }) => ({
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    name: filename,
  }));
}

export function buildMultimodalUserContent(
  text: string,
  images: Array<{ dataUrl: string; name: string }>
): ChatCompletionContentPart[] {
  const parts: ChatCompletionContentPart[] = [
    { type: "text", text },
  ];

  images.forEach((img, index) => {
    parts.push({
      type: "text",
      text: `Reference screenshot ${index + 1}${img.name ? ` (${img.name})` : ""}:`,
    });
    parts.push({
      type: "image_url",
      image_url: { url: img.dataUrl, detail: "auto" },
    });
  });

  return parts;
}
