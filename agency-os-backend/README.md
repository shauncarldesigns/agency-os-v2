# agency-os-v2-backend

Cloudflare Worker API for Agency OS v2.

- **Runtime:** Cloudflare Workers (Hono router)
- **Database:** D1 (SQLite-on-the-edge)
- **Queue:** Cloudflare Queues (`brief-jobs`)
- **Cron:** 3 scheduled handlers — daily PageSpeed, monthly snapshot, weekly GSC refresh

## Quick start (local)

```bash
npm install
DASHBOARD_API_KEY=test-key \
  npx wrangler dev --local --port 8788 \
  --var DASHBOARD_API_KEY:test-key
```

The first run creates a local D1 file under `.wrangler/state/`. Apply the schema once:

```bash
npx wrangler d1 execute agency-os-v2 --local --file=src/db/schema.sql
```

If you've already migrated past the initial schema, run any pending files in `src/db/migrations/` too.

## Routes

All endpoints under `/api/*` require `X-API-Key: $DASHBOARD_API_KEY`.

### Leads / Pipeline
| Method | Path | Notes |
|---|---|---|
| GET | `/api/leads` | filters: `status`, `tier`, `enrichment`, `search` |
| GET | `/api/leads/:id` | includes call_log |
| POST | `/api/leads` | dedup by `company + phone` |
| PUT | `/api/leads/:id` | whitelisted fields only |
| DELETE | `/api/leads/:id` | soft delete (status='dead') |
| POST | `/api/leads/import` | text/csv body, dedup by `place_id` or `company+phone` |
| GET | `/api/leads/export` | full CSV dump |
| POST | `/api/leads/:id/enrich` | resolves Place → details → PageSpeed → review mining → score |
| POST | `/api/leads/enrich-all` | bulk; respects `{ limit }` (default 25, max 100) |

### Calls
| Method | Path | Notes |
|---|---|---|
| GET | `/api/leads/:id/calls` |  |
| POST | `/api/leads/:id/calls` | also bumps lead status cold→contacted |
| DELETE | `/api/calls/:id` |  |

### Prospect (Google Places)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/prospect/search` | body `{ location, industry, radius }` — returns scored results |
| GET | `/api/prospect/place/:placeId` | 24h D1 cache when previously imported |
| POST | `/api/prospect/add-to-pipeline` | body `{ placeIds: [...] }` |

### Projects (client sites)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/projects` | filters: `tier`, `status` |
| GET | `/api/projects/:id` | includes pages |
| POST | `/api/projects` | converts a lead → project (sets contract + Merchynt for Tier 3) |
| PUT | `/api/projects/:id` |  |
| GET | `/api/projects/:id/coverage` | services × cities matrix with cell states |
| POST | `/api/projects/:id/expand` | bulk-creates pages + queues briefs (max 50) |

### Briefs
| Method | Path | Notes |
|---|---|---|
| POST | `/api/briefs/generate` | initial-build → Claude; add-page → template |
| POST | `/api/briefs/queue` | inserts brief_jobs row + sends to Cloudflare Queue |
| GET | `/api/briefs/queue/status` | active + recent jobs |

### Webhooks (Cowork callbacks)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/webhook/cowork/started` | marks job processing |
| POST | `/api/webhook/cowork/completed` | marks done or failed; bumps `pages_built` |
| POST | `/api/webhook/cowork/manual-complete` | shortcut for the manual-handoff workflow |

### Reports (Tier 3)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/reports/:projectId/summary?period=YYYY-MM` | snapshot + previous + keyword wins |
| POST | `/api/reports/:projectId/refresh` | re-pulls GSC + PageSpeed + CF |
| POST | `/api/reports/:projectId/snapshot` | refresh + Claude-generated exec summary |
| POST | `/api/reports/:projectId/export` | returns standalone HTML (printable to PDF) |
| POST | `/api/reports/:projectId/email` | sends HTML to `client_email` via Resend |

## Cron schedule

Defined in [wrangler.toml](wrangler.toml):
- `0 6 * * *` — daily PageSpeed refresh for live Tier 3 sites
- `0 7 1 * *` — monthly 1st: finalize prior-month snapshots + Claude exec summaries
- `0 8 * * 1` — weekly Monday: refresh current-period GSC data

## Environment / secrets

Set via `wrangler secret put <NAME>`:

| Name | Used by |
|---|---|
| `CLAUDE_API_KEY` | brief generation, review mining, exec summaries |
| `GOOGLE_PLACES_API_KEY` | Places search + PageSpeed (same key) |
| `GOOGLE_OAUTH_CLIENT_ID` | Search Console OAuth |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Search Console OAuth |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Search Console OAuth |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Analytics |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Analytics |
| `DASHBOARD_API_KEY` | dashboard auth (any random hex string) |
| `RESEND_API_KEY` | client report email |

Generate a fresh `DASHBOARD_API_KEY` with `openssl rand -hex 32`.

## Deploy

```bash
# 1) Login + provision
wrangler login
wrangler d1 create agency-os-v2
# → copy the database_id into wrangler.toml [[d1_databases]]
wrangler queues create brief-jobs

# 2) Apply schema to remote
wrangler d1 execute agency-os-v2 --remote --file=src/db/schema.sql
# (and any later migration files)

# 3) Set secrets — one prompt per
wrangler secret put CLAUDE_API_KEY
wrangler secret put GOOGLE_PLACES_API_KEY
wrangler secret put GOOGLE_OAUTH_CLIENT_ID
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put DASHBOARD_API_KEY
wrangler secret put RESEND_API_KEY

# 4) Deploy
wrangler deploy
```

The deployed URL will be `https://agency-os-v2-api.<subdomain>.workers.dev`.

## Architecture notes

- **D1 schema** in `src/db/schema.sql` with all 8 tables. Migrations are additive `ALTER`s in `src/db/migrations/`.
- **Lifted from v1** verbatim or near-verbatim: `services/places.ts`, `services/pagespeed.ts`, `services/claude.ts` (wrapper), `services/gsc.ts`, `services/cloudflare.ts` (just `getZoneAnalytics`), `utils/auth.ts`, `utils/errors.ts`, `utils/slug.ts`.
- **New in v2**: `services/scoring.ts`, `services/reviewMiner.ts`, `services/email.ts`, `prompts/*`, all reports/projects/briefs/webhook routes.
- **No image pipeline, no Astro, no GitHub-per-client, no R2 site storage** — landingsite.ai handles all hosting.

## Testing

There is no automated test suite yet — Phase 8 testing is by manual smoke. To do a clean verification:

```bash
# kill the local D1, reapply schema, restart dev
rm -rf .wrangler/state/v3/d1
npx wrangler d1 execute agency-os-v2 --local --file=src/db/schema.sql
DASHBOARD_API_KEY=test-key npx wrangler dev --local --port 8788 --var DASHBOARD_API_KEY:test-key &
# then exercise the dashboard at http://localhost:5174
```
