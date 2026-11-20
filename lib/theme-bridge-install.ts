import { readFile } from "fs/promises";
import { createPipelineLogger } from "@/lib/pipeline-logger";
import type { LogSink } from "@/lib/pipeline-logger";
import type { LoadedSiteConfig } from "@/lib/config-loader";
import { detectThemeSlugFromZip } from "@/lib/themeDeployer";
import { getWpAuthHeader, normalizeWpUrl } from "@/lib/wordpress-client";

const INSTALL_ROUTE = "/wp-json/wordpress-bot/v1/theme/install-zip";
const ACTIVATE_ROUTE = "/wp-json/wordpress-bot/v1/theme/activate";

export async function wordpressBotBridgeSupportsThemeInstall(
  config: LoadedSiteConfig
): Promise<boolean> {
  try {
    const base = normalizeWpUrl(config.wpUrl);
    const res = await fetch(`${base}${INSTALL_ROUTE}`, {
      method: "OPTIONS",
      headers: { Authorization: getWpAuthHeader(config.wpUsername, config.wpAppPassword) },
    });
    return res.status !== 404;
  } catch {
    return false;
  }
}

export async function deployThemeViaWordPressBridge(
  config: LoadedSiteConfig,
  localZipPath: string,
  onLog?: LogSink
): Promise<{ ok: boolean; themeSlug?: string; message: string }> {
  const log = createPipelineLogger(onLog ?? (() => undefined));
  const base = normalizeWpUrl(config.wpUrl);
  const themeSlug = detectThemeSlugFromZip(localZipPath);
  const zipBuffer = await readFile(localZipPath);
  const blob = new Blob([zipBuffer], { type: "application/zip" });

  const form = new FormData();
  form.append("theme_zip", blob, "theme.zip");

  log.info("Installing theme zip via WordPress Bot REST bridge…", { phase: "setup" });

  const installRes = await fetch(`${base}${INSTALL_ROUTE}`, {
    method: "POST",
    headers: {
      Authorization: getWpAuthHeader(config.wpUsername, config.wpAppPassword),
    },
    body: form,
    signal: AbortSignal.timeout(300_000),
  });

  const installText = await installRes.text();
  if (!installRes.ok) {
    return {
      ok: false,
      message: `Bridge theme install failed (${installRes.status}): ${installText.slice(0, 400)}`,
    };
  }

  let installedSlug = themeSlug;
  try {
    const parsed = JSON.parse(installText) as { theme_slug?: string };
    if (parsed.theme_slug?.trim()) installedSlug = parsed.theme_slug.trim();
  } catch {
    /* use detected slug */
  }

  const activateRes = await fetch(`${base}${ACTIVATE_ROUTE}`, {
    method: "POST",
    headers: {
      Authorization: getWpAuthHeader(config.wpUsername, config.wpAppPassword),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ theme_slug: installedSlug }),
    signal: AbortSignal.timeout(60_000),
  });

  const activateText = await activateRes.text();
  if (!activateRes.ok) {
    log.warn(
      `Theme installed but activation failed (${activateRes.status}): ${activateText.slice(0, 200)}`,
      { phase: "setup" }
    );
    return {
      ok: true,
      themeSlug: installedSlug,
      message: `Theme "${installedSlug}" installed via REST — activate manually if needed.`,
    };
  }

  const message = `Theme "${installedSlug}" installed and activated via WordPress REST bridge.`;
  log.info(message, { phase: "setup" });
  return { ok: true, themeSlug: installedSlug, message };
}