# Session Handoff — Agency OS v2

_Snapshot: 2026-07-21. Point-in-time notes; goes stale fast. Durable
architecture, deploy mechanics, and gotchas live in `CLAUDE.md` (auto-read
every session). Full PR-by-PR log lives in `CHANGELOG.md`. Practice-call
reference docs live in `docs/`._

## State

All PRs below are **merged to `main`**. Backend Worker auto-deployed via CI
on each merge. Dashboard manually deployed after each PR. All D1 migrations
applied to remote.

## What shipped recently (PRs #129–#149)

Two headline features, built from an external design-spec package
(`agency-os-v2-pipeline/` — README + build brief + two canonical `.jsx`
visual specs):

### Dashboard KPI view (#147, #149)

- **[#147](https://github.com/shauncarldesigns/agency-os-v2/pull/147)** The Dashboard tab is no longer an empty placeholder. It now shows a KPI-first view for the Automated Pipeline: hot leads ready to call, this week's reply-rate slot, meetings booked this week, active pipeline size, funnel strip, channel split, and a Needs action list. Backend endpoint: `GET /api/dashboard/pipeline-kpis`.
- **[#149](https://github.com/shauncarldesigns/agency-os-v2/pull/149)** Added a concrete Automated Pipeline activity row under the headline KPIs: sites created from `url_saved`, intro texts from `intro_sent`, follow-ups from `followed_up`, and engaged leads / total visits from `click_tracked`, all week-scoped with previous-week deltas.
- Current truth boundary: SMS send/tap/engagement/book metrics are real (`lead_activity`, `pipeline_sessions`, `demos`). Reply rate and Facebook split intentionally render as "not tracked" until the app records reply/channel events explicitly.

### Automated Pipeline → Sites bridge (#148)

- **[#148](https://github.com/shauncarldesigns/agency-os-v2/pull/148)** Automated Pipeline now has a real demo-booking bridge into Sites. The engaged Call Prep modal replaces `Log call` with `Book demo`; the automated lead-detail header also has a fallback `Book demo` action. Both reuse `POST /api/leads/:id/qualify`, create a Sites prospect project, and route the operator to Sites.
- `POST /api/leads/:id/qualify` and session booked outcomes now set `leads.pipeline_status='booked'`. `/api/pipeline/leads` excludes `booked` / `archived`, so leads leave the active Automated Pipeline Kanban once they become a prospect or client.

### Automated Pipeline (#129, #130, #131, #132, #133)

New text + site outreach motion, parallel to the cold-call motion. Flow:
enriched lead with no website → Claude generates landingsite brief →
operator builds site in landingsite.ai → pastes live URL (auto-UTM-tagged) →
sends tracked intro text via `sms:` deep link → engagement-aware follow-up →
close on a call.

- **[#129](https://github.com/shauncarldesigns/agency-os-v2/pull/129)** Page shipped against sample data (SMS deep-link viability testable on-device before backend investment). Introduced Tailwind (then preflight-off + `.pipeline-scope` isolation).
- **[#130](https://github.com/shauncarldesigns/agency-os-v2/pull/130)** D1 migration (`pipeline_status` + 7 more lead columns, `lead_activity` audit table), `/api/pipeline/*` endpoints with server-enforced status transitions, public `/r/:lead_id` click-tracker (bumps `pipeline_sessions`, auto-promotes `sent_no_reply → engaged`, 302s to tagged URL), frontend wired to real data with optimistic actions + 6s Undo pill.
- **[#131](https://github.com/shauncarldesigns/agency-os-v2/pull/131)** On-demand brief generation — `POST /leads/:id/brief`, Haiku 4.5, new `prompts/pipelineBrief.ts` (fixed section headers, anti-fluff word list, verbatim-quotes-only). BriefModal auto-generates on open, caches on `leads.pipeline_brief`, Regenerate button.
- **[#132](https://github.com/shauncarldesigns/agency-os-v2/pull/132)** 3-col desktop card grid + borderless secondary buttons.
- **[#133](https://github.com/shauncarldesigns/agency-os-v2/pull/133)** Scoped preflight-lite killed the native `<button>` border (preflight was globally off at the time; superseded by #134 turning preflight on).

### Sidebar shell + site-wide light theme (#134)

**Dark mode is gone.** New `AppShell` (fixed white sidebar, Main/Work nav
groups, live badges, mobile drawer, per-page top bar with clients/MRR
stats). Old dark Header/Nav deleted. Nav: Dashboard · Call Sessions ·
Cold Call Pipeline · Automated Pipeline · Lead Finder · Clients & Sites ·
Playbook · Reports.

Light theme was done via a **token flip in `global.css`** (slate palette,
white surfaces, blue→indigo accent, system fonts; Bebas Neue/DM Sans/DM Mono
dropped, Google Fonts link removed) — every legacy panel rethemed at once
with zero functional change. Tailwind preflight is now ON globally.

Two new pages: **Call Sessions** (week-paginated past/present/upcoming
browser over `/api/sessions/week`; Dashboard stays today-focused) and
**Playbook** (read-only Scripts/Objections/Follow-ups browser + objection
analytics; editing stays in the backend markdown files).

**ExecutionView now renders inside the shell** — sidebar stays visible
during calls (operator decision; was full-viewport takeover).

## Deploy state

- **Backend Worker:** auto-deployed via CI through #134.
- **Dashboard:** manually deployed after #134 (bundle verified at apex).
- **D1 migrations applied to remote:** `2026-07-19-lead-pipeline.sql`.
- **Local dev D1 note:** the local miniflare DB was missing every migration
  from `2026-06-14-calling-dashboard.sql` onward; all were applied locally
  this session. If a fresh clone's local dashboard 500s on `/api/dashboard`,
  apply migrations locally in filename order.

## Notes for next session

### Light-theme migration is mid-flight by design

`global.css` (~1,080 lines of legacy semantic classes) now resolves to light
tokens and everything works, but the intended end state is per-panel Tailwind
utility migration, then delete `global.css`. Suggested order (least → most
risky): Sites → Reports → Prospect/Lead Finder → Cold Call Pipeline →
Dashboard → ExecutionView. No functional change expected per panel; visual
QA each one.

### Automated Pipeline — deferred pieces

1. **Clarity Layer-2 sync** — cron hitting Clarity Data Export API to enrich
   `pipeline_sessions` beyond first-click. Layer 1 (click tracker) is live
   and is the trustworthy signal; Clarity is color. Also: the per-site
   Clarity snippet + `clarity('set','lead',clarity_tag)` step is documented
   in the build brief but not yet surfaced as a checklist item in the UI.
2. **Booked / archived controls** — enum + transitions exist server-side;
   no UI yet. Booked should hand off to the existing HoneyBook demo flow.
3. **Queue filter is strict** — `has_website=0 AND enrichment_status='enriched'
   AND status IN ('cold','contacted')`. Businesses with weak-but-existing
   sites are excluded; relaxing this is a one-line change in
   `routes/pipeline.ts` when the operator wants it.
4. **On-device SMS test still pending operator confirmation** — composers
   verified in-browser; the `sms:?&body=` prefill needs a real iPhone tap
   (checklist in PR #129 body).

### Shell follow-ups

- **Settings page** — sidebar row is a placeholder, no page behind it.
- **Session/lead counts in Call Sessions page** are week-scoped; an all-time
  history view would need a new endpoint (current one is week-keyed).
- **`html{font-size:18px}` kept** for legacy-panel rem sizing. When the last
  panel migrates to Tailwind, revisit (Tailwind assumes 16px).

### Open items carried from prior sessions

1. Runtime demo scripts vs `docs/practice-demo-calls.md` drift — pending
   operator decision.
2. HVAC pool empty (sessions composing for `hvac_contractor` find nothing).
3. `reviewExtraction.ts` still requests unused `differentiators` field.
4. Pitch card backfill — many leads still have null `pitch_card_text`.
5. `voicemail.md` playbook script still missing content.
6. Generated-variant promotion workflow (playbook_generations → markdown).
7. Auto-project-on-booked can double-create projects.

## Recent quirks worth remembering

- **`git push` from this environment reports a phantom "failed to push"
  error while actually succeeding** — happened on 4 of 5 PR branches this
  session. Always verify with `git fetch && git log origin/<branch>` before
  re-pushing; the push almost certainly landed.
- **Pages apex serves a stale bundle for ~30–60s after deploy** (known,
  documented in CLAUDE.md) — poll with cache-bust before declaring a deploy
  broken.
- **GitHub PAT / `gh` auth** — `source ~/.zshrc` before `gh` calls; scopes
  `repo` + `workflow`.

## Out of scope (unchanged from prior handoff)

- HoneyBook API integration (replacing the embed)
- Time-precision callbacks
- Auto-retirement of dead leads
- Configurable session times
- Per-industry rotation reordering by booking-rate
- Pre-call digest email
- Demo show-rate forecasting
- Vs-industry deltas on agency summary
- Quota tracking
- Nested-conditional playbook state machine (would need new parser + UI)
- Self-hosted site builder (landingsite.ai stays the build tool)
- A2P/Twilio programmatic texting (`sms:` deep links only)
- Automated Facebook messaging
