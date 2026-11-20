/**
 * Create automation-bot-cpanel.zip for cPanel when Git "Pulling source" fails.
 * Excludes node_modules, .next, local DBs, uploads, secrets.
 *
 * Usage: node scripts/make-cpanel-bundle.cjs
 * Upload/extract on server, then: npm install && npm run build && npm start
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const outZip = path.join(root, "automation-bot-cpanel.zip");

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "storage",
  "coverage",
  "out",
  "build",
]);

const EXCLUDE_FILES = /\.(db|db-journal|tsbuildinfo)$/i;

function shouldSkip(rel) {
  const parts = rel.split(/[/\\]/);
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (EXCLUDE_FILES.test(base)) return true;
  if (base === "automation-bot-cpanel.zip") return true;
  return false;
}

function walk(dir, prefix, files) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (shouldSkip(rel)) continue;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) walk(abs, rel, files);
    else files.push({ abs, rel: rel.replace(/\\/g, "/") });
  }
}

const staging = path.join(root, ".cpanel-bundle-staging");
if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

const files = [];
walk(root, "", files);
for (const f of files) {
  const dest = path.join(staging, f.rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(f.abs, dest);
}

if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

const isWin = process.platform === "win32";
if (isWin) {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${staging}\\*' -DestinationPath '${outZip}' -Force"`,
    { stdio: "inherit" }
  );
} else {
  execSync(`cd "${staging}" && zip -rq "${outZip}" .`, { stdio: "inherit" });
}

fs.rmSync(staging, { recursive: true, force: true });
const mb = (fs.statSync(outZip).size / (1024 * 1024)).toFixed(2);
console.log(`Created ${outZip} (${mb} MB)`);
console.log("Upload to cPanel or extract into the app root, then npm install && npm run build.");