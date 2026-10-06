import AdmZip from "adm-zip";
import fs from "fs/promises";
import path from "path";
import SftpClient from "ssh2-sftp-client";
import { loadSiteConfig } from "@/lib/config-loader";
import {
  execRemoteCommand,
  getRemoteWpRoot,
  hasRemoteShellCredentials,
  runRemoteWpCli,
} from "@/lib/wordpress-ssh";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { resolveStoredThemePath } from "@/lib/theme-upload-storage";
import { wpRequest } from "@/lib/wordpress-client";

export type ThemeDeployResult = {
  skipped: boolean;
  themeSlug?: string;
  message: string;
};

function getRemotePaths() {
  const wpRoot = getRemoteWpRoot();
  const themesPath =
    process.env.WP_REMOTE_THEMES_PATH ?? `${wpRoot}/wp-content/themes`;
  return { wpRoot, themesPath };
}

export function detectThemeSlugFromZip(localZipPath: string): string {
  const zip = new AdmZip(localZipPath);
  const entries = zip.getEntries();

  const styleEntry = entries.find(
    (entry) =>
      !entry.isDirectory &&
      entry.entryName.toLowerCase().endsWith("style.css") &&
      entry.entryName.split("/").length <= 3
  );

  if (styleEntry) {
    const parts = styleEntry.entryName.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return parts[0];
    }
  }

  const topLevelDir = entries.find(
    (entry) => entry.isDirectory && entry.entryName.split("/").filter(Boolean).length === 1
  );
  if (topLevelDir) {
    return topLevelDir.entryName.replace(/\/$/, "");
  }

  const base = path.basename(localZipPath, ".zip");
  const withoutTimestamp = base.replace(/^\d+-/, "");
  return withoutTimestamp.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "uploaded-theme";
}

export function resolveLocalThemePath(activeThemeZipPath: string): string {
  return resolveStoredThemePath(activeThemeZipPath);
}

async function activateThemeViaWpCli(
  config: Awaited<ReturnType<typeof loadSiteConfig>>,
  themeSlug: string,
  log: ReturnType<typeof createPipelineLogger>
): Promise<boolean> {
  log.info(`Running remote WP-CLI: theme activate ${themeSlug}`, {
    phase: "setup",
  });

  const result = await runRemoteWpCli(
    config,
    `theme activate ${themeSlug}`
  );
  if (result.code === 0) {
    log.info(`Theme "${themeSlug}" activated via WP-CLI.`, { phase: "setup" });
    return true;
  }

  log.warn(
    `WP-CLI activation failed (code ${result.code}): ${result.stderr || result.stdout}`,
    { phase: "setup" }
  );
  return false;
}

async function activateThemeViaRest(
  config: Awaited<ReturnType<typeof loadSiteConfig>>,
  themeSlug: string,
  log: ReturnType<typeof createPipelineLogger>
): Promise<boolean> {
  try {
    await wpRequest(config, "/wp-json/wp/v2/themes", { method: "GET" });
    log.warn(
      "WordPress themes REST endpoint is read-only; theme activation requires WP-CLI/SSH or admin UI.",
      { phase: "setup" }
    );
  } catch {
    log.warn("Could not verify theme via REST after upload.", { phase: "setup" });
  }

  log.info(
    `Theme files deployed for slug "${themeSlug}". Activate manually if WP-CLI is unavailable.`,
    { phase: "setup" }
  );
  return false;
}

export async function deployThemeZip(
  configId: string,
  onLog?: LogSink
): Promise<ThemeDeployResult> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const config = await loadSiteConfig(configId);

  if (!config.activeThemeZipPath?.trim()) {
    const message = "No theme zip configured; skipping theme deployment.";
    log.info(message, { phase: "setup" });
    return { skipped: true, message };
  }

  if (!hasRemoteShellCredentials(config)) {
    const message =
      "SFTP credentials missing; skipping remote theme upload (local zip retained).";
    log.warn(message, { phase: "setup" });
    return { skipped: true, message };
  }

  const localZipPath = resolveLocalThemePath(config.activeThemeZipPath);
  try {
    await fs.access(localZipPath);
  } catch {
    throw new Error(`Theme zip not found at ${localZipPath}`);
  }

  const themeSlug = detectThemeSlugFromZip(localZipPath);
  const zipFileName = path.basename(localZipPath);
  const { themesPath } = getRemotePaths();
  const remoteZipPath = `${themesPath}/${zipFileName}`.replace(/\\/g, "/");
  const port = Number(config.sftpPort?.trim() || "22");
  const sftp = new SftpClient();

  log.info(`Connecting to SFTP ${config.sftpHost}:${port}…`, { phase: "setup" });

  try {
    await sftp.connect({
      host: config.sftpHost!.trim(),
      port,
      username: config.sftpUsername!.trim(),
      password: config.sftpPassword!.trim(),
      readyTimeout: 20000,
    });

    await sftp.mkdir(themesPath, true);
    log.info(`Uploading theme zip to ${remoteZipPath}…`, { phase: "setup" });
    await sftp.put(localZipPath, remoteZipPath);
    await sftp.end();

    const unzipCommand =
      `unzip -o "${remoteZipPath}" -d "${themesPath}" && rm -f "${remoteZipPath}"`;
    log.info("Extracting theme archive on remote server…", { phase: "setup" });
    const unzipResult = await execRemoteCommand(config, unzipCommand);

    if (unzipResult.code !== 0) {
      throw new Error(
        `Remote unzip failed: ${unzipResult.stderr || unzipResult.stdout}`
      );
    }

    const activated =
      (await activateThemeViaWpCli(config, themeSlug, log)) ||
      (await activateThemeViaRest(config, themeSlug, log));

    const message = activated
      ? `Theme "${themeSlug}" deployed and activated.`
      : `Theme "${themeSlug}" deployed; activation may require manual confirmation.`;

    log.info(message, { phase: "setup" });
    return { skipped: false, themeSlug, message };
  } catch (err) {
    try {
      await sftp.end();
    } catch {
      /* ignore */
    }
    const message = err instanceof Error ? err.message : "Theme deployment failed.";
    log.error(message, { phase: "setup" });
    throw new Error(message);
  }
}
