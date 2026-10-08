import fs from "fs/promises";
import path from "path";
import SftpClient from "ssh2-sftp-client";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import type { LogSink } from "@/lib/pipeline-logger";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import { detectThemeSlugFromZip, resolveLocalThemePath } from "@/lib/themeDeployer";
import { formatWordPressApiError } from "@/lib/wordpress-nav-rest";
import { fetchActiveThemeRecord } from "@/lib/wordpress-theme-introspection";
import {
  getRemoteWpRoot,
  hasRemoteShellCredentials,
  runRemoteWpCli,
  shellSingleQuote,
} from "@/lib/wordpress-ssh";
import { normalizeWpUrl, WordPressApiError, wpRequest } from "@/lib/wordpress-client";

const BRIDGE_ROUTE = "/wp-json/wordpress-bot/v1/theme-mod/custom_logo";
const BRAINE_BRIDGE_VERSION = 2;

type CustomLogoBridgeResult = {
  custom_logo?: number;
  site_logo?: number;
  stylesheet?: string;
  template?: string;
  bridge_version?: number;
  braine_logo?: string;
};

function themeLooksLikeBraine(
  stylesheet?: string,
  template?: string,
  name?: string
): boolean {
  const haystack = `${stylesheet ?? ""} ${template ?? ""} ${name ?? ""}`.toLowerCase();
  return haystack.includes("braine");
}

function configuredZipLooksLikeBraine(config: LoadedSiteConfig): boolean {
  const zipPath = config.activeThemeZipPath?.trim();
  if (!zipPath) return false;
  try {
    const slug = detectThemeSlugFromZip(resolveLocalThemePath(zipPath));
    return slug.toLowerCase().includes("braine");
  } catch {
    return false;
  }
}

function phpDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}

function braineLogoApplied(result: CustomLogoBridgeResult): boolean {
  const braine = themeLooksLikeBraine(result.stylesheet, result.template);
  if (!braine) return true;
  return (
    (result.bridge_version ?? 0) >= BRAINE_BRIDGE_VERSION &&
    Boolean(result.braine_logo?.trim())
  );
}

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
  onLog?: LogSink,
  sourceUrl?: string
): Promise<boolean> {
  const log = createPipelineLogger(onLog ?? (() => undefined));

  try {
    const result = await wpRequest<CustomLogoBridgeResult>(config, BRIDGE_ROUTE, {
      method: "POST",
      body: JSON.stringify({
        media_id: mediaId,
        source_url: sourceUrl ?? "",
      }),
    });
    if (result.custom_logo !== mediaId) {
      log.warn(
        `REST bridge responded but custom_logo is ${result.custom_logo ?? "empty"} (expected ${mediaId}).`,
        { phase: "phase1" }
      );
      return false;
    }
    if (!braineLogoApplied(result)) {
      log.warn(
        "REST bridge set custom_logo, but Braine still needs light_color_logo / dark_color_logo in braine_options-mods. Redeploying the bridge plugin.",
        { phase: "phase1" }
      );
      return false;
    }
    if (result.braine_logo?.trim()) {
      log.info(
        `Braine header and footer logos set from the uploaded file (media #${mediaId}).`,
        { phase: "phase1" }
      );
    } else {
      log.info(
        `custom_logo theme mod set via REST bridge (media #${mediaId}).`,
        { phase: "phase1" }
      );
    }
    return true;
  } catch (err) {
    const message = formatWordPressApiError(err);
    if (message.includes("404")) {
      return false;
    }
    log.warn(`REST bridge custom_logo failed: ${message}`, { phase: "phase1" });
    return false;
  }
}

async function applyBraineLogoViaWpCli(
  config: LoadedSiteConfig,
  mediaId: number,
  sourceUrl: string,
  onLog?: LogSink
): Promise<boolean> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const php = `if (function_exists('wordpress_bot_apply_braine_logo')) { $saved = wordpress_bot_apply_braine_logo(${mediaId}, "${phpDoubleQuoted(sourceUrl)}"); echo ($saved !== '') ? 'BRAINE_LOGO_OK' : 'BRAINE_LOGO_FAIL'; } else { echo 'BRAINE_LOGO_MISSING'; }`;
  try {
    const result = await runRemoteWpCli(config, `eval ${shellSingleQuote(php)}`);
    if (result.stdout.includes("BRAINE_LOGO_OK")) {
      log.info(
        `Braine header and footer logos set via WP-CLI (media #${mediaId}).`,
        { phase: "phase1" }
      );
      return true;
    }
    log.warn(
      `WP-CLI could not write Braine logo options: ${(result.stderr || result.stdout).trim() || "no output"}`,
      { phase: "phase1" }
    );
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : "WP-CLI logo update failed";
    log.warn(`WP-CLI Braine logo update failed: ${message}`, { phase: "phase1" });
    return false;
  }
}

function localWordPressRootCandidates(wpUrl: string): string[] {
  let host = "";
  try {
    host = new URL(normalizeWpUrl(wpUrl)).hostname.toLowerCase();
  } catch {
    return [];
  }
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (!home || !host) return [];
  const slug = host.replace(/\.local$/i, "");
  const names = [...new Set([slug, host].filter(Boolean))];
  return names.map((name) =>
    path.join(home, "Local Sites", name, "app", "public")
  );
}

