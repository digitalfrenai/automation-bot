import { hasGutenbergBlocks } from "@/lib/gutenberg-content";

const BREAKOUT_STYLE_RE =
  /(100vw|calc\s*\(|margin-\s*left|margin-\s*right|\bwidth\s*:|max-width\s*:\s*100|position\s*:\s*absolute|translatex?\(|left\s*:\s*-?\d)/i;

/**
 * Keeps generated page/post body inside the theme content column.
 * Grok and reference templates often emit alignfull / 100vw breakout CSS that overflows Astra-style layouts.
 */
export function normalizeContentBounds(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return trimmed;

  let out = stripBreakoutInlineStyles(trimmed);
  out = demoteFullWidthAlignment(out);
  if (hasGutenbergBlocks(out)) {
    out = normalizeGroupBlockComments(out);
  }
  return cleanupClasses(out);
}

function stripBreakoutInlineStyles(html: string): string {
  return html.replace(/\sstyle=(["'])([\s\S]*?)\1/gi, (full, quote, css: string) => {
    if (!BREAKOUT_STYLE_RE.test(css)) {
      return full;
    }
    const kept = css
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((prop) => {
        const name = prop.split(":")[0]?.trim().toLowerCase() ?? "";
        if (!name) return false;
        if (/^(width|max-width|min-width|margin|margin-left|margin-right|position|left|right|transform)$/.test(name)) {
          return false;
        }
        return true;
      })
      .join("; ");
    if (!kept) return "";
    return ` style=${quote}${kept}${quote}`;
  });
}

function demoteFullWidthAlignment(html: string): string {
  let out = html;
  out = out.replace(/"align"\s*:\s*"(full|wide)"/gi, '"align":""');
  out = out.replace(/,?\s*"align"\s*:\s*""/g, "");
  out = out.replace(/\balignfull\b/gi, "");
  out = out.replace(/\balignwide\b/gi, "");
  out = out.replace(/\bis-layout-flow\b/gi, "");
  return out;
}

/** Force wp:group blocks to constrained layout (safe inside .entry-content). */
function normalizeGroupBlockComments(html: string): string {
  return html.replace(
    /<!--\s*wp:group\s+(\{[\s\S]*?\})\s*-->/gi,
    (_match, jsonBlob: string) => {
      let json = jsonBlob.trim();
      try {
        const obj = JSON.parse(json) as Record<string, unknown>;
        delete obj.align;
        const layout = obj.layout;
        if (layout && typeof layout === "object" && !Array.isArray(layout)) {
          (layout as Record<string, unknown>).type = "constrained";
        } else {
          obj.layout = { type: "constrained" };
        }
        json = JSON.stringify(obj);
      } catch {
        json = json
          .replace(/"align"\s*:\s*"(full|wide)"/gi, "")
          .replace(/,?\s*"align"\s*:\s*""/g, "")
          .replace(
            /"layout"\s*:\s*\{[^}]*\}/i,
            '"layout":{"type":"constrained"}'
          );
      }
      return `<!-- wp:group ${json} -->`;
    }
  );
}

function cleanupClasses(html: string): string {
  return html.replace(/\sclass="([^"]*)"/gi, (_m, cls: string) => {
    const normalized = cls
      .split(/\s+/)
      .filter(Boolean)
      .filter((c: string) => !/^align(full|wide)$/i.test(c))
      .join(" ");
    return normalized ? ` class="${normalized}"` : "";
  });
}
