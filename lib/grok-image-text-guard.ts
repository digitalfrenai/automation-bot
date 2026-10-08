import type OpenAI from "openai";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import { createGrokClient, extractJsonObject, GROK_MODEL } from "@/lib/grok-client";
import { createGrokChatCompletion } from "@/lib/grok-request";
import type { GeneratedImage } from "@/lib/grok-images";
import {
  imagePromptPhysicalScene,
  requestGrokImage,
  withImageNoTextRules,
} from "@/lib/grok-images";
import { loadSharp } from "@/lib/load-sharp";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import type { PipelinePhase } from "@/lib/pipeline-types";

function imageTextCheckEnabled(): boolean {
  const flag = process.env.GROK_IMAGE_TEXT_CHECK?.trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "no";
}

function maxTextGuardAttempts(): number {
  const n = Number(process.env.GROK_IMAGE_TEXT_MAX_ATTEMPTS ?? "3");
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(5, Math.floor(n));
}

async function visionDataUrl(buffer: Buffer, mimeType: string): Promise<string> {
  try {
    const sharp = await loadSharp();
    const jpeg = await sharp(buffer)
      .rotate()
      .resize(768, 768, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }
}

export async function imageBufferHasVisibleText(
  config: LoadedSiteConfig,
  buffer: Buffer,
  mimeType: string,
  client?: OpenAI
): Promise<{ hasText: boolean; detected?: string }> {
  const c = client ?? createGrokClient(config);
  const dataUrl = await visionDataUrl(buffer, mimeType);
  const completion = await createGrokChatCompletion(
    c,
    {
      model: GROK_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are a strict QA checker for marketing website photos.
Does this image contain ANY visible text, letters, numbers, words, captions, titles, UI labels, readable screen content, posters, or logos with letters?
Ignore the task of describing the scene — only detect text baked into the image pixels.
Return JSON only: {"has_visible_text": boolean, "detected_text": "short quote of what you see or empty string"}`,
            },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "low" },
            },
          ],
        },
      ],
    },
    { label: "Image visible-text check" }
  );

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) return { hasText: false };
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as {
      has_visible_text?: boolean;
      detected_text?: string;
    };
    const detected =
      typeof parsed.detected_text === "string" ? parsed.detected_text.trim() : "";
    return {
      hasText: Boolean(parsed.has_visible_text),
      detected: detected || undefined,
    };
  } catch {
    return { hasText: false };
  }
}

function retryPromptForAttempt(basePrompt: string, attempt: number): string {
  if (attempt <= 0) return basePrompt;
  const minimal = imagePromptPhysicalScene({ slotHint: basePrompt });
  const extra =
    attempt === 1
      ? " No equipment labels, no shelf tags, no monitor screens facing camera."
      : " Blank walls, equipment backs toward camera, no screens, no packaging, no papers.";
  return withImageNoTextRules(`${minimal} ${extra}`);
}

export async function generateGrokImageWithTextGuard(
  config: LoadedSiteConfig,
  prompt: string,
  options?: {
    aspectRatio?: string;
    client?: OpenAI;
    onLog?: LogSink;
    logMeta?: { phase?: PipelinePhase; pageTitle?: string; slotId?: string };
  }
): Promise<GeneratedImage> {
  const client = options?.client ?? createGrokClient(config);
  const log = createPipelineLogger(options?.onLog ?? (() => undefined));
  const attempts = imageTextCheckEnabled() ? maxTextGuardAttempts() : 1;
  let last: GeneratedImage | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const scenePrompt =
      attempt === 0
        ? prompt
        : retryPromptForAttempt(prompt, attempt);
    const generated = await requestGrokImage(
      client,
      scenePrompt,
      options?.aspectRatio
    );
    last = generated;

    if (!imageTextCheckEnabled()) return generated;

    const check = await imageBufferHasVisibleText(
      config,
      generated.buffer,
      generated.mimeType,
      client
    );
    if (!check.hasText) return generated;

    log.warn(
      `Rejected generated image: visible text${check.detected ? ` ("${check.detected.slice(0, 80)}")` : ""}. Retry ${attempt + 1}/${attempts}…`,
      {
        phase: options?.logMeta?.phase,
        pageTitle: options?.logMeta?.pageTitle,
      }
    );
  }

  if (last) {
    log.warn(
      "Using last generated image after text-check retries (model kept adding text). Consider replacing manually in WordPress.",
      { phase: options?.logMeta?.phase, pageTitle: options?.logMeta?.pageTitle }
    );
    return last;
  }

  throw new Error("Image generation failed after text-guard attempts.");
}
