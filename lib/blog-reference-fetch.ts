/** Strip HTML and collapse whitespace for use in Grok prompts (reference article). */
export function extractReadableTextFromHtml(html: string, maxChars = 24_000): string {
  const stripped = html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();
  return stripped.slice(0, maxChars);
}

export async function fetchReferenceArticleText(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Reference blog URL is empty.");
  }

  const res = await fetch(trimmed, {
    headers: {
      "User-Agent":
        "WordPressAutomationBot/1.0 (reference fetch; +https://github.com/)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(60_000),
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Could not fetch reference URL (${res.status} ${res.statusText}).`);
  }

  const html = await res.text();
  const text = extractReadableTextFromHtml(html);
  if (text.length < 200) {
    throw new Error(
      "Reference page returned too little text — check the URL or paywall."
    );
  }
  return text;
}