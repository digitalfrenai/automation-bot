# Deployment (recommended: Railway)

This app is **not a good fit for Vercel serverless** as-is (SQLite file, theme uploads, 15‑minute pipelines). For a **Vercel-like workflow** (connect GitHub → auto deploy → HTTPS), use **[Railway](https://railway.com)** with a **persistent volume**.

## Why Railway

| Need | Railway |
|------|---------|
| Git push deploys | Yes (like Vercel) |
| Persistent SQLite + theme zips | **Volume** mounted at `/data` |
| Long pipeline requests | Longer timeouts than Vercel Hobby |
| Node + `ssh2` | Docker image (included) |

**Render** is a similar alternative; attach a disk or use the same Docker + volume pattern.

---

## One-time setup on Railway

1. Push this repo to GitHub.
2. [Railway](https://railway.com) → **New Project** → **Deploy from GitHub** → select `wordpress-bot`.
3. Railway detects the **Dockerfile** (see `railway.toml`).
4. Open the **service** (wordpress-bot) → **Volumes** tab → **Add volume** → mount path: **`/data`** (required — without this, dashboard config and uploads reset on every deploy). This is **persistent disk**, not a Variable. Do **not** set `DATABASE_URL=/data` in Variables — delete that if present.
5. **Variables** (optional overrides; Dockerfile defaults shown):

   | Variable | Example |
   |----------|---------|
   | `DATABASE_URL` | `file:/data/prisma/prod.db` |
   | `UPLOAD_THEMES_DIR` | `/data/uploads/themes` |
   | `XAI_MODEL` | `grok-4.6` (optional) |
   | `XAI_TIMEOUT_MS` | `900000` (optional) |

   **Important:** Do **not** set `DATABASE_URL=file:./dev.db` on Railway — settings would live on the container filesystem and disappear on redeploy. Delete that variable (the entrypoint sets `file:/data/prisma/prod.db` on the volume). The dashboard shows a storage warning if no volume is detected.

   **Volume mount path must be exactly `/data`.** If the volume is mounted elsewhere (e.g. `/app/data`), either change the mount to `/data` or set `DATABASE_URL` to `file:<that-mount>/prisma/prod.db`. The startup script uses `RAILWAY_VOLUME_MOUNT_PATH` when present.

6. **Settings** → generate a **public domain** (HTTPS).
7. **Settings → Build** → builder must be **Dockerfile** (or `npm start`, which runs the startup script before Next.js).
8. Deploy. Logs should begin with `=== wordpress-bot startup ===`, then `prisma db push`, then `Starting Next.js on 0.0.0.0:…`, then `Ready`.
9. **Networking:** The app listens on Railway’s injected **`PORT`** (often not 3000). Do **not** set `PORT` to `5173` (that is Vite, not this app). In **Settings → Networking → Public domain**, leave **target port** empty (auto) or set it to the same value as `PORT` in deploy logs. If you see `502` / “Application failed to respond”, check logs for `Starting Next.js on 0.0.0.0:` — the port there must match the domain target port.
10. **Logs:** `Stopping Container` + `npm error signal SIGTERM` on an *old* deploy is normal during a rollout. If the *new* deploy shows `Ready` then stops immediately, check `/api/health` — `ready` should be `true` (volume writable + SQLite query OK).
11. **15-minute limit:** Railway closes each HTTP/SSE request after **~15 minutes** (Pro included). Phase 2/3 in the dashboard runs **one request per page** automatically. A single heavy page (screenshot vision + many AI images) can still hit the cap — run that page alone or lower `PAGE_IMAGES_MAX_PER_PAGE` / set `PAGE_IMAGES_AI=false` to use theme assets only.

---

## After deploy

1. Open your Railway URL → configure xAI, WordPress, SFTP, brief, theme zip (same as local).
2. Run **Test connection**, then **Run pipeline**.
3. **Security:** the dashboard stores secrets. Restrict access (Railway private networking, Cloudflare Access, or VPN) until you add app login.

---

## Cron (Phase 5 / 6)

Use [Railway cron](https://docs.railway.com/guides/cron-jobs) or an external scheduler (e.g. [cron-job.org](https://cron-job.org)):

- `POST https://YOUR_DOMAIN/api/run-content-update`
- `POST https://YOUR_DOMAIN/api/run-social` with body `{ "mode": "flush" }`

Protect these routes in production (secret header or auth) if they are public.

---

## Vercel

Use Vercel only after migrating to **Postgres**, **blob storage** for themes, and **background jobs** for long pipelines. Until then, prefer Railway + volume.

---

## Local Docker smoke test

```bash
docker build -t wordpress-bot .
docker run --rm -p 3000:3000 -v wordpress-bot-data:/data wordpress-bot
```

Open http://localhost:3000
