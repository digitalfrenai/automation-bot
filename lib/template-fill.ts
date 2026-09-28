import type { ContentFormat } from "@/lib/content-format";
import { extractJsonObject } from "@/lib/grok-client";

/** Minimum replaceable text regions required to use template-fill. */
export const MIN_TEMPLATE_SLOTS = 3;

const PLACEHOLDER_PREFIX = "__TPL_";
const PLACEHOLDER_SUFFIX = "__";

export type TemplateTextSlot = {
  id: string;
  kind: string;
  /** Plain-text preview for the model (original copy). */
  original: string;
  /** Raw inner HTML before slotting (used if model omits a key). */
  originalRaw: string;
};

export type TemplateFillPlan = {
  template: string;
  slots: TemplateTextSlot[];
};

type InnerMatch = {
  innerStart: number;
  innerEnd: number;
  end: number;
  kind: string;
};

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function collectInnerMatches(markup: string, re: RegExp, kind: string): InnerMatch[] {
  const out: InnerMatch[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup))) {
    const full = m[0];
    const inner = m[m.length - 1] ?? "";
    const innerOffset = full.lastIndexOf(inner);
    if (innerOffset < 0) continue;
    const innerStart = m.index + innerOffset;
    const innerEnd = innerStart + inner.length;
    out.push({
      innerStart,
      innerEnd,
      end: m.index + full.length,
      kind,
    });
  }
  return out;
}

function collectAltMatches(markup: string): InnerMatch[] {
  const out: InnerMatch[] = [];
  const re = /\balt=(["'])([\s\S]*?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup))) {
    const inner = m[2] ?? "";
    const innerStart = m.index + m[0].indexOf(inner);
    const innerEnd = innerStart + inner.length;
    out.push({
      innerStart,
      innerEnd,
      end: m.index + m[0].length,
      kind: "alt",
    });
  }
  return out;
}

function innerLooksReplaceable(inner: string, kind: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed) return false;
  if (kind !== "alt" && /<!--\s*\/?wp:/i.test(inner)) return false;
  if (/<(div|section|article|ul|ol|table|form|header|footer|nav)\b/i.test(inner)) {
    return false;
  }
  const plain = stripTags(inner);
  if (!plain || plain.length < 2) return false;
  if (/^[\d\s.,]+$/.test(plain)) return false;
  return true;
}

function dedupeNonOverlapping(matches: InnerMatch[], markup: string): InnerMatch[] {
  const sorted = [...matches].sort((a, b) => a.innerStart - b.innerStart);
  const kept: InnerMatch[] = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.innerStart < lastEnd) continue;
    const inner = markup.slice(m.innerStart, m.innerEnd);
    if (!innerLooksReplaceable(inner, m.kind)) continue;
    kept.push(m);
    lastEnd = m.end;
  }
  return kept;
}

/**
 * Replace visible text inside theme markup with stable placeholders; structure/classes stay fixed.
 */
export function extractTemplateFillPlan(markup: string): TemplateFillPlan {
  const source = markup.trim();
  if (!source) {
    return { template: "", slots: [] };
  }

  const matches = dedupeNonOverlapping(
    [
      ...collectInnerMatches(
        source,
        /<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi,
        "heading"
      ),
      ...collectInnerMatches(source, /<p\b([^>]*)>([\s\S]*?)<\/p>/gi, "paragraph"),
      ...collectInnerMatches(source, /<li\b([^>]*)>([\s\S]*?)<\/li>/gi, "list_item"),
      ...collectInnerMatches(
        source,
        /<a\b([^>]*(?:wp-block-button__link|\bbtn\b|\bbutton\b)[^>]*)>([\s\S]*?)<\/a>/gi,
        "button"
      ),
      ...collectInnerMatches(
        source,
        /<figcaption\b([^>]*)>([\s\S]*?)<\/figcaption>/gi,
        "caption"
      ),
      ...collectAltMatches(source),
    ],
    source
  );

  const slots: TemplateTextSlot[] = matches.map((m, i) => {
    const raw = source.slice(m.innerStart, m.innerEnd);
    return {
      id: `slot_${i}`,
      kind: m.kind,
      original: stripTags(raw).slice(0, 280),
      originalRaw: raw,
    };
  });

  let template = source;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    const id = slots[i]!.id;
    const placeholder = `${PLACEHOLDER_PREFIX}${id}${PLACEHOLDER_SUFFIX}`;
    template =
      template.slice(0, m.innerStart) + placeholder + template.slice(m.innerEnd);
  }

  return { template, slots };
}

