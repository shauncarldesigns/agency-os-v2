# Agency OS v2

A self-serve operations platform for a one-person local-service web-design agency. Compresses the full client lifecycle — from cold prospect to live SEO-optimized site — into a single dashboard, so one operator can do the work of a small team.

## What it does

**Prospecting.** Search Google Places for local-service businesses (plumbers, roofers, etc.) in a target city. Each result is auto-scored on opportunity (no website + bad PageSpeed + claimed-but-thin GBP = high score) and tiered (T1/T2/T3 by likely deal size). One click adds qualified results to the Pipeline.

**Pipeline (cold-call CRM).** Every lead carries enriched signal: up to 50 Google reviews (via Outscraper, beyond the 5-cap Places gives), mined services and service areas, neighborhood-level landmarks, owner names, pitch quotes, PageSpeed scores. Bulk-select to re-enrich. Filter and sort by enrichment status, tier, review count, score.

**Qualify → Sites.** When a lead is worth pursuing, qualify them into a Sites project at a chosen tier. The project starts as **`prospect`** (not counted in MRR) until they sign.

**Quick Brief for the sales call.** One click on a project copies the business name + raw reviews to clipboard. Paste into landingsite.ai → demo site ready to show on the next call. Zero Claude synthesis — landingsite gets clean signal and does its own thing.

**Master Brief (post-signing).** The operator opens the unified project editor, fills in business details / brand / services / service areas / testimonials, and Claude (Opus 4.7) generates a "letter-form" master brief: a structured SEO block plus a matter-of-fact creative-director memo. A built-in anti-fluff word list bans platform-default adjectives like *premier / trusted / passionate*.

**Page Matrix.** Foundation pages (Homepage / About / Services / Service Areas / Contact / FAQ) + per-service pages + a service × city grid (only rendered with 2+ cities). Click a cell → Claude generates a per-page brief from the master. Paste each into landingsite. Mark complete when live.

**MRR + lifecycle tracking.** Sites tab shows Active Clients, Prospects, per-tier counts, total MRR. Stat tiles are clickable filters. Status lifecycle: `prospect → building → live → paused → dead`. Only signed/active statuses count toward MRR.

## Repository layout

```
agency-os-v2/
├── README.md                       ← this file
├── CLAUDE.md                       ← durable facts for Claude Code sessions
├── HANDOFF.md                      ← session snapshot, current open items
├── agency-os-backend/              ← Cloudflare Worker (Hono + D1 SQLite)
│   ├── src/routes/                 ← API endpoints
│   ├── src/services/               ← Claude, Places, Outscraper, PageSpeed, reviewMiner
│   ├── src/prompts/                ← masterBrief, pageBrief, reviewExtraction
│   └── src/db/                     ← schema + migrations
└── agency-os-dashboard/            ← Vite + React frontend (Pages)
    └── src/components/
        ├── prospect/               ← Places search, scoring, add-to-pipeline
        ├── pipeline/               ← Lead table, filters, modal, call log
        ├── sites/                  ← Project cards, Brief Studio, Quick Brief
        ├── briefs/                 ← Master/page brief editor, intake form
        └── reports/                ← GSC + PageSpeed + monthly snapshots
```

## Tech stack

- **Backend** — Cloudflare Workers + Hono + D1 SQLite. Auto-deploys on merge to `main` via GitHub Actions (`.github/workflows/deploy-worker.yml`).
- **Dashboard** — Vite + React, deployed to Cloudflare Pages. **Manual deploy** via `npm run deploy`.
- **External services** — Google Places (data + PageSpeed), Outscraper (deep review pull), Anthropic Claude (Opus 4.7 for synthesis, Haiku 4.5 for review mining), landingsite.ai (the actual site builder).

## Live

- Dashboard: https://agency-os-v2-dashboard.pages.dev
- API: https://agency-os-v2-api.lively-morning-d9de.workers.dev

## Quick start (local development)

The Worker has no full local mode without Cloudflare bindings, but TypeScript checks and the dashboard build run anywhere with Node 22+:

```bash
# Backend typecheck
cd agency-os-backend
npm install
npx tsc --noEmit

# Dashboard dev mode (points at the live API via .env.development.local)
cd agency-os-dashboard
npm install
echo 'VITE_API_URL=http://localhost:8788
VITE_API_KEY=test-key' > .env.development.local
npm run dev
```

For full backend dev (`wrangler dev` with D1 + secrets), see the Cloudflare docs and `wrangler.toml`. Most work in this repo is done against the live backend.

## Deploy

**Backend** auto-deploys when a PR touching `agency-os-backend/**` lands on `main`. No manual step.

**Dashboard** is manual after merging a frontend change:

```bash
cd agency-os-dashboard
git pull
npm run deploy
```

The npm script passes `--branch=production` — the Cloudflare Pages production branch is literally named `production`, not `main`. Without that flag the deploy lands as a preview.

## Pricing tiers (drives matrix + brief depth)

| | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Build cost | $800 one-time | $400 one-time | Free |
| Monthly | $0 | $79 | $499 |
| Contract | None | Month-to-month | 6-month minimum |
| Pages at launch | 5 | 5 | 8–10 + foundation |
| Monthly site work | None | Edit requests | 3 SEO service-area pages |
| Brief Studio access | No | No | Yes |

Tier 3 unlocks the full Page Matrix + master brief + per-page brief generation. Tier 1/2 stay as light-weight records, primarily accessible via Quick Brief for the sales call.

## Branch + PR conventions

Work flows `feat/foo` or `fix/bar` branch off `main` → PR → squash-merge to `main`. The Worker CI deploys on merge. After merging a dashboard change, run `npm run deploy` from the local `agency-os-dashboard` directory on `main`.

See `CLAUDE.md` for deploy gotchas (cache-busting, env var precedence, the `production` branch naming surprise).

See `HANDOFF.md` for the current session snapshot and open items.
