# CLAUDE.md — Agency OS v2

Durable project facts for any Claude Code session. Point-in-time session notes
and the current open-items punch list live in `HANDOFF.md`.

## What this is

A local-service web-design agency tool: prospect/enrich leads, qualify them
into projects, drive landingsite.ai with Claude-generated briefs. Monorepo:

- `agency-os-backend/` — Cloudflare **Worker** API (Hono + D1 SQLite). Has `wrangler.toml`.
- `agency-os-dashboard/` — Vite/React **Pages** frontend.

Backend structure: `src/routes/` (API endpoints), `src/services/`
(`claude.ts`, `places.ts`, `outscraper.ts`, `pagespeed.ts`, `reviewMiner.ts`),
`src/prompts/` (`masterBrief.ts`, `pageBrief.ts`, `reviewExtraction.ts`),
`src/db/migrations/` (timestamped SQL migrations).

## Live URLs / IDs

- Dashboard: https://agency-os-v2-dashboard.pages.dev
- API (Worker): https://agency-os-v2-api.lively-morning-d9de.workers.dev
- GitHub: `shauncarldesigns/agency-os-v2` — work flows `feat/foo` or `fix/bar` → PR → `main`
- Cloudflare account: `fb5e6618ae5c1a662bbfa0a63b28a34a`
- D1 database name: `agency-os-v2` (NOT `agency-os-v2-db`)
- Pages project: `agency-os-v2-dashboard` — **production branch is named `production`, NOT `main`**
- GCP project (Google APIs): `179028473262`

## ⚠️ Deploy mechanics — READ BEFORE DEPLOYING

These caused repeated pain; internalize them.

### Worker — auto-deploys via CI
- `.github/workflows/deploy-worker.yml` deploys on push to `main` touching
  `agency-os-backend/**` (+ manual dispatch). Typechecks, then `wrangler deploy`.
- Repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are set.
- **So: merge a backend PR to `main` and the Worker deploys itself.** No manual step.

### Dashboard — MANUAL deploy, NOT git-integrated
```bash
cd agency-os-dashboard && npm run deploy
```
- **Merging to `main` does NOT deploy the dashboard.** You must run `npm run deploy`.
- The npm script passes `--branch=production`. Without that flag a `wrangler pages
  deploy` lands as a *preview* and the apex keeps serving the OLD bundle.
- After deploying, the apex may serve a **cached** bundle briefly. Verify with a
  cache-bust: `curl -s -H "Cache-Control: no-cache" "https://agency-os-v2-dashboard.pages.dev/?cb=$(date +%s)"`
  then grep the linked `/assets/*.js` for a string you added.
- `.env.production` (gitignored, local-only) holds the prod API URL + key baked into
  the build. `.env.development.local` holds `localhost:8788` for `npm run dev` — it's
  scoped to dev mode so it can't poison production builds. Do NOT rename it back to
  `.env.local` (that loads in all modes and breaks `npm run build`).

### Applying D1 migrations — manual
Migrations under `agency-os-backend/src/db/migrations/` are not applied automatically.
After merging a PR that adds one, run:
```bash
cd agency-os-backend
npx wrangler d1 execute agency-os-v2 --remote --file=src/db/migrations/YYYY-MM-DD-name.sql
```
(Note: DB name is `agency-os-v2`, NOT `agency-os-v2-db` — the latter is a common typo.)

## Git / auth quirks

- Remote is **SSH** (`git@github.com:...`). Use it for pushes — a PAT in `~/.zshrc`
  (`GH_TOKEN`) lacks `workflow` scope and can't push `.github/workflows/**`.
- `gh` CLI calls need `source ~/.zshrc` first to pick up `GH_TOKEN`. Don't run
  `gh auth login` while `GH_TOKEN` is exported — it errors. Either `unset GH_TOKEN`
  first or just refresh the PAT value in `~/.zshrc`.
- Workflow: branch off `main` → PR → squash-merge to `main`. After merging,
  `git checkout main && git pull --ff-only` to sync.
- Node 22+ required for backend tsc + dashboard vite build. A persistent install
  lives at `~/.local/node22/` with symlinks in `~/.local/bin/{node,npm,npx}`.

## Models & APIs

- **Brief generation model:** `BRIEF_MODEL` in `routes/briefs.ts` = `claude-opus-4-7`.
  **Opus 4.7 rejects the `temperature` param** — `services/claude.ts` strips it for
  models matching `/opus-4-7/`. Brief variance comes from the angle-led prompt, not
  temperature. Review mining uses Haiku (`claude-haiku-4-5-...`), which DOES honor it.
- **Reviews:** Google Places (New) caps at 5. `services/outscraper.ts` backfills up
  to 50 (needs Worker secret `OUTSCRAPER_API_KEY`; falls back to Google's 5 if
  absent/failing). Poll cadence is `8s × 120s = 15 polls max per task` — keeps the
  per-lead subrequest budget low enough that bulk-enrich fits the Worker cap.
- **PageSpeed** uses the Places API key; that key must have **PageSpeed Insights
  API** enabled in its allowed-APIs list, or it 400s with `API_KEY_SERVICE_BLOCKED`.

