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

export function wpImageHtmlFromMedia(
  media: { id: number; source_url: string },
  alt: string,
  extraClass = ""
): string {
  const safeAlt = escapeHtml(alt);
  const id = media.id;
  const url = media.source_url.replace(/"/g, "&quot;");
  const cls = ["wp-image-" + id, extraClass].filter(Boolean).join(" ");
  return `<img src="${url}" alt="${safeAlt}" class="${cls}" data-id="${id}"/>`;
}

/** Core image block bound to a Media Library attachment (renders on Kadence / block themes). */
export function wpImageBlockFromMedia(
  media: { id: number; source_url: string },
  alt: string
): string {
  const id = media.id;
  const img = wpImageHtmlFromMedia(media, alt);
  return `<!-- wp:image {"id":${id},"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large">${img}</figure>
<!-- /wp:image -->`;
}

/** When true (default), page images are inserted as wp:image blocks instead of raw <figure> HTML. */
export function preferBlockEditorPageImages(): boolean {
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

function imageBlockFromImgMarkup(tag: string): string {
  const srcMatch = tag.match(/\bsrc=(["'])(.*?)\1/i);
  const altMatch = tag.match(/\balt=(["'])(.*?)\1/i);
  const classMatch = tag.match(/\bclass=(["'])(.*?)\1/i);
  const src = srcMatch?.[2]?.trim() ?? "";
  const alt = altMatch?.[2] ?? "";
  const idFromClass = classMatch?.[2]?.match(/wp-image-(\d+)/i);
  const idAttr = tag.match(/\bdata-id=(["']?)(\d+)\1/i);
  const id = Number(idFromClass?.[1] || idAttr?.[2] || 0);
  if (id > 0 && src) {
    return wpImageBlockFromMedia({ id, source_url: src }, alt || "Image");
  }
  const safeSrc = src.replace(/"/g, "&quot;");
  const safeAlt = escapeHtml(alt);
  return `<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="${safeSrc}" alt="${safeAlt}"/></figure>
<!-- /wp:image -->`;
}

function paragraphsFromHtml(fragment: string): string[] {
  const out: string[] = [];
  const tokenRe = /(<figure\b[\s\S]*?<\/figure>)|(<img\b[^>]*>)/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(fragment))) {
    const before = fragment.slice(last, m.index);
    out.push(...textChunksToBlocks(before));
    const figure = m[1];
    const img = m[2];
    if (figure) {
      const innerImg = figure.match(/<img\b[^>]*>/i)?.[0] ?? figure;
      out.push(imageBlockFromImgMarkup(innerImg));
    } else if (img) {
      out.push(imageBlockFromImgMarkup(img));
    }
    last = m.index + m[0].length;
  }
  out.push(...textChunksToBlocks(fragment.slice(last)));
  return out.filter(Boolean);
}

function textChunksToBlocks(fragment: string): string[] {
  const out: string[] = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(fragment))) {
    const inner = m[1].trim();
    if (inner) out.push(paragraphBlock(inner));
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
    const stripped = stripTags(fragment);
    if (stripped) out.push(paragraphBlock(fragment.trim()));
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
