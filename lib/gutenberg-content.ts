const BLOCK_COMMENT_RE = /<!--\s*\/?wp:[\s\S]*?-->/gi;

const SITE_CHROME_SELECTORS = [
  /\b(site-header|main-header|page-header|top-bar|navbar|site-navigation|main-navigation|site-footer|colophon|footer-widgets)\b/i,
];

function looksLikeSiteChrome(openTag: string): boolean {
  return SITE_CHROME_SELECTORS.some((re) => re.test(openTag));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Normalize Gutenberg storage: keep block comments, remove chrome tags. */
export function normalizeGutenbergContent(html: string): string {
  let out = html.trim();

  out = out.replace(/<header\b[\s\S]*?<\/header>/gi, (block) => {
    if (looksLikeSiteChrome(block)) return "";
    return block
      .replace(/<header\b([^>]*)>/i, `<section$1 data-wp-body="header-as-section">`)
      .replace(/<\/header>/i, "</section>");
  });
  out = out.replace(/<footer\b[\s\S]*?<\/footer>/gi, "");
  out = out.replace(/<nav\b[\s\S]*?<\/nav>/gi, "");
  out = out.replace(/<section[^>]*>\s*<\/section>/gi, "");

  return out.trim();
}

export function hasGutenbergBlocks(html: string): boolean {
  return /<!--\s*\/?wp:/i.test(html);
}

/** Core image block bound to a Media Library attachment (renders on Kadence / block themes). */
export function wpImageBlockFromMedia(
  media: { id: number; source_url: string },
  alt: string
): string {
  const safeAlt = escapeHtml(alt);
  const id = media.id;
  const url = media.source_url.replace(/"/g, "&quot;");
  return `<!-- wp:image {"id":${id},"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="${url}" alt="${safeAlt}" class="wp-image-${id}"/></figure>
<!-- /wp:image -->`;
}

/** When true (default), page images are inserted as wp:image blocks instead of raw <figure> HTML. */
export function useBlockEditorImagesForPages(): boolean {
  const flag = process.env.PAGE_IMAGES_HTML_FIGURES?.trim().toLowerCase();
  return !(flag === "1" || flag === "true" || flag === "yes");
}

/** Best-effort HTML → core Gutenberg blocks when the model returns plain HTML. */
export function htmlToGutenbergBlocks(html: string): string {
  const cleaned = normalizeGutenbergContent(html);
  if (hasGutenbergBlocks(cleaned)) {
    return cleaned;
  }

  const blocks: string[] = [];
  const sectionRe = /<section[^>]*>([\s\S]*?)<\/section>/gi;
  let sectionMatch: RegExpExecArray | null;
  let matchedSection = false;

  while ((sectionMatch = sectionRe.exec(cleaned))) {
    matchedSection = true;
    blocks.push(sectionInnerToGroup(sectionMatch[1]));
  }

  if (!matchedSection) {
    blocks.push(sectionInnerToGroup(cleaned));
  }

  return blocks.join("\n\n");
}

function sectionInnerToGroup(inner: string): string {
  const parts: string[] = [];
  const hRe = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = hRe.exec(inner))) {
    const before = inner.slice(lastIndex, m.index).trim();
    if (before) parts.push(...paragraphsFromHtml(before));
    const level = m[1].toLowerCase();
    const text = stripTags(m[2]);
    if (text) {
      parts.push(headingBlock(level, text));
    }
    lastIndex = m.index + m[0].length;
  }

  const tail = inner.slice(lastIndex).trim();
  if (tail) parts.push(...paragraphsFromHtml(tail));

  if (parts.length === 0) {
    parts.push(paragraphBlock(stripTags(inner) || "Content"));
  }

  const innerHtml = parts.join("\n");
  return `<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group">
${innerHtml}
</div>
<!-- /wp:group -->`;
}

function paragraphsFromHtml(fragment: string): string[] {
  const out: string[] = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(fragment))) {
    out.push(paragraphBlock(m[1].trim()));
  }
  const ulRe = /<ul[^>]*>([\s\S]*?)<\/ul>/gi;
  while ((m = ulRe.exec(fragment))) {
    out.push(listBlock(m[1], false));
  }
  const olRe = /<ol[^>]*>([\s\S]*?)<\/ol>/gi;
  while ((m = olRe.exec(fragment))) {
    out.push(listBlock(m[1], true));
  }
  if (out.length === 0 && fragment.trim()) {
    out.push(paragraphBlock(fragment.trim()));
  }
  return out;
}

function headingBlock(level: string, text: string): string {
  const n = level === "h1" ? 1 : level === "h2" ? 2 : 3;
  return `<!-- wp:heading {"level":${n}} -->
<${level} class="wp-block-heading">${escapeHtml(text)}</${level}>
<!-- /wp:heading -->`;
}

function paragraphBlock(html: string): string {
  return `<!-- wp:paragraph -->
<p>${html}</p>
<!-- /wp:paragraph -->`;
}

function listBlock(inner: string, ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => `<li>${m[1].trim()}</li>`)
    .join("\n");
  return `<!-- wp:list -->
<${tag} class="wp-block-list">
${items}
</${tag}>
<!-- /wp:list -->`;
}

/** Plain text-ish HTML for SEO audits from Gutenberg storage. */
export function gutenbergToAuditHtml(storage: string): string {
  return storage
    .replace(BLOCK_COMMENT_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}