## Worker subrequest cap awareness

Cloudflare Workers cap subrequests at 1000 per invocation (Paid plan). Bulk enrich
runs leads sequentially in one invocation, so per-lead subrequest cost determines
the max batch size. Current per-lead budget:

- 1–2 Places calls (search + details)
- ~15 Outscraper polls (8s interval, 120s deadline)
- 2 PageSpeed calls (mobile + desktop)
- 1 Claude review mining call

= **~20 subrequests per lead → ~50 leads safely per bulk invocation**.

The dashboard's `BULK_LIMIT` caps at 25 to leave comfortable headroom.

When a cap exhaustion DOES happen mid-batch, `enrich-all` detects
`"Too many subrequests"` in the thrown error and stops the batch cleanly. The
response includes `stoppedEarly: 'subrequest_budget_exhausted'` and
`remainingUnprocessed: N`. Untouched leads stay `pending` for retry in a fresh
invocation. Outscraper, PageSpeed, and mining all propagate cap errors instead of
swallowing them — see `routes/enrich.ts` for the rethrow logic.

## Project lifecycle (status field)

Projects move through `prospect → building → live`, optionally to `paused` or
`dead`. The qualify flow defaults new projects to `'prospect'` so the Sites tab
doesn't inflate MRR with deals that haven't closed.

- `'prospect'` — qualified, pitching, not yet signed. **EXCLUDED from MRR.**
- `'building'` — signed client, site under construction. Counts toward MRR.
- `'live'` — site is live. Counts toward MRR.
- `'paused'` — temporarily inactive client. Counts toward MRR.
- `'dead'` — churned. Excluded from MRR.

The MRR filter in `SitesPanel.tsx` and `App.tsx` is `status === 'live' || status === 'building'`.
Adjust both spots together if you change the rules.

## Brief generation evolution

Three iterations on `prompts/pageBrief.ts`. Each one corrected a specific failure mode:

- **v1 (pre-PR-#19) — wireframe.** Dictated literal H1 / subhead / section order /
  CTA placement. Every site landed with the same skeleton because the brief
  manufactured it.
- **v2 (PR #19) — job description.** Per page, said *what the page is for* and
  let landingsite design. Sites varied structurally but the copy came out as
  platform-default fluff (premier / trusted / passionate) because the builder
  was synthesizing copy with nothing specific to lift.
- **v3 (PR #26, current) — letter form.** Structured SEO block at top (URL, meta
  title, meta description hitting 150–160 chars, H1, primary keyword, schema,
  internal links) + prose creative-director memo below. No section headers in the
  letter body. Headline + subhead suggestions quoted inline as strong suggestions.
  Customer quotes verbatim with attribution. **Built-in anti-fluff word list**
  (banned: premier, trusted, leading, passionate, etc.) baked into the system
  prompt and enforced in every brief.

The master brief (`prompts/masterBrief.ts`) is also "letter-form-influenced" but
keeps the structured section headers because page briefs consume it as data.
It uses `project.services` and `project.service_areas` as **authoritative**
(PR #24) — the mined `services_performed` / `service_areas` are signal-only.

## Matrix structure

The Page Matrix shown in Brief Studio (Tier 3 only) has three sections:

1. **Foundation Pages** — Homepage, About, Services, Service Areas, Contact, FAQ.
   The Service Areas tile only renders when the project has 2+ service areas
   (single-city sites don't need a hub page that links to nothing).
2. **Individual Service Pages** — one tile per service in `project.services`.
3. **Service-area Grid** — services × cities. Only renders with 2+ cities;
   single-city would just duplicate the Individual Service Pages row.

The matrix mirrors `project.services` and `project.service_areas`; these are
edited via the unified `OperatorInputForm` modal, NOT inline on the matrix.

Soft signals layered on top:
- **Matrix-may-be-stale pill** on the Master Brief card — fires when
  `project.updated_at > master.updated_at + 2s`. Nudges to regenerate after edits.
- **Brief-additions callout** above the matrix — surfaces services/areas the
  brief markdown mentions that aren't on the project. One-click "Add to matrix"
  patches `project.services` / `project.service_areas`.

## Verifying changes

- Backend: `cd agency-os-backend && npx tsc --noEmit`. Live test by hitting the
  Worker (auth header `X-API-Key` = dashboard's `VITE_API_KEY`); watch with
  `npx wrangler tail`.
- Dashboard: `cd agency-os-dashboard && npm run build` for type + bundle check.
  No local API in development mode by default — point `VITE_API_URL` at the live
  Worker via `.env.development.local`.

## Conventions

- TypeScript throughout; run `npx tsc --noEmit` in the relevant package before committing.
- Only commit/deploy when asked. Prefer PRs over direct pushes to `main`.
- One PR per logical change. Bundle related follow-ups onto the same branch if the
  parent PR hasn't merged yet; otherwise branch off `main` for a clean follow-up.
- When PR descriptions say "deploy after merge," the dashboard step is manual —
  don't assume it landed because CI passed.
