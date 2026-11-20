# Deploy on cPanel AI App Hosting (e.g. app.dezpad.com)

## If the deploy log stops after these two lines only

```
Deploying "app" (category: server, image: docker.io/library/node:22).
Pulling the latest source.
```

cPanel **never cloned your repo** — `npm install` / `npm run build` did not run. This is **not** a Next.js bug. Fix Git access or use the **ZIP** path below.

### A. Fix Git source (preferred)

1. Push latest code: `git push origin main`  
   Repo: `https://github.com/digitalfrenai/automation-bot.git` (branch **main**).
2. cPanel → **Websites & Apps** → **Source**:
   - URL: `https://github.com/digitalfrenai/automation-bot.git`
   - Branch: **main**
   - If the repo is **private**: add a **Personal Access Token** (GitHub → Settings → Developer settings → Tokens, scope `repo`) as the password, or add cPanel’s **deploy SSH key** to the repo.
3. Application root must contain **`package.json`** (repo root, not a subfolder).
4. **Retry Deploy**. A successful log shows `npm install`, `npm run build`, etc. — not just two lines.

### B. ZIP deploy (when Git pull keeps failing)

On your PC (in the project folder):

```bash
node scripts/make-cpanel-bundle.cjs
```

This creates **`automation-bot-cpanel.zip`** (no `node_modules`, no `.env`).

On the server (File Manager or SSH into the cPanel app directory):

1. Upload and **extract** the zip into the app root.
2. **Add Database** (MySQL) in the cPanel app UI if not already done.
3. SSH or Terminal (if available):

   ```bash
   cd /path/to/app
   npm install
   npm run build
   npm start
   ```

4. Or set cPanel **Install / Build / Start** commands to the same as the table below and restart the app.

### C. Still only two log lines?

- cPanel cannot reach GitHub (firewall/DNS) — use ZIP (B).
- Wrong Git URL or branch name — use **main**, not `master`.
- Host’s internal deploy log may have more detail in File Manager: `~/.cpanel/logs/` (even when the UI truncates).

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