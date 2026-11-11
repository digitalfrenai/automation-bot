import fs from "fs/promises";
import path from "path";

const STORED_PREFIX = "/uploads/design-references/";

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

export async function deleteStoredDesignReferenceFiles(
  publicPaths: string[]
): Promise<void> {
  for (const publicPath of publicPaths) {
    if (!publicPath.startsWith(STORED_PREFIX)) continue;
    try {
      await fs.unlink(resolveStoredDesignReferencePath(publicPath));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }
}
