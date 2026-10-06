import fs from "fs/promises";
import path from "path";
import SftpClient from "ssh2-sftp-client";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { formatWordPressApiError } from "@/lib/wordpress-nav-rest";
import {
  getRemoteWpRoot,
  hasRemoteShellCredentials,
} from "@/lib/wordpress-ssh";
import { WordPressApiError, wpRequest } from "@/lib/wordpress-client";

const BRIDGE_ROUTE = "/wp-json/wordpress-bot/v1/theme-mod/custom_logo";

function bridgePluginLocalPath(): string {
  return path.join(
    process.cwd(),
    "resources",
    "wordpress-bot-rest-bridge.php"
  );
}

async function isWordPressBotBridgeAvailable(
  config: LoadedSiteConfig
): Promise<boolean> {
  try {
    await wpRequest(config, BRIDGE_ROUTE, {
      method: "POST",
      body: JSON.stringify({ media_id: 0 }),
    });
    return true;
  } catch (err) {
    if (err instanceof WordPressApiError) {
      if (err.status === 404) return false;
      if (err.status === 400) return true;
    }
    return false;
  }
}

export async function deployWordPressBotRestBridge(
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<boolean> {
  if (!hasRemoteShellCredentials(config)) {
    return false;
  }

  const log = createPipelineLogger(onLog ?? (() => undefined));
  const localPath = bridgePluginLocalPath();
  try {
    await fs.access(localPath);
  } catch {
    log.warn("REST bridge plugin file missing in app resources.", {
      phase: "phase1",
    });
    return false;
  }

  const wpRoot = getRemoteWpRoot();
  const remoteDir = `${wpRoot}/wp-content/mu-plugins`.replace(/\\/g, "/");
  const remotePath = `${remoteDir}/wordpress-bot-rest-bridge.php`;
  const port = Number(config.sftpPort?.trim() || "22");
  const sftp = new SftpClient();

  try {
    await sftp.connect({
      host: config.sftpHost!.trim(),
      port,
      username: config.sftpUsername!.trim(),
      password: config.sftpPassword!.trim(),
      readyTimeout: 20000,
    });
    await sftp.mkdir(remoteDir, true);
    await sftp.put(localPath, remotePath);
    await sftp.end();
    log.info("Installed WordPress Bot REST bridge (mu-plugin) for theme_mod logo sync.", {
      phase: "phase1",
    });
    return true;
  } catch (err) {
    try {
      await sftp.end();
    } catch {
      /* ignore */
    }
    log.warn(
      `Could not install REST bridge mu-plugin via SFTP: ${err instanceof Error ? err.message : "upload failed"}`,
      { phase: "phase1" }
    );
    return false;
  }
}

export async function setCustomLogoViaRestBridge(
  config: LoadedSiteConfig,
  mediaId: number,
  onLog?: LogSink
): Promise<boolean> {
  const log = createPipelineLogger(onLog ?? (() => undefined));

  try {
    const result = await wpRequest<{
      custom_logo?: number;
      site_logo?: number;
    }>(config, BRIDGE_ROUTE, {
      method: "POST",
      body: JSON.stringify({ media_id: mediaId }),
    });
    if (result.custom_logo === mediaId) {
      log.info(
        `Kadence/Braine custom_logo theme mod set via REST bridge (media #${mediaId}).`,
        { phase: "phase1" }
      );
      return true;
    }
    log.warn(
      `REST bridge responded but custom_logo is ${result.custom_logo ?? "empty"} (expected ${mediaId}).`,
      { phase: "phase1" }
    );
    return false;
  } catch (err) {
    const message = formatWordPressApiError(err);
    if (message.includes("404")) {
      return false;
    }
    log.warn(`REST bridge custom_logo failed: ${message}`, { phase: "phase1" });
    return false;
  }
}

export async function ensureCustomLogoThemeMod(
  config: LoadedSiteConfig,
  mediaId: number,
  onLog?: LogSink
): Promise<void> {
  const log = createPipelineLogger(onLog ?? (() => undefined));

  if (await isWordPressBotBridgeAvailable(config)) {
    if (await setCustomLogoViaRestBridge(config, mediaId, onLog)) {
      return;
    }
  }

  if (hasRemoteShellCredentials(config)) {
    await deployWordPressBotRestBridge(config, onLog);
    if (await setCustomLogoViaRestBridge(config, mediaId, onLog)) {
      return;
    }
  }

  log.info(
    "Using core site_logo REST only — install SFTP credentials to auto-deploy the REST bridge mu-plugin so Kadence/Braine custom_logo updates in the Customizer.",
    { phase: "phase1" }
  );
}
