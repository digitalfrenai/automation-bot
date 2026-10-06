import { execSync } from "child_process";
import { ensureServerStorageSync } from "@/lib/database-url";
import { getStoragePersistenceInfo } from "@/lib/storage-persistence";

declare global {
  var __wpBotBootstrapped: boolean | undefined;
}

/** Runs once when the Next.js server starts (see instrumentation.ts). */
export async function bootstrapServerData(): Promise<void> {
  if (globalThis.__wpBotBootstrapped) return;
  globalThis.__wpBotBootstrapped = true;

  ensureServerStorageSync();

  const storage = getStoragePersistenceInfo();
  console.log("[wordpress-bot bootstrap]");
  console.log("  RAILWAY_VOLUME_MOUNT_PATH=", storage.volumeMountPath ?? "(unset)");
  console.log("  DATABASE_URL=", process.env.DATABASE_URL);
  console.log("  databaseFile=", storage.databaseFile, `(${storage.databaseBytes} bytes)`);
  console.log("  UPLOAD_THEMES_DIR=", process.env.UPLOAD_THEMES_DIR);
  console.log("  UPLOAD_LOGOS_DIR=", process.env.UPLOAD_LOGOS_DIR);
  if (storage.warning) {
    console.warn("[wordpress-bot bootstrap] STORAGE:", storage.warning);
  }

  try {
    execSync("npx prisma db push --skip-generate", {
      stdio: "inherit",
      env: process.env,
    });
  } catch (err) {
    console.error("[wordpress-bot bootstrap] prisma db push failed:", err);
  }
}
