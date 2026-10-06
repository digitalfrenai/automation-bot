import { Client as SshClient } from "ssh2";
import type { LoadedSiteConfig } from "@/lib/config-loader";

export function getRemoteWpRoot(): string {
  return process.env.WP_REMOTE_ROOT ?? "/var/www/html";
}

export function hasRemoteShellCredentials(
  config: LoadedSiteConfig
): boolean {
  return Boolean(
    config.sftpHost?.trim() &&
      config.sftpUsername?.trim() &&
      config.sftpPassword?.trim()
  );
}

export async function execRemoteCommand(
  config: LoadedSiteConfig,
  command: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  const port = Number(config.sftpPort?.trim() || "22");

  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }

          let stdout = "";
          let stderr = "";
          stream
            .on("close", (code: number) => {
              conn.end();
              resolve({ stdout, stderr, code: code ?? 1 });
            })
            .on("data", (data: Buffer) => {
              stdout += data.toString();
            });
          stream.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });
        });
      })
      .on("error", reject)
      .connect({
        host: config.sftpHost!.trim(),
        port,
        username: config.sftpUsername!.trim(),
        password: config.sftpPassword!.trim(),
        readyTimeout: 20000,
      });
  });
}

export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Run WP-CLI on the remote host (requires SSH + wp on PATH). */
export async function runRemoteWpCli(
  config: LoadedSiteConfig,
  args: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  const wpRoot = getRemoteWpRoot();
  const command = `wp ${args} --path=${shellSingleQuote(wpRoot)}`;
  return execRemoteCommand(config, command);
}
