import OpenAI from "openai";
import type { LoadedSiteConfig } from "@/lib/config-loader";

/** Default chat model for content + SEO. Override with XAI_MODEL in .env */
export const GROK_MODEL = process.env.XAI_MODEL?.trim() || "grok-4.6";

export function grokTimeoutMs(): number {
  const n = Number(process.env.XAI_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 60_000) return Math.floor(n);
  return 900_000;
}

type UndiciFetch = (
  input: RequestInfo | URL,
  init?: RequestInit & { dispatcher?: unknown }
) => Promise<Response>;

let longFetch: UndiciFetch | null = null;

/**
 * Node's built-in fetch aborts quiet responses after 5 minutes (headersTimeout).
 * Screenshot vision calls often run longer than that.
 */
async function fetchWithExtendedTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (!longFetch) {
    const specifier = "undici";
    const undici = (await import(specifier)) as {
      Agent: new (opts: {
        headersTimeout: number;
        bodyTimeout: number;
        connectTimeout: number;
      }) => unknown;
      fetch: UndiciFetch;
    };
    const timeoutMs = grokTimeoutMs();
    const dispatcher = new undici.Agent({
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connectTimeout: 30_000,
    });
    const undiciFetch = undici.fetch;
    longFetch = (url, nextInit) =>
      undiciFetch(url, { ...nextInit, dispatcher });
  }
  try {
    return await longFetch(input, init);
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    return fetch(input, init);
  }
}

export function createGrokClient(config: LoadedSiteConfig): OpenAI {
  if (!config.xaiApiKey.trim()) {
    throw new Error("xAI API key is missing from site configuration.");
  }

  const timeoutMs = grokTimeoutMs();

  return new OpenAI({
    apiKey: config.xaiApiKey,
    baseURL: "https://api.x.ai/v1",
    timeout: timeoutMs,
    maxRetries: 0,
    fetch: fetchWithExtendedTimeout,
  });
}

export function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error("Could not locate JSON object in Grok response.");
}
