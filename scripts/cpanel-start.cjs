/**
 * Production start for cPanel Node.js (no bash required).
 * Docker/Railway can keep using scripts/docker-entrypoint.sh via CMD.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: true,
    env: process.env,
    ...opts,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

const root = path.join(__dirname, "..");
process.chdir(root);

console.log("=== wordpress-bot startup (cpanel) ===");

run("node", ["scripts/prepare-database.cjs"]);

const urlFile = path.join(root, ".cpanel-database.env");
if (fs.existsSync(urlFile)) {
  const url = fs.readFileSync(urlFile, "utf8").trim();
  if (url) process.env.DATABASE_URL = url;
}

const dbUrl = (process.env.DATABASE_URL || "").trim();
const isMysql = /^mysqls?:\/\//i.test(dbUrl);

if (isMysql) {
  const storage = path.join(root, "storage");
  process.env.UPLOAD_THEMES_DIR =
    process.env.UPLOAD_THEMES_DIR || path.join(storage, "uploads", "themes");
  process.env.UPLOAD_LOGOS_DIR =
    process.env.UPLOAD_LOGOS_DIR || path.join(storage, "uploads", "logos");
  process.env.UPLOAD_DESIGN_REFERENCES_DIR =
    process.env.UPLOAD_DESIGN_REFERENCES_DIR ||
    path.join(storage, "uploads", "design-references");
  fs.mkdirSync(process.env.UPLOAD_THEMES_DIR, { recursive: true });
  fs.mkdirSync(process.env.UPLOAD_LOGOS_DIR, { recursive: true });
  fs.mkdirSync(process.env.UPLOAD_DESIGN_REFERENCES_DIR, { recursive: true });
  console.log("DATABASE_URL=(mysql)");
  run("npx", ["prisma", "generate"]);
  run("npx", ["prisma", "db", "push", "--accept-data-loss"]);
} else {
  const dataRoot = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(root, "storage");
  const prismaDir = path.join(dataRoot, "prisma");
  fs.mkdirSync(prismaDir, { recursive: true });
  process.env.DATABASE_URL = `file:${path.join(prismaDir, "prod.db")}`;
  process.env.UPLOAD_THEMES_DIR =
    process.env.UPLOAD_THEMES_DIR || path.join(dataRoot, "uploads", "themes");
  process.env.UPLOAD_LOGOS_DIR =
    process.env.UPLOAD_LOGOS_DIR || path.join(dataRoot, "uploads", "logos");
  process.env.UPLOAD_DESIGN_REFERENCES_DIR =
    process.env.UPLOAD_DESIGN_REFERENCES_DIR ||
    path.join(dataRoot, "uploads", "design-references");
  for (const d of [
    prismaDir,
    process.env.UPLOAD_THEMES_DIR,
    process.env.UPLOAD_LOGOS_DIR,
    process.env.UPLOAD_DESIGN_REFERENCES_DIR,
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }
  console.log(`DATABASE_URL=${process.env.DATABASE_URL}`);
  run("npx", ["prisma", "generate"]);
  run("npx", ["prisma", "db", "push"]);
}

process.env.HOSTNAME = "0.0.0.0";
const port = process.env.PORT || "3000";
console.log(`Starting Next.js on 0.0.0.0:${port}`);
run("npx", ["next", "start", "-H", "0.0.0.0", "-p", port]);