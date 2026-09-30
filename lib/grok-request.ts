import type OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { grokTimeoutMs } from "@/lib/grok-client";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message && cause.message !== err.message) {
    const code = (cause as { code?: string }).code;
    return `${err.message} (${code ? `${code}: ` : ""}${cause.message})`;
  }
  return err.message;
}

function errorStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: number }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function isRetryableGrokError(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  const status = errorStatus(err);
  return (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("auth context expired") ||
    message.includes("connection error") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("eai_again") ||
    message.includes("socket") ||
    message.includes("fetch failed") ||
    (err instanceof Error && err.name === "APIConnectionError") ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 500
  );
}

export async function createGrokChatCompletion(
  client: OpenAI,
  params: ChatCompletionCreateParamsNonStreaming,
  options?: {
    label?: string;
    onLog?: LogSink;
    maxAttempts?: number;
  }
) {
  const log = createPipelineLogger(options?.onLog ?? (() => undefined));
  const maxAttempts = options?.maxAttempts ?? 3;
  const label = options?.label ?? "Grok request";

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await client.chat.completions.create(params, {
        timeout: grokTimeoutMs(),
      });
    } catch (err) {
      lastError = err;
      const retryable = isRetryableGrokError(err);
      if (!retryable || attempt === maxAttempts) {
        const detail = errorMessage(err);
        throw new Error(`${label} failed: ${detail}`);
      }

      const waitMs = attempt * 5000;
      const detail = errorMessage(err);
      const hint =
        detail.toLowerCase().includes("auth context expired")
          ? " (often caused by oversized screenshots — images are auto-compressed; retrying)"
          : "";
      log.warn(
        `${label} failed (${detail})${hint}. Retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${maxAttempts})…`,
        { phase: "phase2" }
      );
      await sleep(waitMs);
    }
  }

  throw lastError;
}
