/**
 * Run prisma generate after npm install. On Windows, EPERM often means
 * Next.js dev (or another Node process) has the query engine DLL open.
 */
const { spawnSync } = require("child_process");

function runGenerate() {
  return spawnSync("npx", ["prisma", "generate"], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
}

let result = runGenerate();
if (result.status === 0) {
  process.exit(0);
}

const stderr = result.stderr?.toString() ?? "";
const output = result.output?.join("") ?? "";
const locked =
  /EPERM|operation not permitted|query_engine-windows/i.test(
    `${stderr}${output}`
  );

if (locked) {
  console.warn(
    "\n[postinstall] prisma generate skipped: query engine file is locked.\n" +
      "  Stop `npm run dev`, then run:  npx prisma generate\n" +
      "  Or install without scripts:  npm install --ignore-scripts\n"
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
