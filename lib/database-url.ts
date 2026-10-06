import fs from "fs";
import path from "path";
import { isRailwayRuntime, migrateEphemeralSqliteIfNeeded } from "@/lib/storage-persistence";

export function resolveDataRoot(): string {
  const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (mount) return mount;
  if (isRailwayRuntime()) return "/data";
  return path.join(process.cwd(), "storage");
}

function sqliteFilePathFromUrl(url: string): string | null {
  if (!url.startsWith("file:")) return null;
  const rest = url.slice("file:".length);
  if (rest.startsWith("/")) return rest;
  if (rest.startsWith("//")) return rest.replace(/^\/+/, "/");
  return path.resolve(process.cwd(), rest);
}

/** Sync: create volume dirs and set DATABASE_URL before PrismaClient is constructed. */
export function ensureServerStorageSync(): string {
  const dataRoot = resolveDataRoot();
  const prismaDir = path.join(dataRoot, "prisma");
  const themesDir = path.join(dataRoot, "uploads", "themes");
  const logosDir = path.join(dataRoot, "uploads", "logos");
  const designRefDir = path.join(dataRoot, "uploads", "design-references");

  fs.mkdirSync(prismaDir, { recursive: true });
  fs.mkdirSync(themesDir, { recursive: true });
  fs.mkdirSync(logosDir, { recursive: true });
  fs.mkdirSync(designRefDir, { recursive: true });

  migrateEphemeralSqliteIfNeeded();

  const dbPath = path.join(prismaDir, "prod.db");
  const url = `file:${dbPath}`;
  process.env.DATABASE_URL = url;
  process.env.UPLOAD_THEMES_DIR = themesDir;
  process.env.UPLOAD_LOGOS_DIR = logosDir;
  process.env.UPLOAD_DESIGN_REFERENCES_DIR = designRefDir;

  return url;
}

/**
 * Ensures SQLite parent dir exists and DATABASE_URL points at the volume in production.
 */
export function prepareDatabaseUrl(): string {
  const onRailway =
    isRailwayRuntime() || Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim());
  let url = process.env.DATABASE_URL?.trim() ?? "";
  if (
    url === "/data" ||
    url === "/data/" ||
    url === "data" ||
    !url.startsWith("file:")
  ) {
    url = "";
  }

  if (
    onRailway ||
    !url ||
    url === "file:./dev.db" ||
    url.startsWith("file:./")
  ) {
    url = ensureServerStorageSync();
  } else {
    const filePath = sqliteFilePathFromUrl(url);
    if (filePath) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
  }

  return url;
}
