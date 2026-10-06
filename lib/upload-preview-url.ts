/** Stored DB paths like /uploads/logos/foo.png — served via API when not in public/. */
export function uploadPreviewUrl(storedPath: string): string {
  const p = storedPath.trim();
  if (!p) return p;
  if (/^https?:\/\//i.test(p)) return p;

  const logos = p.match(/^\/uploads\/logos\/([^/]+)$/i);
  if (logos?.[1]) return `/api/uploads/logos/${encodeURIComponent(logos[1])}`;

  const refs = p.match(/^\/uploads\/design-references\/([^/]+)$/i);
  if (refs?.[1]) return `/api/uploads/design-references/${encodeURIComponent(refs[1])}`;

  return p;
}
