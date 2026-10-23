/**
 * Point Prisma at MySQL when cPanel (or any host) provides a MySQL URL.
 * Local dev and Railway keep SQLite. Safe to run on every build.
 */
const fs = require("fs");
const path = require("path");

const schemaPath = path.join(__dirname, "..", "prisma", "schema.prisma");
const urlFile = path.join(__dirname, "..", ".cpanel-database.env");

const KEEP_VARCHAR = new Set([
  "id",
  "siteConfigId",
  "blogPostId",
  "status",
  "contentType",
  "platform",
  "phase",
  "sourceType",
]);

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] && process.env[key].trim()) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function isMysqlUrl(url) {
  return /^mysqls?:\/\//i.test(url);
}

function resolveMysqlDatabaseUrl() {
  const direct = firstEnv([
    "DATABASE_URL",
    "MYSQL_URL",
    "MYSQL_PUBLIC_URL",
  ]);
  if (isMysqlUrl(direct)) return direct;

  const host = firstEnv([
    "MYSQL_HOST",
    "DB_HOST",
    "DATABASE_HOST",
  ]);
  const user = firstEnv([
    "MYSQL_USER",
    "MYSQL_USERNAME",
    "DB_USER",
    "DB_USERNAME",
    "DATABASE_USER",
    "DATABASE_USERNAME",
  ]);
  const password = firstEnv([
    "MYSQL_PASSWORD",
    "DB_PASSWORD",
    "DATABASE_PASSWORD",
  ]);
  const database = firstEnv([
    "MYSQL_DATABASE",
    "MYSQL_DB",
    "DB_NAME",
    "DB_DATABASE",
    "DATABASE_NAME",
  ]);
  const port = firstEnv(["MYSQL_PORT", "DB_PORT", "DATABASE_PORT"]) || "3306";
  if (!host || !user || !database) return "";

  const auth = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  return `mysql://${auth}@${host}:${port}/${database}`;
}

function annotateMysqlStrings(schema) {
  return schema
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s+)(\w+)\s+String(\?)?(\s+.*)?$/);
      if (!match) return line;
      const [, indent, name, optional, rest] = match;
      if (KEEP_VARCHAR.has(name)) return line;
      if ((rest || "").includes("@id") || (rest || "").includes("@db.")) {
        return line;
      }
      return `${indent}${name} String${optional || ""}${rest || ""} @db.Text`;
    })
    .join("\n");
}

function writeSchema(provider) {
  const current = fs.readFileSync(schemaPath, "utf8");
  let next = current
    .replace(/provider\s*=\s*"(sqlite|mysql)"/, `provider = "${provider}"`)
    .replace(/ @db\.Text/g, "");
  if (provider === "mysql") next = annotateMysqlStrings(next);
  if (next !== current) fs.writeFileSync(schemaPath, next);
}

function main() {
  loadDotEnv();
  const mysqlUrl = resolveMysqlDatabaseUrl();
  if (mysqlUrl) {
    writeSchema("mysql");
    fs.writeFileSync(urlFile, mysqlUrl);
    return;
  }
  writeSchema("sqlite");
  if (fs.existsSync(urlFile)) fs.unlinkSync(urlFile);
}

main();
