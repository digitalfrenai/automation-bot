# Deploy on cPanel AI App Hosting (e.g. app.dezpad.com)

## If deploy fails at “Pulling the latest source”

The build never reached `npm install`. Fix **source**, not package.json:

1. cPanel → **Websites & Apps** → your app → check **Git remote**, branch, and deploy key / token.
2. Open the full log path shown in the UI: `~/.cpanel/logs/*-deploy-app.log` (Download in the deploy screen).
3. Retry after the repo is reachable (correct branch, `package.json` at repo root).

---

## Recommended app settings

| Setting | Value |
|--------|--------|
| **Node.js version** | 22 |
| **Application root** | Repo root (contains `package.json`) |
| **Install command** | `npm install` (must include **devDependencies** for build) |
| **Build command** | `npm run build` |
| **Start command** | `npm start` (runs `node scripts/cpanel-start.cjs`) |

Do **not** use `npm install --production` before `npm run build` — `prisma`, `typescript`, and `tailwindcss` are required to build.

---

## Database (MySQL)

1. In the deploy wizard, click **Add Database** and attach it to the app.
2. cPanel injects `MYSQL_*` or `DATABASE_URL` at **runtime** (and often at build).
3. Do **not** commit `.env` with production secrets.

On start, the app runs `prepare-database.cjs` (switches Prisma to MySQL), then `prisma db push`.

---

## Environment variables (optional)

- `PORT` — set by cPanel (do not hard-code 5173).
- `GOOGLE_DRIVE_API_KEY` — optional, for Drive folder import.
- `PAGE_IMAGES_AI=false` — optional, if using uploaded page images only.

---

## After a successful deploy

1. Open `https://app.dezpad.com` (or your app URL).
2. Credentials → WordPress **client site** URL (not dezpad), app password, xAI key → **Save** → **Test connection**.
3. On each **client WordPress** site: install `resources/wordpress-bot-rest-bridge.php` in `wp-content/mu-plugins/` (v1.5+).
4. Re-upload theme/screenshots on live (local `storage/` / `public/uploads/` are not deployed).

---

## Health check

`GET /api/health` should return `ready: true` when MySQL and storage are OK.