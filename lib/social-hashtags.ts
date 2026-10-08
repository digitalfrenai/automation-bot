export function normalizeHashtag(tag: string): string {
  const cleaned = tag.replace(/^#+/, "").replace(/\s+/g, "").trim();
  return cleaned ? `#${cleaned}` : "";
}

export function mergeSocialHashtags(
  generated: string[],
  blogTags: string[],
  minCount = 3
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const tag = normalizeHashtag(raw);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  };

  for (const tag of blogTags) push(tag);
  for (const tag of generated) push(tag);

  if (out.length < minCount) {
    for (const tag of generated) {
      push(tag);
      if (out.length >= minCount) break;
    }
  }

  return out.slice(0, 12);
}
