/**
 * Import images from a public Google Drive folder (no OAuth).
 * Set GOOGLE_DRIVE_API_KEY for reliable listing; otherwise uses HTML fallback.
 */

const IMAGE_MIME_HINTS = /\.(jpe?g|png|gif|webp)(\?|$)/i;

export function extractGoogleDriveFolderId(url: string): string | null {
  const trimmed = url.trim();
  const m =
    trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/) ||
    trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? null;
}

type DriveFile = { id: string; name: string; mimeType?: string };

async function listViaApi(
  folderId: string,
  apiKey: string,
  maxFiles: number
): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent("files(id,name,mimeType)");
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=${Math.min(maxFiles, 100)}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) {
    throw new Error(`Google Drive API list failed (${res.status}).`);
  }
  const data = (await res.json()) as { files?: DriveFile[] };
  const files = data.files ?? [];
  return files
    .filter(
      (f) =>
        (f.mimeType && f.mimeType.startsWith("image/")) ||
        IMAGE_MIME_HINTS.test(f.name)
    )
    .slice(0, maxFiles);
}

async function listViaHtml(folderId: string, maxFiles: number): Promise<DriveFile[]> {
  const url = `https://drive.google.com/drive/folders/${folderId}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; WordPressAutomationBot/1.0; +https://github.com/)",
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    throw new Error(`Could not open Drive folder (${res.status}).`);
  }
  const html = await res.text();
  const ids = new Set<string>();
  const re = /\/file\/d\/([a-zA-Z0-9_-]{20,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && ids.size < maxFiles) {
    ids.add(m[1]!);
  }
  return [...ids].slice(0, maxFiles).map((id, i) => ({
    id,
    name: `drive-image-${i + 1}.jpg`,
    mimeType: "image/jpeg",
  }));
}

export async function listDriveFolderImages(
  folderUrl: string,
  maxFiles: number
): Promise<DriveFile[]> {
  const folderId = extractGoogleDriveFolderId(folderUrl);
  if (!folderId) {
    throw new Error("Invalid Google Drive folder URL.");
  }
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY?.trim();
  if (apiKey) {
    try {
      const listed = await listViaApi(folderId, apiKey, maxFiles);
      if (listed.length > 0) return listed;
    } catch {
      /* fall through */
    }
  }
  const htmlListed = await listViaHtml(folderId, maxFiles);
  if (htmlListed.length === 0) {
    throw new Error(
      "No images found in Drive folder. Ensure the folder is public, or set GOOGLE_DRIVE_API_KEY."
    );
  }
  return htmlListed;
}

export async function downloadDriveFile(fileId: string): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  const url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; WordPressAutomationBot/1.0)",
    },
  });
  if (!res.ok) {
    throw new Error(`Drive download failed for ${fileId} (${res.status}).`);
  }
  const contentType =
    res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 512) {
    throw new Error(`Drive file ${fileId} looks empty or blocked.`);
  }
  return { buffer, mimeType: contentType };
}