export function canUseTemplateFill(
  format: ContentFormat,
  markup: string | undefined | null
): boolean {
  if (format !== "gutenberg" && format !== "html") return false;
  if (!markup?.trim() || markup.trim().length < 200) return false;
  return true;
}

export function buildTemplateFillSystemPrompt(
  format: ContentFormat,
  themeGuide: string,
  templateSource: string
): string {
  const formatNote =
    format === "gutenberg"
      ? "The template uses Gutenberg block comments and HTML — you must NOT change structure, only text values in replacements."
      : "The template is HTML with theme classes — only replace human-readable text.";

  return `You are a conversion copywriter for WordPress page content.
Return ONLY a JSON object (no markdown fences):
{
  "replacements": {
    "slot_0": "new plain text for that slot",
    "slot_1": "..."
  }
}

CRITICAL — template-fill mode:
- The page layout, HTML tags, Gutenberg block comments, CSS classes, and nesting are FIXED.
- You ONLY supply new text for each slot id listed in the user message.
- Include EVERY slot id from the catalog — no omissions.
- Values must be plain text (no HTML tags, no markdown).
- Do not use pipe characters (|) in headings.
- Match the business brief, page purpose, tone, and keywords naturally.
- CTAs: short action phrases. Headings: concise. Paragraphs: full sentences.
- The theme already renders header, navigation, and footer — copy is body-only.

${formatNote}

${themeGuide}

Template origin: ${templateSource}`;
}

export function buildTemplateFillUserPrompt(
  pageTitle: string,
  brief: {
    businessName: string;
    niche: string;
    targetAudience: string;
    toneOfVoice: string;
    coreServices: string[];
    targetKeywords: string[];
  },
  slots: TemplateTextSlot[],
  pageNotes?: string
): string {
  const catalog = slots.map((s) => ({
    id: s.id,
    kind: s.kind,
    original: s.original,
  }));

  return `Page title / purpose: "${pageTitle}"
${pageNotes ?? ""}

Business name: ${brief.businessName}
Industry / niche: ${brief.niche}
Target audience: ${brief.targetAudience}
Tone: ${brief.toneOfVoice}
Core services: ${brief.coreServices.join(", ") || "N/A"}
Keywords (natural use): ${brief.targetKeywords.join(", ") || "N/A"}

Replace ALL placeholder slots with new copy for this page. The first heading slot should read as the on-page H1 for "${pageTitle}" (compelling, no SEO pipe titles).

Slot catalog (write new text for each id):
${JSON.stringify(catalog, null, 2)}`;
}

export function parseTemplateFillReplacements(
  raw: string,
  slots: TemplateTextSlot[]
): Record<string, string> {
  const jsonText = extractJsonObject(raw.trim());
  const parsed = JSON.parse(jsonText) as { replacements?: Record<string, unknown> };
  const fromModel = parsed.replacements;
  if (!fromModel || typeof fromModel !== "object") {
    throw new Error("Template-fill JSON missing replacements object.");
  }

  const out: Record<string, string> = {};
  for (const slot of slots) {
    const value = fromModel[slot.id];
    if (typeof value === "string" && value.trim()) {
      out[slot.id] = value.trim();
    } else {
      out[slot.id] = stripTags(slot.originalRaw) || slot.original;
    }
  }
  return out;
}

export function applyTemplateFillReplacements(
  plan: TemplateFillPlan,
  replacements: Record<string, string>
): string {
  let html = plan.template;
  for (const slot of plan.slots) {
    const placeholder = `${PLACEHOLDER_PREFIX}${slot.id}${PLACEHOLDER_SUFFIX}`;
    const text = replacements[slot.id] ?? stripTags(slot.originalRaw) ?? slot.original;
    const encoded =
      slot.kind === "alt" ? escapeAttr(text) : escapeHtml(text);
    if (!html.includes(placeholder)) {
      throw new Error(`Template missing placeholder ${slot.id}.`);
    }
    html = html.split(placeholder).join(encoded);
  }
  return html;
}

export function mergeTemplateFillResponse(
  raw: string,
  plan: TemplateFillPlan
): string {
  const replacements = parseTemplateFillReplacements(raw, plan.slots);
  return applyTemplateFillReplacements(plan, replacements);
}
