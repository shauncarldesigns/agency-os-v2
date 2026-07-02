# Session Handoff — Agency OS v2

_Snapshot: 2026-07-01. Point-in-time notes; goes stale fast. Durable
architecture, deploy mechanics, and gotchas live in `CLAUDE.md` (auto-read
every session). Full PR-by-PR log lives in `CHANGELOG.md`. Practice-call
reference docs live in `docs/`._

## State

All PRs below are **merged to `main`**. The backend Worker auto-deployed via
CI on each merge. The dashboard was manually deployed after each UI-touching
PR. All D1 migrations applied to remote.

## What shipped this session (PRs #74–#108)

Multi-day session covering: full call-recording feature (mic → R2 → linked to
call_log), Hot Leads priority queue, WeekPlanner dashboard restructure,
substantial playbook content churn, a bunch of cockpit UX polish, Brief Studio
inline-editable Client card, and two new practice reference docs under `docs/`.

### Big features

- **[#77](https://github.com/shauncarldesigns/agency-os-v2/pull/77) Hot Leads.** Operator-curated priority queue separate from auto-composed sessions. Pipeline row checkboxes get a "🔥 Add to hot leads" bulk button; a red-accented "Hot Leads" card sits above the WeekPlanner on the dashboard. Backend loosens active-session lock so a hot session can coexist with one auto session. New sentinel `session_date='hot'` / `kind='hot'` + `sessions.kind` migration.
- **[#76](https://github.com/shauncarldesigns/agency-os-v2/pull/76) Week Planner.** Replaces the day-of-week-routed sessions grid with a full Mon-Fri view. "Working Now" banner surfaces any active session regardless of date (fixed the stuck-Tuesday-session-on-Wednesday bug). Session cards show per-outcome progress via new `GET /api/sessions/week` aggregates. Drops the calling/prep/review/quiet mode routing.
- **[#85–#87 · #105 Call recordings.** MediaRecorder → R2 bucket `agency-os-recordings` → public URL persists on `call_log.recording_url`. Cockpit gets a Record button in the utility row (idle / recording / uploading / done states) that replaces the static timer + rebases objection-hit timestamps to record-start. Upload endpoint creates a placeholder call_log row immediately so recordings never orphan; outcome submit merges into it. `/api/leads/:id/recordings` + `/attach` for post-hoc recovery of any R2 objects that fell through. Voicemails-to-redial section on the Priority Strip filters aged VMs.

### Playbook content (~20 PRs)

The cold-call script and objection library evolved heavily across the session as the operator dialed prospects and iterated on wording. Notable milestones:

- Cold-call script restructure ([#95](https://github.com/shauncarldesigns/agency-os-v2/pull/95)) — dropped `label / mirror / label 2`, split `close` into three angles (Pound Sand / Walk Away With Ideas / Add To What You Built), reordered breadcrumb to put terrible-time + not-interested right after Intro.
- New stages: `cost` ([#89](https://github.com/shauncarldesigns/agency-os-v2/pull/89)), `pushback` ([#93](https://github.com/shauncarldesigns/agency-os-v2/pull/93)), `busy-redirect` ([#94](https://github.com/shauncarldesigns/agency-os-v2/pull/94)), `narrow-time` ([#97](https://github.com/shauncarldesigns/agency-os-v2/pull/97)). All branches so Advance skips them; operator taps mid-call.
- Branch stages now render in breadcrumb ([#90](https://github.com/shauncarldesigns/agency-os-v2/pull/90)) — fixed silent hiding of `if-hesitate`, `terrible-time`, `not-interested`, and new branches. Dashed border + italic distinguishes from linear chips.
- New objections: `angry-disarm` (branching, 3 paths, [#98](https://github.com/shauncarldesigns/agency-os-v2/pull/98)), `total-brush-off` (simple last-resort, [#101](https://github.com/shauncarldesigns/agency-os-v2/pull/101)), `too-busy-simple` (replaced `not-tech-savvy` in Standard, [#104](https://github.com/shauncarldesigns/agency-os-v2/pull/104)).
- Too-busy branching objection gained `seasonal-slowdown` path ([#91](https://github.com/shauncarldesigns/agency-os-v2/pull/91)) — now 5 paths total.
- `why-need-website-direct` gained variants ([#79](https://github.com/shauncarldesigns/agency-os-v2/pull/79), [#99](https://github.com/shauncarldesigns/agency-os-v2/pull/99), [#102](https://github.com/shauncarldesigns/agency-os-v2/pull/102)) — now 4 angles: Default, 10pm Googler, Quick Fire (7 scannable bullets), Busy + referrals.
- Playbook parse errors now surface useful messages ([#88](https://github.com/shauncarldesigns/agency-os-v2/pull/88)) instead of generic 500s. Wiring gotcha: every new markdown file needs an explicit `import` + `OBJECTION_FILES` (or scripts / follow-ups) entry in `services/playbook.ts` — fixed twice this session ([#80](https://github.com/shauncarldesigns/agency-os-v2/pull/80), [#98](https://github.com/shauncarldesigns/agency-os-v2/pull/98), [#101](https://github.com/shauncarldesigns/agency-os-v2/pull/101)).

### Cockpit UX polish (many PRs)

- Inline-editable Owner + Email on lead header ([#81–#84](https://github.com/shauncarldesigns/agency-os-v2/pull/81)) with prefill from `owner_names` mined during enrichment.
- Interpolation tokens `[review_count]` / `[review_avg]` / `[reviews]` ([#79](https://github.com/shauncarldesigns/agency-os-v2/pull/79)) added alongside the existing `[Company Name]` / `[Name]` / `[city]` / `[state]` / `[their trade]`. Cockpit populates `scores.reviews` from `lead.google_review_count` + `lead.google_rating`.
- SimpleObjection variants mechanism ([#79](https://github.com/shauncarldesigns/agency-os-v2/pull/79)) — chip row above rebuttal card when the objection has `variants[]`; tap swaps the body. `variant_label` stamped on the objection_hit for per-variant analytics later.

### Brief Studio + Sites

- Brief Studio Client card: Owner / Phone / Email are now inline-editable ([#92](https://github.com/shauncarldesigns/agency-os-v2/pull/92)) with prefill from the linked lead.

### Docs (reference material, not app-parsed)

- `docs/practice-cold-calls.md` ([#106](https://github.com/shauncarldesigns/agency-os-v2/pull/106)) — mirror of live cold-call script + objection library + demo scripts + email follow-up + rules of engagement, for Claude chat practice sessions.
- `docs/practice-demo-calls.md` ([#107](https://github.com/shauncarldesigns/agency-os-v2/pull/107), updated [#108](https://github.com/shauncarldesigns/agency-os-v2/pull/108)) — full-flow demo call script (more polished than the app's runtime demo scripts). Includes domain check, Google landscape education, 5-point walkthrough with FAQ→AI hook, expanded Growth pitch.

## Deploy state

- **Backend Worker:** auto-deployed via CI through PR #108.
- **Dashboard:** manually deployed after all UI-touching PRs. Last deploy after #105.
- **D1 migrations applied:** all from this session
  - `2026-06-17-session-kinds.sql` (Hot Leads `kind` column)
  - `2026-06-17-call-log-recording-url.sql` (R2 recording URL column)
- **R2:** `agency-os-recordings` bucket exists, public access enabled, base URL `https://pub-80e0811bf1bd472a8ff972eb94b314e0.r2.dev`

## Notes for next session

### Lead status ↔ outcome semantics (worth knowing)

There was operator confusion mid-session about `lead.status = 'not_interested'` vs `call_log.outcome = 'Not Interested'`. Both exist for good reason — status controls future behavior (excludes from composition, hides from MRR, grays out row), outcome records the historical fact of a specific dial. Voicemail/callback outcomes correctly promote `cold → contacted` in both code paths (`routes/sessions.ts:627-641` + `routes/calls.ts:65-70`). A stuck-at-cold Vanderloop lead ([#105](https://github.com/shauncarldesigns/agency-os-v2/pull/105)) was traced to a chronology + manual-reset artifact, not a code bug. A one-shot cleanup applied on remote D1 normalized any other stuck rows.

### Runtime demo scripts drift from `docs/practice-demo-calls.md`

The operator's target demo flow (in the docs) is significantly more polished than the app's runtime demo scripts (`demo-tier3-primary.md`, `demo-tier2-primary.md`). Runtime scripts still lack: domain check, Google landscape education, FAQ→AI walkthrough, 62-directories Growth pitch, "which feels closest?" close. Whether to port those into the runtime cockpit demo is a **pending operator decision**.

### Open items / punch list

Priority order. None blocking.

1. **Runtime demo scripts update.** Decide whether to bring `demo-tier3-primary.md` + `demo-tier2-primary.md` into alignment with `docs/practice-demo-calls.md`.
2. **HVAC pool empty** (carried from earlier). Sessions composing for `hvac_contractor` widen → nothing found.
3. **`reviewExtraction.ts` still requests `differentiators` field** (carried over). Wasted Claude tokens; one-line cleanup.
4. **Pitch card backfill** (carried over) — 165 leads still have null `pitch_card_text`. The cockpit no longer surfaces it but the field remains.
5. **Voicemail script (`voicemail.md`)** still missing content — playbook has scripts for cold-call + two demo variants, no voicemail leaving script.
6. **Generated variant promotion workflow.** `playbook_generations` accumulates Claude alternatives and the operator's "Use this" stamps `used_variant_index`. Manual promotion to markdown source is the intended follow-up when analytics get interesting.
7. **Angry Disarm chip label** currently reads "🛡 Angry Disarm" — first objection with an emoji in the label. Other emojis (✉, 📞) elsewhere are in operator-facing UI, not labels. Consistency call worth revisiting.
8. **Auto-project-on-booked** creates a new project every time Booked fires, even if the lead already has one. Session earlier flagged this; not blocking but could double-create.

## Recent quirks worth remembering

- **GitHub PAT expired mid-session twice.** The `gh` CLI relies on either keyring auth or `GH_TOKEN` env var from `~/.zshrc`. Refresh at https://github.com/settings/tokens; scopes needed are `repo` + `workflow`. Keyring OAuth (`gho_*`) is the safer default — see `gh auth status`.
- **Poppler was missing when a PDF came through** (docs/practice-demo-calls.md update). Installed via `brew install poppler`. Read tool wanted `pdftoppm`; fallback path is `pdftotext` for plain content extraction.
- **`brew install poppler` completed but Read tool cache said not installed** for the same session — worked around by extracting text directly.

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
