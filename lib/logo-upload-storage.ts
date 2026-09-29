import fs from "fs/promises";
import path from "path";

export function getLogoUploadDir(): string {
  const configured = process.env.UPLOAD_LOGOS_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), "public", "uploads", "logos");
}

export function resolveStoredLogoPath(businessLogoFilePath: string): string {
  const normalized = businessLogoFilePath.replace(/^\/+/, "");
  const filename = path.basename(normalized);
  return path.join(getLogoUploadDir(), filename);
}

export function logoPublicPathForFilename(filename: string): string {
  return `/uploads/logos/${filename}`;
}

export async function readStoredLogoFile(
  businessLogoFilePath: string
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const absolute = resolveStoredLogoPath(businessLogoFilePath);
  const buffer = await fs.readFile(absolute);
  const filename = path.basename(absolute);
  const ext = path.extname(filename).toLowerCase();
  const mimeType =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".svg"
          ? "image/svg+xml"
          : ext === ".gif"
            ? "image/gif"
            : "image/jpeg";
  return { buffer, mimeType, filename };
}
