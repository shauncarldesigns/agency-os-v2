# CLAUDE.md — Agency OS v2

Durable project facts for any Claude Code session. Point-in-time session notes
and the current open-items punch list live in `HANDOFF.md`.

## What this is

A local-service web-design agency tool: prospect/enrich leads, qualify them
into projects, drive landingsite.ai with Claude-generated briefs. Monorepo:

- `agency-os-backend/` — Cloudflare **Worker** API (Hono + D1 SQLite). Has `wrangler.toml`.
- `agency-os-dashboard/` — Vite/React **Pages** frontend.

Backend structure: `src/routes/` (API endpoints), `src/services/`
(`claude.ts`, `places.ts`, `outscraper.ts`, `pagespeed.ts`, `reviewMiner.ts`,
`cloudflare.ts`, `dnsConstants.ts`),
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

## Light theme + sidebar shell (added 2026-07-19)

**The app is light-mode only. There is no dark mode.** PR #134 replaced the
dark top-nav layout with a sidebar shell (`components/layout/AppShell.tsx`,
canonical visual spec came from an external mockup package). Slate palette,
white surfaces, blue→indigo gradient accent, system font stack.

- **Two styling systems coexist during migration.** New pages are plain
  Tailwind utilities (preflight ON). Legacy panels still use semantic
  classes from `src/styles/global.css` (~1,080 lines), whose `:root` token
  block was flipped to light values — so legacy panels render light without
  JSX changes. End state: migrate panels to Tailwind one PR at a time, then
  delete `global.css`. Do NOT add new `global.css` classes.
- `html{font-size:18px}` is retained for legacy-panel rem sizing; revisit
  when `global.css` dies (Tailwind assumes 16px).
- Nav structure: Main = Dashboard / Call Sessions / Cold Call Pipeline /
  Automated Pipeline / Lead Finder; Work = Clients & Sites / Playbook /
  Reports. "Lead Finder" is the former Prospect tab; `Tab` key is still
  `'prospect'`.
- **ExecutionView renders inside the shell's `<main>`** — sidebar stays
  visible during calls. It no longer takes over the viewport.
- Call Sessions page = the WHOLE calling operation
  (`components/sessions/CallSessionsPage.tsx`): the former Dashboard
  operating view (today's sessions, Hot Leads, agency summary, objections
  overview — still `DashboardPanel` internally) on top, plus the
  week-paginated Session history browser below. **The Dashboard tab is
  intentionally empty** — the operator reserved it for a future feature
  (2026-07-21); don't put content back there without asking.
- Playbook page = read-only browser over the playbook markdown
  (`components/playbook/PlaybookPage.tsx`); editing stays in
  `agency-os-backend/src/playbook/*.md`.

## Automated Pipeline (added 2026-07-19)

Text + site outreach motion, orthogonal to the cold-call motion. One `leads`
row serves both flows: cold-call lifecycle lives on `leads.status`, the
text+site flow on `leads.pipeline_status` (`awaiting_build → ready_to_send →
sent_no_reply → engaged`, plus reserved `booked`/`archived`). **Never
repurpose one for the other.**

- **Columns added** (migration `2026-07-19-lead-pipeline.sql`):
  `pipeline_status`, `site_url` (UTM-tagged, source of truth for texting),
  `site_url_raw`, `pipeline_brief`, `campaign_slug`, `clarity_tag`,
  `pipeline_sessions`, `pipeline_last_action_at`. Plus `lead_activity`
  audit table backing `/undo`.
- **Queue filter** (`GET /api/pipeline/leads`): `deleted_at IS NULL AND
  status IN ('cold','contacted') AND has_website=0 AND
  enrichment_status='enriched'`, ordered `opportunity_score DESC`.
- **Status transitions are enforced server-side** in `routes/pipeline.ts`
  (`site-url` only from `awaiting_build`; `intro_sent` only from
  `ready_to_send`; `followed_up`/`called` never change status).
