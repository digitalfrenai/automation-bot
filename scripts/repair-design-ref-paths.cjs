const { PrismaClient } = require("@prisma/client");

const p = new PrismaClient();
p.$executeRawUnsafe(
  `UPDATE SiteConfig SET designReferencePaths = '[]' WHERE id = 'default' AND (designReferencePaths IS NULL OR CAST(designReferencePaths AS TEXT) = '')`
)
  .then((r) => {
    console.log("designReferencePaths repaired:", r);
  })
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
