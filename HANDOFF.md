# Session Handoff — Agency OS v2

_Snapshot: 2026-06-17. Point-in-time notes; goes stale fast. Durable
architecture, deploy mechanics, and gotchas live in `CLAUDE.md` (auto-read
every session). Full PR-by-PR log lives in `CHANGELOG.md`._

## State

All PRs below are **merged to `main`**. The backend Worker auto-deployed via
CI on each merge. The dashboard was manually deployed after each UI-touching
phase. Both D1 migrations applied to remote.

## What shipped this session (PRs #67–#73)

One readability tweak followed by the full **Playbook System** build from the
spec the operator shared (`HANDOFF-playbook-system.md`).

### #67 — Global type bump

`html { font-size: 18px }` (+12.5% across every rem-based size in
`global.css`) plus body `font-weight: 500`. Lowest-risk way to bump global
readability without touching components. Operator-driven.

### #68–#73 — Playbook system, 6 PRs

The calling cockpit was the static `ExecutionView` showing a pitch card + a
Log-a-Call form. It's now an active Chris Voss "No-oriented" sales playbook
with live objection handling.

| # | PR | Layer |
|---|---|---|
| 1 | [#68](https://github.com/shauncarldesigns/agency-os-v2/pull/68) | Content seed — 13 markdown files (scripts/objections/follow-ups) |
| 2 | [#69](https://github.com/shauncarldesigns/agency-os-v2/pull/69) | Runtime parser + read endpoints + `_debug` health |
| 3 | [#70](https://github.com/shauncarldesigns/agency-os-v2/pull/70) | `/generate-rebuttal` + `playbook_generations` log table |
| 4a | [#71](https://github.com/shauncarldesigns/agency-os-v2/pull/71) | API client + `call_log.objection_hits` column |
| 4b | [#72](https://github.com/shauncarldesigns/agency-os-v2/pull/72) | Calling cockpit UI (full ExecutionView rewrite) |
| 5 | [#73](https://github.com/shauncarldesigns/agency-os-v2/pull/73) | Dashboard analytics — agency summary + objections overview |

**What the operator sees:**

- Start a session as usual. The exec view now opens to the new cockpit
  layout: lead header with score chips at top, the cold-call script panel
  on the left (stage breadcrumb + active stage card + next preview +
  Back/Advance), the objection chip grid on the right (Standard /
  Deep-dive / Closing categories), notes textarea + outcome bar at the
  bottom.
- Tap any objection chip → script panel swaps for a rebuttal card; chip
  highlights; `[MM:SS · OBJECTION: ...]` auto-tags into notes. For
  branching objections (Too busy, Send email), the rebuttal card is the
  diagnostic prompt + 3 path cards; tap a path to see that rebuttal.
- ✨ Generate alternative calls Claude Haiku, returns 3 variant cards.
  Use this swaps the variant in as the displayed rebuttal and stamps
  it onto the objection hit log for that call.
- ✓ Handled / ✕ Didn't land marks the objection's outcome before the
  cockpit returns to script mode.
- Outcome buttons (Voicemail / Not interested / Callback / Booked)
  submit the call_log row with the full objection hit array attached.
- Dashboard tab: scroll past the day-specific view to see the new
  Analytics section. Agency summary (Calls/day, Dial→Set %, Demos held,
  New projects) + Objections overview cards with frequency bars and
  handled-rate %.

**What was removed in #72** (so the operator isn't surprised):

- Pitch card → replaced by the script panel. Operator now reads the
  actual Chris Voss line instead of a generated business summary. If you
  want to bring the pitch card back as a sidebar card, easy add.
- Log-a-Call rich dropdown form → replaced by the simpler notes
  textarea + objection chip auto-tags. The 8 outcome dropdown options
  from PR #63 no longer appear in the cockpit. Still available on the
  Pipeline LeadModal CallLogTab.
- Sidebar Scores / Signals / Prior Calls cards → scores are now chips
  in the lead header; signals + prior calls were dropped to make room
  for the script + objection panels. Operator can open the lead's
  modal from Pipeline for the full historical view.

## Open items / next session candidates

Priority order. None blocking.

1. **`voicemail.md` script** — the spec listed it but operator hasn't
   provided source content. No voicemail-leaving script in the cockpit
   today. Easy add when content lands.
2. **Script picker dropdown** — the cockpit shows the default cold-call
   script only. Demo scripts (`demo-tier3-primary`, `demo-tier2-primary`)
   are seeded but not selectable yet. They probably belong on a separate
   surface for held-demo prep, not the cold-call cockpit.
3. **Verify on first real session** — the cockpit hasn't been exercised
   end-to-end against a live calling block yet. First session will
   stress-test: stage navigation feel, objection chip timing, generate-
   rebuttal latency (typically 1-3s via Haiku), notes auto-tagging
   readability. Expect minor UX iteration after the first day of use.
4. **Closing-category objections are empty.** The cockpit reference HTML
   shows "Not interested" and "Terrible time" as closing-category chips,
   but those are currently fallback stages in the cold-call script
   itself — not separate objection files. If operator wants them as taps
   to log into objection_hits, add objection markdown files for them.
5. **Pitch card backfill** (carried over) — 165 leads still have null
   `pitch_card_text`. The cockpit no longer surfaces it but it's still
   on the lead record; if/when a future card uses it, this matters.
6. **`reviewExtraction.ts` still requests `differentiators`** (carried
   over). Wasted tokens; one-line cleanup.
7. **HVAC pool empty** (carried over). Sessions composing for
   `hvac_contractor` will widen → end up out-of-industry.
8. **Generated variant promotion workflow.** Right now generations are
   logged to `playbook_generations` and the operator's "Use this"
   choice is stamped onto the row. The original spec called for an
   eventual workflow to promote high-handled-rate variants back into the
   markdown source. Manual for now — DB has the data when it's time.

## Recently verified working

- All 13 markdown files parse via `/api/playbook/_debug` (tested
  pre-deploy via wrangler dry-run + post-deploy via the parser running
  inside the endpoint).
- `playbook_generations` and `call_log.objection_hits` columns exist
  on the remote D1 (`num_tables: 17` post-migration).
- Worker bundle 295→534 KiB after Phase 3 (markdown content + yaml
  package). Under the 1 MiB limit.
- Dashboard build clean each phase. CSS 35.5 → 48.4 KiB across the
  cockpit + analytics styles.
- All 6 PRs deployed (Worker auto, Dashboard manual `npm run deploy`).

## Deploy state

- **Backend Worker:** auto-deployed via CI through PR #73.
- **Dashboard:** manually deployed after #67, #72, #73 (each UI-touching
  phase). Last deploy was after #73. Verify the apex bundle hash matches
  a recent build if you suspect drift.
- **D1 migrations applied:** all from this session
  (`2026-06-17-playbook-generations.sql`,
  `2026-06-17-call-log-objection-hits.sql`).

## One nuance worth knowing for next session

The cockpit's playbook content is **bundled at build time**, not read from
D1. To change a script line or objection rebuttal:
1. Edit the `.md` file under `agency-os-backend/src/playbook/`.
2. Commit + push to `main` → Worker CI auto-deploys.

The Dashboard immediately reflects the change (it fetches via
`/api/playbook/*` which serves the bundled content). No D1 migration
needed, no dashboard redeploy needed.

The `playbook_generations` table accumulates every Claude generation call.
If the operator's "Use this" picks cluster on a particular variant for an
objection, that's a strong signal to either promote it into the markdown
or rewrite the stock rebuttal. The query for "which variants get picked
most" is straightforward via the partial index
`idx_playbook_gen_used`.

## Out of scope (still — unchanged from prior handoff)

- HoneyBook API integration (replacing the embed)
- Time-precision callbacks
- Auto-retirement of dead leads
- Configurable session times
- Per-industry rotation reordering by booking-rate
- Pre-call digest email
- Demo show-rate forecasting

## New out-of-scope (this session)

- Vs-industry deltas on agency summary (spec called for them; operator
  asked to skip — could revisit if comparison data ever becomes useful).
- Quota tracking (operator deferred deciding on a quota target).
- Voicemail script (no source content yet).
- Script picker (cold-call only for now).
- Auto-promotion of generated variants to markdown.