- **Click tracker `GET /r/:lead_id`** is PUBLIC — mounted before the
  `/api/*` auth middleware in `index.ts`. Texted links point at `/r/{id}`,
  never the raw site URL. First click auto-promotes `sent_no_reply →
  engaged`. Logs coarse UA class only (privacy).
- **Brief generation** — `POST /api/pipeline/leads/:id/brief`, Haiku 4.5,
  prompt in `prompts/pipelineBrief.ts` (fixed section headers because
  landingsite consumes it as prompt input; same anti-fluff word list as
  master briefs). Cached on `pipeline_brief`; `{regenerate:true}` forces.
  Two verbatim blocks are appended server-side (never model-authored):
  `CONTACT DETAILS (VERBATIM)` then `CUSTOMER REVIEWS (VERBATIM)` — the
  brief is landingsite's only data source, so exact values can't be left
  to model transcription (a brief once demanded "the phone number"
  without stating the digits; the block also carries the Google Maps
  listing URL from `place_id` as the schema `sameAs` link — place_ids
  are transcription-hostile). Each brief also carries a `SEO SPECIFICS
  (USE VERBATIM)` section (exact title tag, meta description, primary
  search phrase, Schema.org type mapped from trade in code, area-served
  list including the review-mined `extracted_service_areas` towns), a
  `HERO COPY (USE VERBATIM)` section — the brief authors the exact H1 + subhead
  because landingsite's own hero generation converges on trust-cliché
  formulas ("Honest X You Can Trust") on every site; the operator
  explicitly wants hero copy owned on our side, not landingsite's —
  and a `DESIGN DIRECTION` section (palette hex codes, typography, hero
  layout, signature element). Both are varied deterministically in
  code, seeded by lead id (8 headline angles; 10×6×5×8 design combos) —
  model-chosen "unique" output converges, so variance is manufactured
  upstream (same lesson as angle-led master briefs). The operator is
  NOT concerned with demo color fidelity (colors are easily changed
  inside landingsite); copy sameness is the concern that matters.
- **SMS sending is `sms:` deep links only** (`?&body=` variant — most
  compatible across iOS/Android; body prefill is inconsistent, which is why
  every composer keeps a Copy fallback). No Twilio/A2P by explicit scope
  decision.
- Engagement Layer 2 (Clarity Data Export sync into `pipeline_sessions`)
  is designed but NOT built; Layer 1 (click tracker) is the trustworthy
  signal.

## Calling Dashboard (added 2026-06-14)

The Dashboard tab is the default landing view. Pre-composes calling sessions
for Tue/Wed/Thu, runs an execution view for one-lead-at-a-time calling,
captures outcomes via 4 buttons + skip, and books demos through a HoneyBook
split-pane embed.

