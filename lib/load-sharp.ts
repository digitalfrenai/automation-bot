/**
 * sharp 0.34 (lockfile / Docker) is `export =`.
 * sharp 0.35 also exposes a default export.
 * Dynamic import() is one or the other depending on the installed version.
 */

type SharpOutput = {
  rotate(): SharpOutput;
  resize(width?: number, height?: number, options?: object): SharpOutput;
  jpeg(options?: object): SharpOutput;
  png(options?: object): SharpOutput;
  ensureAlpha(): SharpOutput;
  raw(): SharpOutput;
  metadata(): Promise<{ width?: number; height?: number }>;
  toBuffer(): Promise<Buffer>;
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Buffer;
    info: { channels: number };
  }>;
};

export type SharpFactory = (
  input?: Buffer,
  options?: { animated?: boolean; density?: number }
) => SharpOutput;

export async function loadSharp(): Promise<SharpFactory> {
  const mod = (await import("sharp")) as unknown as
    | SharpFactory
    | { default?: SharpFactory };
  if (typeof mod === "function") return mod;
  if (typeof mod.default === "function") return mod.default;
  throw new Error("sharp did not export a function");
}
