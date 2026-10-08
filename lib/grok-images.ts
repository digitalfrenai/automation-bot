import type OpenAI from "openai";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import { createGrokClient } from "@/lib/grok-client";

export const XAI_IMAGE_MODEL =
  process.env.XAI_IMAGE_MODEL?.trim() || "grok-imagine-image";

export type GeneratedImage = {
  buffer: Buffer;
  mimeType: string;
  revisedPrompt?: string;
};

/** Appended to every Imagine prompt — models often render garbled copy from long titles. */
export const IMAGE_NO_TEXT_SUFFIX =
  " CRITICAL: The image must contain zero text, typography, letters, numbers, words, captions, signage, UI labels, posters, or watermarks. Pure photography or illustration only—headlines are added separately on the website.";

export function withImageNoTextRules(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.toLowerCase().includes("zero text")) return trimmed;
  return `${trimmed}${IMAGE_NO_TEXT_SUFFIX}`;
}

export function pageImagesEnabled(): boolean {
  const flag = process.env.PAGE_IMAGES_ENABLED?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "no") return false;
  return true;
}

/** When false, only theme demo assets are used (no Grok Imagine). Default: AI fills gaps. */
export function pageImagesUseAi(): boolean {
  const flag = process.env.PAGE_IMAGES_AI?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "no") return false;
  return true;
}

/** Cap AI/theme image uploads per page (screenshot layouts can need many slots). */
export function pageImagesMaxPerPage(): number {
  const n = Number(process.env.PAGE_IMAGES_MAX_PER_PAGE ?? "16");
  if (!Number.isFinite(n) || n < 1) return 16;
  return Math.min(24, Math.floor(n));
}

export async function generateGrokImage(
  config: LoadedSiteConfig,
  prompt: string,
  options?: {
    aspectRatio?: string;
    client?: OpenAI;
  }
): Promise<GeneratedImage> {
  const client = options?.client ?? createGrokClient(config);

  const response = (await client.images.generate({
    model: XAI_IMAGE_MODEL,
    prompt: withImageNoTextRules(prompt),
    n: 1,
    response_format: "b64_json",
    ...(options?.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
  } as Parameters<OpenAI["images"]["generate"]>[0])) as {
    data?: Array<{
      b64_json?: string;
      mime_type?: string;
      revised_prompt?: string;
    }>;
  };

  const item = response.data?.[0];
  if (!item?.b64_json) {
    throw new Error("xAI image generation returned no image data.");
  }

  const mimeType =
    typeof (item as { mime_type?: string }).mime_type === "string" &&
    (item as { mime_type?: string }).mime_type?.trim()
      ? (item as { mime_type: string }).mime_type
      : "image/png";

  return {
    buffer: Buffer.from(item.b64_json, "base64"),
    mimeType,
    revisedPrompt:
      typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
  };
}
