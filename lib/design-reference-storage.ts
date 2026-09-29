import fs from "fs/promises";
import path from "path";

export function getDesignReferenceUploadDir(): string {
  const configured = process.env.UPLOAD_DESIGN_REFERENCES_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), "public", "uploads", "design-references");
}

export function designReferencePublicPathForFilename(filename: string): string {
  return `/uploads/design-references/${filename}`;
}

export function resolveStoredDesignReferencePath(publicPath: string): string {
  const normalized = publicPath.replace(/^\/+/, "");
  const filename = path.basename(normalized);
  return path.join(getDesignReferenceUploadDir(), filename);
}

export async function readStoredDesignReferenceFile(publicPath: string): Promise<{
  buffer: Buffer;
  mimeType: string;
  filename: string;
}> {
  const absolute = resolveStoredDesignReferencePath(publicPath);
  const buffer = await fs.readFile(absolute);
  const filename = path.basename(absolute);
  const ext = path.extname(filename).toLowerCase();
  const mimeType =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : "image/jpeg";
  return { buffer, mimeType, filename };
}
