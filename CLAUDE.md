# CLAUDE.md — Agency OS v2

Durable project facts for any Claude Code session. (Point-in-time session notes
and the current open-items punch list live in `HANDOFF.md`.)

## What this is

A local-service web-design agency tool: prospect/enrich leads, generate site
briefs with Claude, and feed them into landingsite.ai. Monorepo:

- `agency-os-backend/` — Cloudflare **Worker** API (Hono + D1 SQLite). Has `wrangler.toml`.
- `agency-os-dashboard/` — Vite/React **Pages** frontend.

Backend structure: `src/routes/` (API endpoints), `src/services/`
(`claude.ts`, `places.ts`, `outscraper.ts`, `pagespeed.ts`, `reviewMiner.ts`),
`src/prompts/` (`masterBrief.ts`, `pageBrief.ts`, `reviewExtraction.ts`).

## Live URLs / IDs

- Dashboard: https://agency-os-v2-dashboard.pages.dev
- API (Worker): https://agency-os-v2-api.lively-morning-d9de.workers.dev
- GitHub: `shauncarldesigns/agency-os-v2` — work flows `refactor/v2.1` → PR → `main`
- Cloudflare account: `fb5e6618ae5c1a662bbfa0a63b28a34a`
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

## Git / auth quirks

- Remote is **SSH** (`git@github.com:...`). Use it for pushes — a PAT in `~/.zshrc`
  (`GH_TOKEN`) lacks `workflow` scope and can't push `.github/workflows/**`.
- `gh` CLI calls need `source ~/.zshrc` first to pick up `GH_TOKEN`.
- Workflow: branch off `refactor/v2.1` → PR → squash-merge to `main`. After merge,
  `git checkout refactor/v2.1 && git reset --hard origin/main` to resync.

## Models & APIs

- Brief generation model: `BRIEF_MODEL` in `routes/briefs.ts` = `claude-opus-4-7`.
  **Opus 4.7 rejects the `temperature` param** — `services/claude.ts` strips it for
  models matching `/opus-4-7/`. Brief variance comes from the angle-led prompt, not
  temperature. Review mining uses Haiku (`claude-haiku-4-5-...`), which DOES honor it.
- Reviews: Google Places (New) caps at 5. `services/outscraper.ts` backfills up to 50
  (needs Worker secret `OUTSCRAPER_API_KEY`; falls back to Google's 5 if absent/failing).
- PageSpeed uses the Places API key; that key must have **PageSpeed Insights API**
  enabled in its allowed-APIs list, or it 400s with `API_KEY_SERVICE_BLOCKED`.

## Verifying changes

- Backend: `cd agency-os-backend && npx tsc --noEmit`. Live test by hitting the Worker
  (auth header `X-API-Key` = dashboard's `VITE_API_KEY`); watch with `npx wrangler tail`.
- Dashboard UI: the API isn't running locally, so use a Vite preview + mocked
  `window.fetch` returning mock leads. Pipeline table is the default view; lead modal
  opens on row click; master-brief modal is deeper (Sites → project → master brief).

## Conventions

- TypeScript throughout; run `npx tsc --noEmit` in the relevant package before committing.
- Only commit/deploy when asked. Prefer PRs over direct pushes to `main`.
