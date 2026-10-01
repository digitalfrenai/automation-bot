import type { PipelineLogEntry } from "@/lib/pipeline-types";

export type SseEvent =
  | PipelineLogEntry
  | { type: "done" }
  | { type: "error"; message: string };

function sseEncode(entry: SseEvent): string {
  return `data: ${JSON.stringify(entry)}\n\n`;
}

/**
 * Shared SSE wrapper used by Phase 1–3, Phase 4, and Phase 5 pipeline routes.
 */
export function createPipelineSseResponse(
  run: (onLog: (entry: PipelineLogEntry) => void) => Promise<void>
): Response {
  let closed = false;
  let stopHeartbeat: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const closeStream = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* client already disconnected */
        }
      };

      const push = (entry: SseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEncode(entry)));
        } catch {
          closeStream();
        }
      };

      const onLog = (entry: PipelineLogEntry) => {
        push(entry);
      };

      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          closeStream();
        }
      }, 15_000);
      stopHeartbeat = () => clearInterval(heartbeat);

      (async () => {
        try {
          await run(onLog);
          push({ type: "done" });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Pipeline execution failed.";
          push({ type: "error", message });
        } finally {
          closeStream();
        }
      })();
    },
    cancel() {
      closed = true;
      stopHeartbeat?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
