import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { prepareDatabaseUrl } from "@/lib/database-url";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEALTH_MARKER = "2026-09-23-railway-v2";

function sqlitePathFromUrl(url: string): string | null {
  if (!url.startsWith("file:")) return null;
  const rest = url.slice("file:".length);
  if (rest.startsWith("/")) return rest;
  if (rest.startsWith("//")) return rest.replace(/^\/+/, "/");
  return path.resolve(process.cwd(), rest);
}

export async function GET() {
  const databaseUrl = prepareDatabaseUrl();
  const dbFile = sqlitePathFromUrl(databaseUrl);
  const dir = dbFile ? path.dirname(dbFile) : null;

  let dirExists = false;
  let dirWritable = false;
  let dbExists = false;
  let dbQueryOk = false;
  let dbError: string | null = null;

  if (dir) {
    dirExists = fs.existsSync(dir);
    try {
      fs.accessSync(dir, fs.constants.W_OK);
      dirWritable = true;
    } catch {
      dirWritable = false;
    }
  }
  if (dbFile) {
    dbExists = fs.existsSync(dbFile);
  }

  try {
    await prisma.siteConfig.count();
    dbQueryOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database query failed";
  }

  const ready = dirWritable && dbQueryOk;

  // Railway (and similar) treat non-2xx health checks as failure and SIGTERM the container.
  // Always return 200 when this handler runs; use `ready` for DB/volume diagnostics.
  return NextResponse.json(
    {
      ok: true,
      ready,
      marker: HEALTH_MARKER,
      gitCommit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      railwayVolumeMount: process.env.RAILWAY_VOLUME_MOUNT_PATH ?? null,
      databaseUrl,
      dbFile,
      dirExists,
      dirWritable,
      dbExists,
      dbQueryOk,
      dbError,
      uploadThemesDir: process.env.UPLOAD_THEMES_DIR ?? null,
    },
    { status: 200 }
  );
}
