# agency-os-v2-dashboard

React + Vite frontend for Agency OS v2.

- **Framework:** React 18 + Vite 5 + TypeScript (strict)
- **No CSS framework** — global stylesheet copied directly from [the spec mockup](../mockups/agency-os-v2-mockup.html)
- **No state library** — local React state + a thin API client + `useToast` hook is enough at this scale

## Quick start

```bash
npm install
echo 'VITE_API_URL=http://localhost:8788
VITE_API_KEY=test-key' > .env.local
npm run dev
```

Then visit http://localhost:5174 (port intentionally avoids the v1 dashboard on 5173).

## Five tabs

| Tab | Status | What it does |
|---|---|---|
| 🔍 Prospect | Phase 5 | Google Places search → scored, filtered results → one-click Add to Pipeline (row fades to 30% opacity) |
| 📋 Pipeline | Phase 4 | Stage funnel, tier prospects stats, leads table with 4 enrichment states, lead modal (Overview / Reviews / Pitch Prep / Call Log), CSV import, Add Lead modal |
| ⚡ Build | Phase 6 | Cowork queue strip, lead context banner, Claude-generated brief preview, tier config, copy-or-queue handoff |
| 🌐 Sites | Phase 6 + 6.5 | Tier-aware site cards, hosting/coverage/handoff variants per tier, SEO coverage matrix modal with expand-site flow |
| 📊 Reports | Phase 7 | Tier 3 only — client + period filters, exec summary banner, MoM stats, keyword wins table, Export Report (PDF preview + Email to Client) |

## Architecture

```
src/
├── main.tsx                  ← entry
├── App.tsx                   ← header, nav, panel routing, header stats
├── lib/
│   ├── api.ts                ← typed fetch wrapper for every backend route
│   ├── types.ts              ← shared types (Lead, Project, BuildContext, ReportSummary, …)
│   ├── format.ts             ← formatPhone, scoreColor, statusBadge, parseList<T>, etc.
│   └── utils.ts              ← (none yet)
├── hooks/
│   └── useToast.ts           ← toast queue with auto-dismiss
├── styles/global.css         ← CSS variables + every component class from the mockup
├── components/
│   ├── layout/Header.tsx, Nav.tsx
│   ├── shared/{Toast, Modal, Button, Badge, Spinner, TierPill, EmptyState}.tsx
│   ├── prospect/{ProspectPanel, SearchForm, ResultsTable, ResultRow, FilterPills}.tsx
│   ├── pipeline/{PipelinePanel, StageFunnel, TierStats, EnrichmentStrip,
│   │              LeadsTable, LeadModal, CallLogTab, ImportCsvModal, AddLeadModal}.tsx
│   ├── build/{BuildPanel, BriefEditor, TierConfig, CoworkQueueStrip}.tsx
│   ├── sites/{SitesPanel, SiteCard, MatrixModal}.tsx
│   └── reports/{ReportsPanel, ClientFilter, ExecSummary, MoMStats,
│                KeywordWins, ExportReportModal}.tsx
```

## Type-check / build

```bash
npm run type-check    # tsc --noEmit
npm run build         # tsc -b && vite build
```

Build output lands in `dist/`.

## Deploy to Cloudflare Pages

```bash
echo "VITE_API_URL=https://agency-os-v2-api.<subdomain>.workers.dev
VITE_API_KEY=<DASHBOARD_API_KEY value>" > .env.production
npm run build
wrangler pages project create agency-os-v2-dashboard
wrangler pages deploy dist --project-name=agency-os-v2-dashboard
```

You can also set `VITE_API_URL` and `VITE_API_KEY` as Pages-project environment variables instead of bundling them at build time.

## Conventions

- **No CSS modules** — every class is in `global.css`. Inline `style={{ … }}` only for one-off layout where adding a new class would be noise.
- **Tier-aware variants** are encoded as `tier1` / `tier2` / `tier3` strings on `Button` + `Badge` + `TierPill` props.
- **Toasts** for every success and every error path. Errors come from `ApiError` thrown by `api.ts`.
- **No optimistic UI** for now — every mutation does a refetch. Easy to optimize later if it gets sluggish.
