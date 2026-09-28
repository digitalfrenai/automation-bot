/** Short label for WP page title, menus, and breadcrumbs — not SEO meta titles. */
export function pageDisplayTitle(scaffoldTitle: string): string {
  const t = scaffoldTitle.trim();
  if (!t) return "Page";
  if (t.length <= 48) return t;
  return t.slice(0, 45).trimEnd() + "…";
}

export function navMenuLabel(scaffoldTitle: string): string {
  const t = scaffoldTitle.trim();
  const lower = t.toLowerCase();
  if (lower === "homepage") return "Home";
  return pageDisplayTitle(t);
}
