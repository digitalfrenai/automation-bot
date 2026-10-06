import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ["ssh2", "ssh2-sftp-client", "adm-zip", "undici"],
  async rewrites() {
    return [
      {
        source: "/uploads/logos/:filename",
        destination: "/api/uploads/logos/:filename",
      },
      {
        source: "/uploads/design-references/:filename",
        destination: "/api/uploads/design-references/:filename",
      },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
