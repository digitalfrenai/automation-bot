import fs from "fs";
import path from "path";
import { resolveDataRoot } from "@/lib/database-url";

export function isRailwayRuntime(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT?.trim() ||
      process.env.RAILWAY_PROJECT_ID?.trim() ||
      process.env.RAILWAY_SERVICE_ID?.trim()
  );
}

export function sqlitePathOnVolume(): string {
  return path.join(resolveDataRoot(), "prisma", "prod.db");
}

/** Copy SQLite from old ephemeral paths into the volume (one-time rescue after adding a volume). */
export function migrateEphemeralSqliteIfNeeded(): void {
  const target = sqlitePathOnVolume();
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  const candidates = [
    path.join(process.cwd(), "prisma", "dev.db"),
    path.join(process.cwd(), "prisma", "prod.db"),
    path.join(process.cwd(), "dev.db"),
    path.join(process.cwd(), "storage", "prisma", "prod.db"),
  ];

  for (const src of candidates) {
    try {
      if (!fs.existsSync(src)) continue;
      const size = fs.statSync(src).size;
      if (size <= 0) continue;
      fs.copyFileSync(src, target);
      console.log(
        `[wordpress-bot] Migrated SQLite config from ${src} → ${target} (${size} bytes)`
      );
      return;
    } catch (err) {
      console.warn("[wordpress-bot] SQLite migration skipped for", src, err);
    }
  }
}

export type StoragePersistenceInfo = {
  railway: boolean;
  volumeMountPath: string | null;
  dataRoot: string;
  databaseFile: string;
  databaseExists: boolean;
  databaseBytes: number;
  /** False on Railway when no volume is mounted — config is lost on redeploy. */
  persistentStorageOk: boolean;
  warning: string | null;
};

export function getStoragePersistenceInfo(): StoragePersistenceInfo {
  const railway = isRailwayRuntime();
  const volumeMountPath =
    process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || null;
  const dataRoot = resolveDataRoot();
  const databaseFile = sqlitePathOnVolume();
  let databaseExists = false;
  let databaseBytes = 0;
  try {
    if (fs.existsSync(databaseFile)) {
      databaseExists = true;
      databaseBytes = fs.statSync(databaseFile).size;
    }
  } catch {
    /* ignore */
  }

  const persistentStorageOk = !railway || Boolean(volumeMountPath);
  let warning: string | null = null;
  if (railway && !volumeMountPath) {
    const dbVar = process.env.DATABASE_URL?.trim() ?? "";
    if (dbVar === "/data" || dbVar === "data" || dbVar === "/data/") {
      warning =
        'Remove the DATABASE_URL variable ("/data" is not a database path). Open this service → Volumes → Add volume → mount path /data. That creates persistent disk; Variables do not.';
    } else {
      warning =
        "No Railway volume detected (RAILWAY_VOLUME_MOUNT_PATH is unset). Service → Volumes → Add volume → mount path /data → redeploy. Do not use Variables instead of a volume.";
    }
  } else if (railway && volumeMountPath && volumeMountPath !== "/data") {
    warning = `Volume is mounted at ${volumeMountPath} (OK if intentional). Recommended mount path is /data.`;
  }

  return {
    railway,
    volumeMountPath,
    dataRoot,
    databaseFile,
    databaseExists,
    databaseBytes,
    persistentStorageOk,
    warning,
  };
}