**Vocabulary** — Phase 0 changed lead-status semantics. `qualified` now means
"demo booked, prospect project exists, awaiting outcome" (not "ready to
pitch"). `client` means "signed, has a building/live project." `not_interested`
is for cold-call rejections. `dead` is reserved for churned former clients.

**Tables (Phase 2):**
- `sessions` — one calling block (morning/evening) per day, with composition
  parameters (industry, score_floor, geographic_filter, lead_count_target).
- `session_leads` — M2M with per-call outcome (voicemail / not_interested /
  callback / booked / skipped).
- `callbacks` — day-precision callback queue.
- `demos` — booked-demo lifecycle (booked → held / no_show / rescheduled).
- `demo_events` — audit trail for the demo lifecycle.
- `weekly_rotation` — single-row table (CHECK id=1) holding the industry
  rotation cursor across weeks. Preferred over env config so operator can
  mutate without redeploy.

`leads` got 5 pointer columns: `pitch_card_text`, `pitch_card_generated_at`,
`last_called_at`, `demo_booked_at`, `demo_scheduled_for`.

**Composition recipe (`services/sessionComposer.ts`):**
- Industry rotation: fixed array (Plumbing, HVAC, Electrical, Roofing,
  General Contracting), resumes from `weekly_rotation.last_industry`.
- Filter: enrichment_status='enriched', status IN ('cold','contacted'),
  recommended_tier NOT NULL, industry match, score >= floor, optional
  geographic filter, 14-day `last_called_at` exclusion.
- Order: `opportunity_score DESC, last_called_at ASC NULLS FIRST`.
- Cross-session dedup within a week — same lead can't be in two sessions.
- Widening cascade when strict filter doesn't fill: drop score floor in
  10-point steps to 30 → drop geographic filter → drop 14-day exclusion
  (last resort).

**Timezone (`services/dayOfWeek.ts`):** hardcoded `America/Chicago`. Workers
run in UTC. Any "what day is it for the operator" question must route
through this module — naive `Date.getDay()` in UTC flips a day boundary
6 hours early.

**Day-of-week routing:**
- Mon → prep day, MondayView (week-ahead + prospecting block)
- Tue/Wed/Thu → calling day, PriorityStrip + SessionsGrid
- Fri → review day, FridayView (week metrics + callback recovery)
- Sat/Sun → quiet, placeholder

**Endpoints (mounted at `/api/sessions/*`, `/api/callbacks/*`, `/api/demos/*`,
`/api/dashboard/*`):**
- `POST /sessions/generate-week` — auto-composes 6 sessions for next calling
  week using industry rotation.
- `POST /sessions/:id/start` — activate. Rejects 409 if another active.
  Materializes the lead pool via composeWithWidening.
- `POST /sessions/:id/outcome` — single endpoint, body `{leadId, outcome,
  notes?, callbackDate?, demoData?}`. Handles all 5 outcomes including the
  side-effects (callback row, demo row, lead status flip).
- `POST /sessions/:id/extend` — body `{count}`. Returns widened steps so the
  burn-through UI can show what changed.
- `POST /dashboard/leads/:id/pitch-card` — on-demand Haiku-based pitch card
  generation. Cached on `leads.pitch_card_text`.
- `PUT /demos/:id/status` — body `{status, newDate?, notes?}`. Reschedule
  writes both the new scheduled_for AND a `demo_events` audit row.

**Components live at `components/dashboard/`:**
- `DashboardPanel.tsx` — top-level, day-of-week routed.
- `ExecutionView.tsx` — full-screen overlay, contains pitch card / signals /
  outcome buttons / keyboard shortcuts (1/2/3/4/S).
- `BookDemoModal.tsx` — split-pane HoneyBook booking.
- `MondayFridayViews.tsx` — Mon/Fri views + shared ProspectingTaskBlock.
- `RescheduleDemoModal.tsx` — proper datetime+notes form for reschedule.

**HoneyBook embed:** placement ID is hardcoded in `BookDemoModal.tsx`. The
controller script is injected once globally via a ref guard on
`window._HB_.__scriptInjected` (StrictMode-safe). Spike confirmed the embed
renders inside our modal-overlay pattern — no fallback needed. If volume
ever justifies it, the embed should be replaced with a direct HoneyBook API
call from the Worker (currently scoped out).

**Notes drafts:** `ExecutionView` persists notes textarea content to
`localStorage` keyed by `session_lead_id`, debounced 800ms. Cleared on
outcome record. Survives modal close / browser refresh mid-call.

**Spec doc:** the full Calling Dashboard spec lives in `spec/calling-dashboard.md`
(or wherever the operator keeps it). Notable design decisions: pitch card NOT
backfilled for existing leads (operator clicks ↻); demos awaiting status
uses past-today (not past-now); skipped outcome is silent (no call_log
entry, no `last_called_at` update); only one session can be `active` at a
time (409 conflict otherwise).

## Playbook system (added 2026-06-17)

The calling cockpit (formerly the static ExecutionView) runs active sales
playbooks. It now supports three cold-call approaches in the cockpit selector:
No-oriented, Question-oriented, and Quick-oriented. Scripts + objection
rebuttals are authored as markdown under `agency-os-backend/src/playbook/`,
bundled into the Worker at build time, and parsed at runtime via
`services/playbook.ts`.

- **Content layout** — `scripts/*.md` (cold call + demos), `objections/*.md`
  (simple + branching chips), `follow-ups/*.md` (email sequence). Every file
  has YAML frontmatter; branching objections use `## Path: {id}` body sections
  matching `paths[].id`, scripts use `## Stage: {id}` matching `stages[].id`.
  Operator-facing meta (the things to NOT say aloud) goes into `> blockquote`
  lines and parses out into a separate `note` field.
- **Bundling — Workers have no fs.** `wrangler.toml` `[[rules]] type =
  "Text" globs = ["**/*.md"]` makes esbuild inline each imported `.md` as
  a string. Adding a new markdown file requires explicit import in
  `services/playbook.ts` — no glob runtime discovery.
- **YAML parser** — `yaml` package (eemeli/yaml). Adds ~25 KB to the Worker
  bundle (240→527 KB total after this feature shipped).
- **Token interpolation** — `[Company Name]`, `[Name]`, `[city]`, `[state]`,
  `[their trade]` get replaced at render time from `LeadContext`.
- **Read endpoints** (`/api/playbook/*`) — `_debug` (eagerly parses everything;
  curl-able health check), `scripts`, `scripts/:id`, `objections`,
  `objections/:id`, `follow-ups/:id`.
- **Generate-rebuttal** — `POST /api/playbook/generate-rebuttal` (Claude
  Haiku 4.5, temperature 0.85, 3 JSON variants). `POST /generations/:id/mark-used`
  records the operator's "Use this" click. All generations logged to the
  `playbook_generations` table including failures.
- **Objection hits log** — every cockpit chip tap auto-appends a hit
  (`{objection_id, path_id?, handled, timestamp_s, generation_id?}`) to a
  per-call array. Sent with the outcome and persisted as JSON in
  `call_log.objection_hits`. The `/api/dashboard/objections-overview`
  endpoint aggregates this via SQLite `json_each()` for the dashboard's
  frequency + handled-rate cards.

**Tables added:**
- `playbook_generations` — Claude rebuttal generation log (request +
  response JSON + model + used_variant_index + status + duration).
- `call_log.objection_hits` — JSON column (nullable; null on pre-feature
  rows).

**Migrations (run manually per CLAUDE.md deploy mechanics):**
- `2026-06-17-playbook-generations.sql`
- `2026-06-17-call-log-objection-hits.sql`

**Cockpit UI changes** — the prior pitch card, Log-a-Call form, and
sidebar Scores+Signals+Prior-Calls are gone; replaced by script panel +
objection chips + notes textarea with auto-tagged objection lines. The
operator can still open a lead's modal from Pipeline for full historical
context.

**Approach-specific objection trays** — Question-oriented hides website-specific
objections until a reveal stage. Quick-oriented uses a narrow tray of eight
quick-mode objections (`quick-im-busy`, `quick-too-busy`, `quick-website-calls`,
`quick-facebook-page`, `quick-why-website`, `quick-cost`,
`quick-word-of-mouth`, `quick-pushback`) so the short call flow stays
lightweight. Quick-oriented also has an optional left-side branch stage
`rebuttal-reveal` between Demo reveal and Demo ask for skeptical "website calls"
moments; it is intentionally not a right-side objection.

## Hot Leads (added 2026-06-17)

Operator-curated priority queue separate from auto-composed sessions. Pipeline
row checkboxes get a "🔥 Add to hot leads" bulk button; a red-accented "Hot
Leads" card sits above the WeekPlanner on the dashboard.

- **Sentinel row on `sessions`** — one persistent hot session per DB with
  `session_date='hot'`, `block='hot'`, `industry='mixed'`, `status='active'`
  indefinitely. Kind discriminated by new `sessions.kind` column ('auto' |
  'hot'). Migration `2026-06-17-session-kinds.sql`.
- **Active-session lock loosens per-kind.** Two active sessions are allowed
  as long as they're different kinds (one auto + one hot). Same-kind conflict
  still throws 409.
- **WeekPlanner filters `kind='auto'`** so the hot session doesn't appear in
  the weekly grid; `activeSession` field also filtered to auto so the
  "WORKING NOW" banner only surfaces auto sessions.
- **New endpoints:** `GET /api/sessions/hot`, `POST /api/sessions/hot/add`
  (body `{lead_ids: number[]}`, INSERT OR IGNORE for dedup).

## Call Recordings (added 2026-07-01)

Mid-call audio capture via browser MediaRecorder API → R2 bucket → public URL
persists on `call_log.recording_url`.

- **R2 bucket:** `agency-os-recordings`, public access enabled. Base URL:
  `https://pub-80e0811bf1bd472a8ff972eb94b314e0.r2.dev`. Binding name in
  Worker: `RECORDINGS` (see `wrangler.toml`).
- **Cockpit Record button** in utility row has 4 states: idle / recording
  (pulses red, live MM:SS) / uploading / done. Timer rebases to
  record-start when clicked, so objection-hit timestamps are relative to the
  recording rather than cockpit-mount time.
- **`POST /api/recordings`** — multipart upload. Streams to R2 via
  `R2.put(file.stream())`. Immediately creates a placeholder call_log row
  with `outcome='Recording'` so the recording is never orphaned. Returns
  `{ url, key, bytes, call_id }`.
- **Outcome merge logic:** if the cockpit passes `recordingCallId` in the
  outcome submit, `POST /api/sessions/:id/outcome` and
  `POST /api/leads/:id/calls` UPDATE that row instead of INSERTing a new
  one. Keeps recording + outcome as a single call_log entry.
- **Orphan recovery:** `GET /api/leads/:id/recordings` lists R2 objects
  under `calls/{leadId}/`, cross-references with `call_log` to mark each
  as attached or orphan. `POST /api/leads/:id/recordings/attach` creates
  a placeholder call_log row for an orphan URL. CallLogTab renders a
  yellow "orphan recording" block with a "Save to call log" button.
- **Playback:** Pipeline LeadModal's CallLogTab renders "🎙 Play recording ↗"
  link on any call_log entry with a recording_url. Opens in a new browser
  tab with native audio controls.

Migration: `2026-06-17-call-log-recording-url.sql` (added `recording_url TEXT`
column).

## Voicemails to Redial (added 2026-07-01)

Sixth section on the dashboard Priority Strip alongside demos-awaiting /
no-show / demos-today / callbacks-due.

Query: leads with `outcome='Voicemail Left'`, `last_called_at` within 14 days,
`status IN ('cold','contacted')`, ordered oldest-first, limit 50. Badge on
each row flips gray (Redial) → yellow (Aging) at 7+ days.

Returned from `GET /api/dashboard` under `priorityStrip.voicemailsToRedial`.

## Reference docs under `docs/` (added 2026-07-01)

Not parsed by the app. Human/AI-readable snapshots of the playbook + demo
flows, for Claude chat sessions running practice calls.

- `docs/practice-cold-calls.md` — mirror of live cold-call script + objection
  library + demo scripts + email follow-up.
- `docs/practice-demo-calls.md` — full demo call flow (more polished than
  the app's runtime demo scripts — includes domain check, Google landscape
  education, 5-point walkthrough with FAQ→AI hook, expanded Growth pitch).

Regenerate by re-reading all files under `agency-os-backend/src/playbook/`
and reassembling. Runtime demo scripts and this doc may drift — sync as a
separate PR when the operator asks.

## Cloudflare DNS management (added 2026-06-14)

Every project can have a Cloudflare zone for its client domain. Records are
created by the app, not by hand. Quick Action button in the project sidebar:
"⚡ Add domain & DNS" (first-time) flips to "🔧 Manage DNS" once a zone exists.

- **Records, hard-coded in `services/dnsConstants.ts`:**
  - A `@` → 75.2.29.147
  - A `@` → 166.117.246.71
  - CNAME `www` → proxy-ssl.getlandingsite.com
- **Proxy MUST be OFF** (gray cloud) on every record. Landingsite issues the SSL
  cert directly; Cloudflare's orange-cloud proxy intercepts TLS and breaks it.
  `createDnsRecord` hard-codes `proxied: false` — no caller can override.
- **Reuses `cf_zone_id`** column (originally for zone analytics). Did NOT add a
  duplicate `cloudflare_zone_id`. The analytics path in `reports.ts` still works
  but only meaningfully returns data for proxied sites — which landingsite
  clients are not. Likely dead-path for current clients; left in place.
- **Subdomain limitation:** Cloudflare zones are per-apex. You can't create a
  zone for `magee-plumbing.agncy.dev` — the setup endpoint will 1116 with
  "provide the root domain." For `*.agncy.dev` style demos, add records
  manually under the existing `agncy.dev` zone (the app doesn't help yet).
- **CF token scope requirement (one-time operator setup):** the runtime token
  (`CLOUDFLARE_API_TOKEN` secret) must have `Zone:Edit` + `DNS:Edit` + at least
  `Account Settings:Read` (the last one is required for `account.id` in the
  POST /zones body to resolve). Account-level token resources must include the
  agency CF account. Pre-DNS-feature, this token only needed `Zone Analytics:
  Read` — anyone bootstrapping a new deploy must upgrade scope.
- **Endpoints** (mounted under `/api/projects/:id/dns/*`):
  - `POST /setup` body `{ domain, registrar?, domain_owner_email? }` —
    rejects 409 if zone already exists. Pass `?replace=true` to orphan the old
    zone and create a fresh one (used by the Edit Project domain-swap flow).
    Old zone left in CF account for manual cleanup; ID is logged for audit.
  - `GET /status` — pulls live zone status + record found/missing. Auto-flips
    `pending → active` if CF reports active.
  - `POST /retry` — re-creates missing records; recovers from `failed` state.
- **Cron:** hourly `0 * * * *` calls `pollPendingDnsZones()`. Partial index
  `idx_projects_dns_pending` (created in the 2026-06-14 migration) makes the
  SELECT cheap when nothing's pending.
- **Sidebar reactivity:** the DNS card in `SiteDetailPanel` self-polls every
  60s while `dns_status='pending'`, stops automatically once active. Cheaper
  than a global poll because it only fires when the operator is looking.

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

## Cron triggers (wrangler.toml)

Four crons currently scheduled in `[triggers]`:

- `0 6 * * *` — daily 6am — refresh PageSpeed for live Tier 3 sites
- `0 7 1 * *` — monthly 1st 7am — finalize prior-month snapshots + exec summaries
- `0 8 * * 1` — weekly Monday 8am — intermediate GSC refresh
- `0 * * * *` — hourly — DNS poll for projects awaiting nameserver delegation

Dispatched via the `scheduled` handler in `src/index.ts`. Each branch matches
on `event.cron` exactly. Adding a new cron requires both a `wrangler.toml`
entry AND a handler branch — the deploy will succeed without the handler but
the cron will silently no-op.

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
- **Keep the docs in sync on shipping PRs.** As part of the same branch (or a
  follow-up docs-refresh PR after a multi-phase feature):
  - `CHANGELOG.md` — add one line per merged PR with user-visible change.
    Reverse chronological, grouped by month. Internal refactors / CI tweaks /
    dep bumps can be omitted.
  - `CLAUDE.md` — update when the PR changes durable facts (new env secrets,
    new cron, new architectural invariant). NOT every PR.
  - `HANDOFF.md` — refresh at the end of a session or a multi-PR feature with
    snapshot date, what shipped, updated punch list. This file is point-in-time,
    not a log.
