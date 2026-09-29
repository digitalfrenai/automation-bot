# Grok-Powered WordPress Automation Engine

Local setup dashboard for configuring xAI, WordPress REST credentials, SFTP hosting, business brief, and theme uploads — then running Phases 1–8 automation (site build, blogs, content maintenance, social, E2E orchestration, and approvals).

## Stack

- Next.js (App Router), TypeScript, Tailwind CSS, Lucide Icons
- Prisma + SQLite
- OpenAI SDK → xAI (`https://api.x.ai/v1`, default model `grok-4.6`)

## Getting started

```bash
npm install
npm run db:push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the settings dashboard.

## Phases

| Phase | What it does |
|-------|----------------|
| 1–3 | Theme deploy, page scaffold, builder-aware content (Gutenberg / Elementor / Divi / HTML), SEO publish |
| 4 | Blog topics → Grok posts → SEO → auto-fix → publish or draft |
| 5 | Find stale pages/posts → refresh with Grok → SEO → publish or draft |
| 6 | Social captions/hashtags/snippets → draft, schedule, or publish (X / LinkedIn / Facebook / Instagram) |
| 7 | End-to-end orchestrator chaining Phases 1–6 |
| 8 | Management: approvals, schedules, failed tasks, auto vs manual |

**Non-breaking:** Phase 6 social is **disabled by default**. Existing Phase 1–5 buttons and routes behave as before until you enable Social.

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/config` | Load or save `SiteConfig` |
| POST | `/api/test-connection` | Verify Grok + WordPress REST |
| POST | `/api/upload-theme` | Upload theme `.zip` |
| POST | `/api/run-phase1` | SSE — Phase 1 only (theme deploy + scaffold) |
| POST | `/api/run-phase2` | SSE — Phase 2 only (regenerate page content) |
| POST | `/api/run-phase3` | SSE — Phase 3 only (SEO + publish existing content) |
| POST | `/api/run-pipeline` | SSE — Phases 1–3 (full chain) |
| POST | `/api/run-blog` | SSE — Phase 4 |
| POST | `/api/run-content-update` | SSE — Phase 5 |
| POST | `/api/run-social` | SSE — Phase 6 (`mode: generate \| flush`) |
| POST | `/api/run-e2e` | SSE — Phase 7 full chain |
| GET | `/api/jobs` | Recent job history |
| GET | `/api/manage` | Phase 8 management overview |
| POST | `/api/manage/approve` | Approve/reject blog, updates, social |

## Scheduling

- Content updates: cron `POST /api/run-content-update`
- Due social posts: cron `POST /api/run-social` with `{ "mode": "flush" }`

## Environment

Copy `.env.example` to `.env` and set `DATABASE_URL` (default SQLite file: `prisma/dev.db`).

## Deploy (production)

**Recommended:** [Railway](https://railway.com) — GitHub connect + **volume on `/data`** (same “push to deploy” feel as Vercel, but with persistent SQLite and theme uploads). See **[docs/DEPLOY.md](docs/DEPLOY.md)**.

Vercel is not recommended until the app uses Postgres + blob storage + background jobs for long pipelines.
