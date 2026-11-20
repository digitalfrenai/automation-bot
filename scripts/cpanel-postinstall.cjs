/**
 * After npm install on cPanel (MySQL), run a full production build when stamp is missing.
 * Set Install command to: npm install && node scripts/cpanel-postinstall.cjs
 * Or rely on: npm install && npm run build:cpanel
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const BUILD_STAMP = "mysql-json-repair-v2";
const stampPath = path.join(root, ".cpanel-build-stamp");

function isMysqlEnv() {
  const names = [
    "DATABASE_URL",
    "MYSQL_URL",
    "MYSQL_HOST",
    "MYSQL_DATABASE",
  ];
  for (const name of names) {
    const v = process.env[name];
    if (v && /mysql/i.test(v)) return true;
  }
  return false;
}

if (process.env.SKIP_CPANEL_BUILD === "1") {
  process.exit(0);
}

if (!isMysqlEnv()) {
  process.exit(0);
}

const stampOk =
  fs.existsSync(stampPath) &&
  fs.readFileSync(stampPath, "utf8").trim() === BUILD_STAMP;

if (stampOk) {
  console.log("[cpanel-postinstall] build stamp OK, skipping build");
  process.exit(0);
}

console.log("[cpanel-postinstall] running production build …");
const r = spawnSync("node", ["scripts/cpanel-build.cjs"], {
  stdio: "inherit",
  shell: true,
  cwd: root,
  env: process.env,
});
process.exit(r.status ?? 0);