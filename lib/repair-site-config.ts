import { prisma } from "@/lib/prisma";
import { SINGLE_CONFIG_ID } from "@/lib/site-config";

const DEFAULT_PLATFORMS = ["x", "linkedin", "facebook", "instagram"];

async function repairJsonArrayColumn(
  configId: string,
  column: "designReferencePaths" | "socialPlatforms",
  defaultJson: string
): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<
    Array<Record<string, string | null>>
  >(
    `SELECT CAST(${column} AS TEXT) AS col_text FROM SiteConfig WHERE id = ?`,
    configId
  );
  const raw = rows[0]?.col_text;
  if (raw === null || raw === undefined) return;

  const trimmed = String(raw).trim();
  if (trimmed === "") {
    await prisma.$executeRawUnsafe(
      `UPDATE SiteConfig SET ${column} = ? WHERE id = ?`,
      defaultJson,
      configId
    );
    return;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return;
  } catch {
    /* fall through */
  }

  await prisma.$executeRawUnsafe(
    `UPDATE SiteConfig SET ${column} = ? WHERE id = ?`,
    defaultJson,
    configId
  );
}

/**
 * Repair corrupted SiteConfig JSON columns (empty strings or invalid JSON).
 */
export async function ensureSiteConfigJsonIntegrity(
  configId: string = SINGLE_CONFIG_ID
): Promise<void> {
  try {
    await repairJsonArrayColumn(configId, "designReferencePaths", "[]");
  } catch (err) {
    console.error("[ensureSiteConfigJsonIntegrity] designReferencePaths", err);
  }

  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ socialPlatforms_text: string | null }>
    >(
      `SELECT CAST(socialPlatforms AS TEXT) AS socialPlatforms_text
       FROM SiteConfig WHERE id = ?`,
      configId
    );
    const raw = rows[0]?.socialPlatforms_text;
    if (raw === null || raw === undefined) return;

    let needsFix = false;
    let fixed: string[] = DEFAULT_PLATFORMS;

    const trimmed = String(raw).trim();
    if (trimmed === "") {
      needsFix = true;
      fixed = DEFAULT_PLATFORMS;
    } else {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          fixed = parsed.filter((p): p is string => typeof p === "string");
          if (fixed.length === 0) {
            fixed = DEFAULT_PLATFORMS;
            needsFix = true;
          }
        } else {
          needsFix = true;
        }
      } catch {
        needsFix = true;
        try {
          const wrapped = JSON.parse(`[${trimmed}]`);
          if (Array.isArray(wrapped)) {
            fixed = wrapped.filter((p): p is string => typeof p === "string");
          }
        } catch {
          fixed = DEFAULT_PLATFORMS;
        }
        if (fixed.length === 0) fixed = DEFAULT_PLATFORMS;
      }
    }

    if (needsFix) {
      await prisma.$executeRawUnsafe(
        `UPDATE SiteConfig SET socialPlatforms = ? WHERE id = ?`,
        JSON.stringify(fixed),
        configId
      );
    }
  } catch (err) {
    console.error("[ensureSiteConfigJsonIntegrity]", err);
  }
}
