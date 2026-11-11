/** Resize/compress reference screenshots before Grok vision (xAI rejects oversized payloads with misleading 500 errors). */

import { loadSharp, type SharpFactory } from "@/lib/load-sharp";

function visionMaxWidth(): number {
  const n = Number(process.env.DESIGN_REFERENCE_VISION_MAX_WIDTH ?? "1400");
  return Number.isFinite(n) && n >= 640 ? Math.floor(n) : 1400;
}

function visionMaxBytesPerImage(): number {
  const n = Number(process.env.DESIGN_REFERENCE_VISION_MAX_BYTES ?? "450000");
  return Number.isFinite(n) && n > 50_000 ? Math.floor(n) : 450_000;
}

function visionMaxTotalBytes(): number {
  const n = Number(process.env.DESIGN_REFERENCE_VISION_TOTAL_BYTES ?? "2400000");
  return Number.isFinite(n) && n > 200_000 ? Math.floor(n) : 2_400_000;
}

/** Share the vision payload budget so 12 screenshots still fit the request limit. */
function visionBytesForImage(imageCount: number): number {
  const share = Math.floor(visionMaxTotalBytes() / Math.max(1, imageCount));
  return Math.max(80_000, Math.min(visionMaxBytesPerImage(), share));
}

async function compressOneForVision(
  buffer: Buffer,
  mimeType: string,
  maxBytes: number
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (mimeType.includes("svg")) {
    throw new Error(
      "SVG reference screenshots are not supported for Grok vision — use PNG or JPG."
    );
  }

  let sharp: SharpFactory;
  try {
    sharp = await loadSharp();
  } catch {
    if (buffer.length <= maxBytes) {
      return { buffer, mimeType };
    }
    throw new Error(
      "Reference screenshot is too large for Grok vision and image compression (sharp) is unavailable."
    );
  }

  let width = visionMaxWidth();
  let quality = 82;
  const encode = (w: number, q: number) =>
    sharp(buffer, { animated: false })
      .rotate()
      .resize(w, 12_000, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: q, mozjpeg: true })
      .toBuffer();

  let out = await encode(width, quality);

  while (out.length > maxBytes && quality > 46) {
    quality -= 12;
    out = await encode(width, quality);
  }

  while (out.length > maxBytes && width > 720) {
    width = Math.floor(width * 0.8);
    quality = 58;
    out = await encode(width, quality);
  }

  if (out.length > maxBytes) {
    throw new Error(
      `Reference screenshot still too large after compression (${Math.round(out.length / 1024)}KB). Crop or upload a smaller image.`
    );
  }

  return { buffer: out, mimeType: "image/jpeg" };
}

export async function prepareDesignReferenceBuffersForVision(
  items: Array<{ buffer: Buffer; mimeType: string; filename: string }>
): Promise<Array<{ buffer: Buffer; mimeType: string; filename: string }>> {
  const prepared: Array<{ buffer: Buffer; mimeType: string; filename: string }> =
    [];
  let totalBytes = 0;
  const maxTotal = visionMaxTotalBytes();
  const perImage = visionBytesForImage(items.length);

  for (const item of items) {
    const compressed = await compressOneForVision(
      item.buffer,
      item.mimeType,
      perImage
    );
    if (totalBytes + compressed.buffer.length > maxTotal) {
      throw new Error(
        `Total reference screenshot size exceeds Grok vision limit (~${Math.round(maxTotal / 1024 / 1024)}MB). Remove some screenshots or use smaller captures.`
      );
    }
    totalBytes += compressed.buffer.length;
    prepared.push({
      buffer: compressed.buffer,
      mimeType: compressed.mimeType,
      filename: item.filename,
    });
  }

  return prepared;
}
