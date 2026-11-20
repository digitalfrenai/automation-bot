/**
 * Run Prisma CLI with the active schema (schema.prisma or gitignored schema.mysql.prisma).
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");

function getSchemaRel() {
  const marker = path.join(root, "prisma", ".active-schema");
  const rel = fs.existsSync(marker)
    ? fs.readFileSync(marker, "utf8").trim()
    : "schema.prisma";
  return path.join("prisma", rel);
}

const extra = process.argv.slice(2);
const args = ["prisma", ...extra, "--schema", getSchemaRel()];
const r = spawnSync("npx", args, {
  stdio: "inherit",
  shell: true,
  env: process.env,
  cwd: root,
});
process.exit(r.status ?? 1);