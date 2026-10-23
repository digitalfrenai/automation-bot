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

function firstEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

/** MySQL URL from cPanel Add Database, or from the usual MYSQL_* / DB_* variables. */
export function resolveMysqlDatabaseUrl(): string {
  const direct = firstEnv(["DATABASE_URL", "MYSQL_URL", "MYSQL_PUBLIC_URL"]);
  if (/^mysqls?:\/\//i.test(direct)) return direct;

  const host = firstEnv(["MYSQL_HOST", "DB_HOST", "DATABASE_HOST"]);
  const user = firstEnv([
    "MYSQL_USER",
    "MYSQL_USERNAME",
    "DB_USER",
    "DB_USERNAME",
    "DATABASE_USER",
    "DATABASE_USERNAME",
  ]);
  const password = firstEnv([
    "MYSQL_PASSWORD",
    "DB_PASSWORD",
    "DATABASE_PASSWORD",
  ]);
  const database = firstEnv([
    "MYSQL_DATABASE",
    "MYSQL_DB",
    "DB_NAME",
    "DB_DATABASE",
    "DATABASE_NAME",
  ]);
  const port = firstEnv(["MYSQL_PORT", "DB_PORT", "DATABASE_PORT"]) || "3306";
  if (!host || !user || !database) return "";

  const auth = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  return `mysql://${auth}@${host}:${port}/${database}`;
}

function ensureUploadDirs(dataRoot: string): void {
  const themesDir = path.join(dataRoot, "uploads", "themes");
  const logosDir = path.join(dataRoot, "uploads", "logos");
  const designRefDir = path.join(dataRoot, "uploads", "design-references");
  fs.mkdirSync(themesDir, { recursive: true });
  fs.mkdirSync(logosDir, { recursive: true });
  fs.mkdirSync(designRefDir, { recursive: true });
  if (!process.env.UPLOAD_THEMES_DIR?.trim()) {
    process.env.UPLOAD_THEMES_DIR = themesDir;
  }
  if (!process.env.UPLOAD_LOGOS_DIR?.trim()) {
    process.env.UPLOAD_LOGOS_DIR = logosDir;
  }
  if (!process.env.UPLOAD_DESIGN_REFERENCES_DIR?.trim()) {
    process.env.UPLOAD_DESIGN_REFERENCES_DIR = designRefDir;
  }
}

/** Sync: create volume dirs and set DATABASE_URL before PrismaClient is constructed. */
export function ensureServerStorageSync(): string {
  const mysqlUrl = resolveMysqlDatabaseUrl();
  if (mysqlUrl) {
    process.env.DATABASE_URL = mysqlUrl;
    ensureUploadDirs(path.join(process.cwd(), "storage"));
    return mysqlUrl;
  }

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
  const mysqlUrl = resolveMysqlDatabaseUrl();
  if (mysqlUrl) {
    process.env.DATABASE_URL = mysqlUrl;
    ensureUploadDirs(path.join(process.cwd(), "storage"));
    return mysqlUrl;
  }

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
