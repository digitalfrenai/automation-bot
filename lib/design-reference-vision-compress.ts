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

async function compressOneForVision(
  buffer: Buffer,
  mimeType: string
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
    if (buffer.length <= visionMaxBytesPerImage()) {
      return { buffer, mimeType };
    }
    throw new Error(
      "Reference screenshot is too large for Grok vision and image compression (sharp) is unavailable."
    );
  }

  const maxW = visionMaxWidth();
  let quality = 82;
  let out = await sharp(buffer, { animated: false })
    .rotate()
    .resize(maxW, 12_000, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  const maxPer = visionMaxBytesPerImage();
  while (out.length > maxPer && quality > 45) {
    quality -= 12;
    out = await sharp(out).jpeg({ quality, mozjpeg: true }).toBuffer();
  }

  if (out.length > maxPer) {
    out = await sharp(out)
      .resize(Math.floor(maxW * 0.75), 9_000, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 58, mozjpeg: true })
      .toBuffer();
  }

  if (out.length > maxPer) {
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

  for (const item of items) {
    const compressed = await compressOneForVision(item.buffer, item.mimeType);
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