/** Local WP (*.local) has no SFTP in the dashboard, but the site files are on this machine. */
export async function deployWordPressBotRestBridgeLocally(
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<boolean> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const localPlugin = bridgePluginLocalPath();
  try {
    await fs.access(localPlugin);
  } catch {
    return false;
  }

  for (const root of localWordPressRootCandidates(config.wpUrl)) {
    const contentDir = path.join(root, "wp-content");
    try {
      await fs.access(contentDir);
    } catch {
      continue;
    }
    const destDir = path.join(contentDir, "mu-plugins");
    const dest = path.join(destDir, "wordpress-bot-rest-bridge.php");
    try {
      await fs.mkdir(destDir, { recursive: true });
      await fs.copyFile(localPlugin, dest);
      log.info(
        "Installed the logo bridge into this computer's Local WordPress site so Braine can swap its header logo.",
        { phase: "phase1" }
      );
      return true;
    } catch (err) {
      log.warn(
        `Could not copy the logo bridge into the local WordPress site: ${err instanceof Error ? err.message : "copy failed"}`,
        { phase: "phase1" }
      );
    }
  }
  return false;
}

export async function ensureCustomLogoThemeMod(
  config: LoadedSiteConfig,
  mediaId: number,
  onLog?: LogSink,
  sourceUrl?: string
): Promise<{ ok: boolean; braine: boolean }> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const activeTheme = await fetchActiveThemeRecord(config);
  const braine =
    themeLooksLikeBraine(
      activeTheme?.stylesheet,
      activeTheme?.template,
      activeTheme?.name
    ) || configuredZipLooksLikeBraine(config);

  const trySet = () =>
    setCustomLogoViaRestBridge(config, mediaId, onLog, sourceUrl);

  if (await isWordPressBotBridgeAvailable(config)) {
    if (await trySet()) return { ok: true, braine };
  }

  let deployed = false;
  if (hasRemoteShellCredentials(config)) {
    deployed = await deployWordPressBotRestBridge(config, onLog);
  }
  if (!deployed && braine) {
    deployed = await deployWordPressBotRestBridgeLocally(config, onLog);
  }
  if (deployed && (await trySet())) return { ok: true, braine };

  if (braine && sourceUrl?.trim() && hasRemoteShellCredentials(config)) {
    if (await applyBraineLogoViaWpCli(config, mediaId, sourceUrl.trim(), onLog)) {
      return { ok: true, braine };
    }
  }

  log.info(
    braine
      ? "Braine is still showing its own logo.svg. The uploaded file is in the media library, but Braine's header reads light_color_logo / dark_color_logo. Add SFTP credentials, or run this app on the same computer as the Local site, then run Phase 1 again."
      : "Using core site_logo REST only — install SFTP credentials to auto-deploy the REST bridge mu-plugin so the theme custom_logo updates in the Customizer.",
    { phase: "phase1" }
  );
  return { ok: false, braine };
}

export async function activeThemeIsBraine(
  config: LoadedSiteConfig
): Promise<boolean> {
  const activeTheme = await fetchActiveThemeRecord(config);
  return (
    themeLooksLikeBraine(
      activeTheme?.stylesheet,
      activeTheme?.template,
      activeTheme?.name
    ) || configuredZipLooksLikeBraine(config)
  );
}

const POST_BANNER_ROUTE = "/wp-json/wordpress-bot/v1/post-banner";

/** True when the mu-plugin exposes Braine blog title banner (not just custom_logo). */
export async function isPostBannerBridgeAvailable(
  config: LoadedSiteConfig
): Promise<boolean> {
  try {
    await wpRequest(config, POST_BANNER_ROUTE, {
      method: "POST",
      body: JSON.stringify({ post_id: 1, media_id: 0 }),
    });
    return true;
  } catch (err) {
    if (err instanceof WordPressApiError) {
      if (err.status === 404) return false;
      if (err.status === 400 || err.status === 401 || err.status === 403) return true;
    }
    return false;
  }
}

export async function applyPostTitleBannerViaWpCli(
  config: LoadedSiteConfig,
  postId: number,
  mediaId: number,
  sourceUrl: string,
  onLog?: LogSink
): Promise<boolean> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const php = `if (function_exists('wordpress_bot_apply_post_title_banner')) { $saved = wordpress_bot_apply_post_title_banner(${postId}, ${mediaId}, "${phpDoubleQuoted(sourceUrl)}"); echo ($saved !== '') ? 'BANNER_OK' : 'BANNER_FAIL'; } else { echo 'BANNER_MISSING'; }`;
  try {
    const result = await runRemoteWpCli(config, `eval ${shellSingleQuote(php)}`);
    if (result.stdout.includes("BANNER_OK")) {
      log.info(`Braine blog title background set via WP-CLI (post #${postId}).`, {
        phase: "phase4",
        pageId: postId,
      });
      return true;
    }
    log.warn(
      `WP-CLI could not save Braine title background: ${(result.stderr || result.stdout).trim() || "no output"}`,
      { phase: "phase4", pageId: postId }
    );
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : "WP-CLI banner update failed";
    log.warn(`WP-CLI Braine title background failed: ${message}`, {
      phase: "phase4",
      pageId: postId,
    });
    return false;
  }
}

/** Copy the latest mu-plugin so new routes (blog title banner) exist on the site. */
export async function ensureBotBridgeInstalled(
  config: LoadedSiteConfig,
  onLog?: LogSink
): Promise<boolean> {
  if (await isPostBannerBridgeAvailable(config)) {
    return true;
  }
  if (hasRemoteShellCredentials(config)) {
    const remote = await deployWordPressBotRestBridge(config, onLog);
    if (remote && (await isPostBannerBridgeAvailable(config))) return true;
  }
  const local = await deployWordPressBotRestBridgeLocally(config, onLog);
  if (local && (await isPostBannerBridgeAvailable(config))) return true;
  return false;
}
