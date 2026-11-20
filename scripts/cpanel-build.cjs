/**
 * cPanel production build: reset dirty schema, wipe stale .next, rebuild.
 * Set cPanel Build command to: npm run build:cpanel
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const BUILD_STAMP = "mysql-json-repair-v2";

process.chdir(root);

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: true,
    env: process.env,
    cwd: root,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

console.log("=== cpanel-build ===");

spawnSync("git", ["checkout", "--", "prisma/schema.prisma"], {
  stdio: "inherit",
  cwd: root,
});

const nextDir = path.join(root, ".next");
if (fs.existsSync(nextDir)) {
  console.log("Removing stale .next …");
  fs.rmSync(nextDir, { recursive: true, force: true });
}

run("node", ["scripts/prepare-database.cjs"]);
run("node", ["scripts/prisma-run.cjs", "generate"]);
run("npx", ["next", "build"]);

fs.writeFileSync(
  path.join(root, ".cpanel-build-stamp"),
  `${BUILD_STAMP}\n`,
  "utf8"
);
console.log(`Build stamp: ${BUILD_STAMP}`);
console.log("=== cpanel-build done ===");