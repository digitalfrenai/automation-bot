/** Shared page/post copy structure for builder backends (Elementor, Divi). */

export type PageSectionKind =
  | "hero"
  | "content"
  | "features"
  | "cta"
  | "faq"
  | "trust";

export type PageSection = {
  kind: PageSectionKind;
  heading?: string;
  subheading?: string;
  /** HTML allowed: <p>, <ul>, <ol>, <strong> — no h1/h2 here (use heading fields). */
  body_html?: string;
  button_text?: string;
  button_url?: string;
  items?: Array<{ title: string; text: string }>;
  /** Filled after AI image upload (Phase 2 enrichment). */
  image_url?: string;
  image_alt?: string;
  image_media_id?: number;
};

export type StructuredPagePayload = {
  sections: PageSection[];
};

export function buildStructuredPageJsonPrompt(contentKind: "page" | "post"): string {
  return `You are a WordPress ${contentKind} copywriter.
Return ONLY a JSON object (no markdown fences):
{
  "sections": [
    {
      "kind": "hero" | "content" | "features" | "cta" | "faq" | "trust",
      "heading": "string",
      "subheading": "optional string",
      "body_html": "optional HTML fragment with <p>, <ul>, <ol> only",
      "button_text": "optional",
      "button_url": "optional relative path like /contact",
      "items": [{ "title": "string", "text": "string" }]
    }
  ]
}

Rules:
- No site header, footer, or navigation — theme supplies chrome.
- Exactly one section should use kind "hero" with the primary H1 in "heading" (pages) or use hero heading as post title context (posts may skip hero).
- Use 4–8 sections for landing pages; 3–5 for inner pages; posts use "content" sections with headings as H2 topics.
- body_html must not contain <h1>–<h3> tags (use heading/subheading fields).
- CTAs use kind "cta" with button_text and button_url.
- FAQ uses kind "faq" with items array.
- features/trust use items or body_html.
- Write specific, conversion-focused copy for the business brief.`;
}

export function parseStructuredPagePayload(text: string): StructuredPagePayload {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const jsonText = fenced?.[1]?.trim() ?? trimmed;
  const parsed = JSON.parse(jsonText) as StructuredPagePayload;
  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error("Structured content JSON missing sections array.");
  }
  return {
    sections: parsed.sections.filter(
      (s) => s && typeof s.kind === "string" && s.kind.trim()
    ) as PageSection[],
  };
}
