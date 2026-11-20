const { PrismaClient } = require("@prisma/client");

const p = new PrismaClient();

async function main() {
  const row = await p.siteConfig.findUnique({
    where: { id: "default" },
    select: { designReferencePaths: true },
  });
  if (!row) return;
  const v = row.designReferencePaths;
  if (Array.isArray(v)) return;
  if (v === null || v === undefined || String(v).trim() === "") {
    await p.siteConfig.update({
      where: { id: "default" },
      data: { designReferencePaths: [] },
    });
    console.log("designReferencePaths repaired: []");
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());