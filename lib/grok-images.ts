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

const IMAGE_NO_TEXT_PREFIX =
  "Untitled stock photo. No visible text, letters, numbers, signs, captions, UI, posters, or watermarks anywhere in the image. ";

/** Appended to every Imagine prompt — models often render garbled copy from long titles. */
export const IMAGE_NO_TEXT_SUFFIX =
  " Do not paint or render any words. No readable screens, documents, brochures, or branded signage. Pure scene and objects only—website headlines are HTML overlays, not part of the image.";

/** Short visual hint for prompts — long titles become misspelled text in generated images. */
export function imagePromptVisualSubject(hint: string, maxWords = 10): string {
  const cleaned = hint.replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, maxWords);
  return words.join(" ") || "professional business environment";
}

/** Object-only scene wording — never paste marketing titles (e.g. "3D Scanning Services") into Imagine prompts. */
export function imagePromptPhysicalScene(input: {
  niche?: string;
  coreServices?: string[];
  slotHint?: string;
}): string {
  const haystack = `${input.niche ?? ""} ${input.coreServices?.join(" ") ?? ""} ${input.slotHint ?? ""}`.toLowerCase();
  const props: string[] = [];
  if (/print|filament|fdm|resin|maker|additive/.test(haystack)) {
    props.push("FDM 3D printers on desks", "filament spools on shelves");
  }
  if (/miniature|scale model|figurine|diorama|ship|architectural model|toy/.test(haystack)) {
    props.push("small scale models on a cutting mat", "hand tools beside models");
  }
  if (/scan|laser|metrology|point cloud|lidar/.test(haystack)) {
    props.push("structured-light scanner on a tripod", "blue scanning light on an object in a dark studio");
  }
  if (/workshop|studio|lab|factory|bench/.test(haystack)) {
    props.push("industrial workbench", "organized tool wall");
  }
  if (props.length === 0) {
    props.push("modern workspace", "professional equipment on a table");
  }
  return `Photograph showing only physical objects: ${[...new Set(props)].slice(0, 5).join("; ")}.`;
}

export function withImageNoTextRules(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return IMAGE_NO_TEXT_PREFIX.trim() + IMAGE_NO_TEXT_SUFFIX.trim();
  const lower = trimmed.toLowerCase();
  const hasPrefix = lower.startsWith("untitled stock photo");
  const hasSuffix = lower.includes("do not paint or render any words");
  if (hasPrefix && hasSuffix) return trimmed;
  return `${hasPrefix ? "" : IMAGE_NO_TEXT_PREFIX}${trimmed}${hasSuffix ? "" : IMAGE_NO_TEXT_SUFFIX}`;
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

export async function requestGrokImage(
  client: OpenAI,
  prompt: string,
  aspectRatio?: string
): Promise<GeneratedImage> {
  const response = (await client.images.generate({
    model: XAI_IMAGE_MODEL,
    prompt: withImageNoTextRules(prompt),
    n: 1,
    response_format: "b64_json",
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
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

export async function generateGrokImage(
  config: LoadedSiteConfig,
  prompt: string,
  options?: {
    aspectRatio?: string;
    client?: OpenAI;
    onLog?: import("@/lib/pipeline-logger").LogSink;
    logMeta?: {
      phase?: import("@/lib/pipeline-types").PipelinePhase;
      pageTitle?: string;
      slotId?: string;
    };
  }
): Promise<GeneratedImage> {
  const { generateGrokImageWithTextGuard } = await import("@/lib/grok-image-text-guard");
  return generateGrokImageWithTextGuard(config, prompt, options);
}
