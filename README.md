# Agency OS v2 — Shaun Carl Designs

The agency operations platform that orchestrates Cowork to drive landingsite.ai for site builds.

## Status

| Phase | Status | Where |
|---|---|---|
| 1 — Backend foundation (D1 schema, leads CRUD) | ✅ | [agency-os-backend/](agency-os-backend/) |
| 2 — Prospect + enrichment (Places, scoring, review mining) | ✅ | [agency-os-backend/src/routes/](agency-os-backend/src/routes/) |
| 3 — Frontend shell (React, styling, app shell, 5 tabs) | ✅ | [agency-os-dashboard/](agency-os-dashboard/) |
| 4 — Pipeline UI (funnel, table, lead modal, call log, CSV import) | ✅ | [components/pipeline/](agency-os-dashboard/src/components/pipeline/) |
| 5 — Prospect UI (search, results, filter pills, add-lead modal) | ✅ | [components/prospect/](agency-os-dashboard/src/components/prospect/) |
| 6 — Build + Sites (brief generator, tier-aware cards, manual Cowork handoff) | ✅ | [components/build/](agency-os-dashboard/src/components/build/), [components/sites/](agency-os-dashboard/src/components/sites/) |
| 6.5 — SEO Coverage matrix modal (services × cities, expand-site flow) | ✅ | [components/sites/MatrixModal.tsx](agency-os-dashboard/src/components/sites/MatrixModal.tsx) |
| 7 — Reports (GSC, PageSpeed, monthly snapshots, PDF export, email) | ✅ | [components/reports/](agency-os-dashboard/src/components/reports/) |
| 8 — Polish + deploy + cowork-worker | ⏳ Local complete; **deploy step requires Cloudflare creds — see below** |

## Repository layout

```
agency-os-v2/
├── README.md                                  ← This file
├── spec/spec-v2.md                            ← Build specification
├── mockups/agency-os-v2-mockup.html           ← Visual source of truth
├── agency-os-backend/                         ← Cloudflare Worker + D1 + Queues
├── agency-os-dashboard/                       ← React + Vite frontend
└── cowork-worker/                             ← Local Node CLI helper for manual Cowork handoff
```

Each subfolder has its own README with operational details.

## Run locally (3 terminals)

```bash
# Terminal 1 — backend (port 8788)
cd agency-os-backend
npm install
DASHBOARD_API_KEY=test-key \
  npx wrangler dev --local --port 8788 \
  --var DASHBOARD_API_KEY:test-key

# Terminal 2 — dashboard (port 5174)
cd agency-os-dashboard
npm install
echo 'VITE_API_URL=http://localhost:8788
VITE_API_KEY=test-key' > .env.local
npm run dev

# Terminal 3 (optional) — cowork CLI helper
cd cowork-worker
AGENCY_OS_API_KEY=test-key npm start
```

Visit http://localhost:5174.

The dashboard tab port is **5174**, not 5173 — the v1 dashboard owns 5173 and we coexist deliberately.

## Deploy to production

You need Cloudflare credentials for these. See [agency-os-backend/README.md](agency-os-backend/README.md#deploy) for the full sequence; quick version:

```bash
# Backend — provision + deploy
cd agency-os-backend
wrangler login
wrangler d1 create agency-os-v2
# Copy the database_id into wrangler.toml
wrangler d1 execute agency-os-v2 --remote --file=src/db/schema.sql
wrangler queues create brief-jobs
# Set secrets (one per env var):
wrangler secret put CLAUDE_API_KEY
wrangler secret put GOOGLE_PLACES_API_KEY
wrangler secret put GOOGLE_OAUTH_CLIENT_ID
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put DASHBOARD_API_KEY
wrangler secret put RESEND_API_KEY
wrangler deploy

# Dashboard — build + deploy to Pages
cd ../agency-os-dashboard
echo "VITE_API_URL=https://agency-os-v2-api.<your-subdomain>.workers.dev
VITE_API_KEY=<value of DASHBOARD_API_KEY>" > .env.production
npm run build
wrangler pages project create agency-os-v2-dashboard
wrangler pages deploy dist --project-name=agency-os-v2-dashboard
```

## End-to-end happy path

1. **Pipeline tab** → "+ Add Lead" — search Places, click a result to import.
2. **Pipeline tab** → click row "Enrich" — pulls reviews, scores, recommends a tier.
3. **Pipeline tab** → click "View" on lead → Pitch Prep tab to see the cold-call script.
4. **Pipeline tab** → "Log a call" entries record outcomes; status auto-promotes cold → contacted.
5. When qualified Tier 3 → click "⚡ Build" on the lead row.
6. **Build tab** → click "✦ Generate" → review the Claude-generated brief.
7. Click "📋 Copy Brief" or "⚡ Queue for Cowork" — the latter creates a project + queues the job.
8. **Sites tab** — the new project shows up as a tier-3 card.
9. After Cowork builds the pages (manually for now) → operator hits the cowork CLI's `done <jobId>` or POSTs to `/api/webhook/cowork/manual-complete`.
10. **Sites tab** → click the coverage summary → matrix modal → toggle cells → "⚡ Expand Site" → bulk page briefs queued.
11. After a month of activity → **Reports tab** → "↻ Refresh data" to pull GSC + PageSpeed → "✦ Generate" exec summary → "↓ Export Report (PDF)" or "📧 Email to Client".

## Three-Tier Pricing Model

| | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Build cost | $800 one-time | $400 one-time | Free |
| Monthly | $0 | $79 | $499 |
| Contract | None | Cancel anytime | 6-month minimum |
| Pages at launch | 5 | 5 | 8-10 + foundation |
| Monthly site work | None | Edit requests | 3 SEO service-area pages |
| External services | None | None | Merchynt (white-labeled) |

**Critical rule:** the word "Merchynt" must NEVER appear in any client-facing content (PDFs, emails, dashboard widgets). The Claude prompts in [src/prompts/](agency-os-backend/src/prompts/) bake this in.

## What v2 removes from v1

The Astro template / Keystatic / GitHub-per-client / Cloudflare Pages-per-client / image-generation pipeline are all gone. landingsite.ai hosts everything; this app just orchestrates briefs and tracks status.

## Cowork integration mode

v2 launches with **manual handoff**: the operator copies the brief from the Build tab (or runs the [cowork-worker CLI](cowork-worker/README.md)) and pastes into Cowork themselves. The full automated polling worker is deferred until the workflow is proven in production.
