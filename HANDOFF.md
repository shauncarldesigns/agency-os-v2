# Session Handoff — Agency OS v2

_Snapshot: 2026-06-15. Point-in-time notes; goes stale fast. Durable
architecture, deploy mechanics, and gotchas live in `CLAUDE.md` (auto-read
every session). Full PR-by-PR log lives in `CHANGELOG.md`._

## State

All PRs below are **merged to `main`**. The backend Worker auto-deployed via
CI on each merge. The dashboard was manually deployed after each UI-touching
phase. The Dashboard tab is now the default landing view.

## What shipped since the last handoff (PRs #49–#57)

### Calling Dashboard — major feature, 9 PRs

End-to-end calling workflow. Pre-composes 6 sessions per week (Tue/Wed/Thu
× morning/evening), runs an execution view that loads one lead at a time,
captures outcomes via 4 buttons + Skip, books demos through a live HoneyBook
embed. Mon/Fri get their own non-calling views.

- **#49 — Phase 0: vocabulary refactor.** Renames `Qualify → Book demo` across
  the UI. New lead-status semantic: `qualified` = "demo booked, prospect
  project exists, awaiting outcome." New `not_interested` status. Prospect
  cards get `✗ Demo passed` button (project → 'dead', lead → 'contacted').
- **#50 — Phase 2: schema + types.** 5 new tables (sessions, session_leads,
  callbacks, demos, demo_events) + weekly_rotation single-row table.
  5 ALTER on leads for pointer columns.
- **#51 — Phase 3: backend session + outcome logic.** Composition recipe with
  widening cascade (score → geo → 14-day). Outcome endpoint handling all 5
  outcomes with side-effects. On-demand pitch card via Haiku.
- **#52 — Phase 4: shell + sessions grid.** Dashboard tab default. Priority
  strip with 4 groups (demos awaiting / no-show recovery / demos today /
  callbacks due). SessionCard.
- **#53 — Phase 5: execution view.** Full-screen overlay with pitch card +
  signals + outcome buttons + keyboard shortcuts (1/2/3/4/S). Burn-through
  complete screen.
- **#54 — Phase 6: HoneyBook split-pane booking modal.** Live embed in right
  pane, per-field copy buttons in left.
- **#55 — Phase 7: Mon/Fri views + prospecting block.** MondayView with
  SessionEditModal. FridayView with stat cards, by-industry bars, callback
  recovery. Shared ProspectingTaskBlock (50/week target).
- **#56 — Phase 8: reschedule modal.** Replaces Phase 4's window.prompt.
- **#57 — Phase 9: polish + docs.** Notes autosave to localStorage (drafts
  survive mid-call modal close). CHANGELOG/CLAUDE/HANDOFF refresh.

**HoneyBook spike** (between Phase 0 and Phase 2, no PR): standalone HTML test
confirmed the embed renders inside our modal-overlay pattern. Disposable test
file `public/honeybook-spike.html` was deleted after the spike.

**Operator decisions baked in:**
- Lead status `qualified` = "demo booked." `not_interested` is new (was
  reusing `dead` for cold-call rejections).
- One existing `client`-with-project lead (Magee Plumbing) was backfilled to
  `qualified` in the Phase 0 migration.
- Demo "awaiting status" timing = past-today (next-day surfacing), not
  past-now.
- Pitch cards NOT auto-backfilled — operator clicks ↻ to generate on the
  165 pre-existing leads.
- Geographic filter is multi-select cities only (no county data).
- Timezone hardcoded America/Chicago in the Worker.
- Industry rotation: Plumbing → HVAC → Electrical → Roofing → General
  Contracting, persisted across weeks in `weekly_rotation` table.
- Widening cascade for Extend +20: drop score floor (in 10-pt steps to 30)
  → drop geo filter → drop 14-day exclusion last.
- "Demo passed" on prospect card: project → `dead`, lead → `contacted`.
- Skipped outcome is silent (no call_log, no `last_called_at` update).

## Open items / next session candidates

Roughly priority order. None blocking.

1. **Cliff Young & Son lead is stuck.** Lead 188 has `status='qualified'`
   with `project_id=NULL` — inconsistent under the new vocabulary
   (qualified should imply project exists). Pre-existing oddity, not caused
   by this work. One-line cleanup:
   ```sql
   UPDATE leads SET status='contacted', updated_at=datetime('now')
   WHERE id=188;
   ```
2. **Subdomain validation hint** in DNS Setup modal. Soft warning when the
   input has more than one dot, so future-you doesn't repeat the
   `magee-plumbing.agncy.dev` test failure. Tiny PR (from the DNS feature
   open items).
3. **DNS subdomain mode** (~Phase 7 of DNS feature). If `*.agncy.dev`
   subdomain demos become a real workflow, the setup flow should detect
   subdomains and add records to the existing parent zone instead of
   trying to create a new one (Cloudflare 1116). Still gated on whether
   this matches a real workflow.
4. **`reviewExtraction.ts` still requests `differentiators`.** PR #19
   removed the field from `MinedReviewData` but the Claude prompt still
   asks for it. Wasted tokens per enrichment. One-line cleanup.
5. **Compound filtering on Sites tab.** Current filter is single-select.
   Not urgent.
6. **Bulk-enrich latency.** ~50 leads/invocation ≈ 30 min wall-clock for a
   full sweep. Real fix is a background job. Out of scope until friction.
7. **Pitch card backfill script.** Operator-on-demand works, but a one-time
   bulk backfill for the 165 existing leads (~$2-3 in Haiku) would mean
   no first-call lag. Worth considering once calling starts in earnest.
8. **Jump-to-next-block in BurnThroughComplete.** Currently just closes the
   modal with a "ships in Phase 9 polish" toast. Real implementation would
   wrap the current session, find the next planned one, and start it.
9. **Reports module's `cf_zone_id` analytics path is effectively dead.**
   No landingsite client is proxied through CF (proxy OFF mandatory), so
   `getZoneAnalytics` returns zeros silently. Worth removing from monthly
   snapshots, or replacing with CF Web Analytics if landingsite allows
   custom script injection.

## Recently verified working

- Phase 0 end-to-end: book demo on a cold lead → prospect project created →
  prospect card has new ✗ Demo passed button → clicking it returns lead to
  contacted, project marked dead.
- Phase 1 HoneyBook spike: embed renders inside our modal pattern.
- Phase 4 dashboard becomes default landing tab.
- Phase 7 MondayView edit modal lets operator tweak session composition
  before week starts.

## Deploy state to confirm

- **Backend Worker:** auto-deployed via CI on each merge. Last HEAD on `main`
  is the squash-merge of PR #57 (or whatever #57 became — the Phase 9 polish
  PR).
- **Dashboard:** manually deployed after each UI-touching phase. Last bundle
  verified in production: see most recent `npm run deploy` output.
- **Migrations applied to remote D1:**
  - `2026-06-14-vocabulary-refactor.sql` — 1 row updated (Magee Plumbing
    client → qualified).
  - `2026-06-14-calling-dashboard.sql` — 28 queries (6 tables + 5 ALTER +
    indexes + weekly_rotation seed).

## Operator pre-flight before first real calling

1. **Generate the week.** Dashboard → "+ Generate week" button → confirms 6
   sessions for the upcoming Tue/Wed/Thu.
2. **Override composition if needed.** Click the Edit button on any planned
   card to tweak industry, score floor, target count, or city filter.
3. **Optionally generate pitch cards in bulk** — currently lazy/on-demand
   only. If you'd rather have them ready before calling, run the ↻ on each
   lead in the session before starting (or wait for a backfill script).
4. **HoneyBook placement ID** is hardcoded in `BookDemoModal.tsx`. If the
   placement changes, update there + the spike HTML if you ever rerun it.

## Out of scope (per spec)

- HoneyBook API integration (replace embed with direct API call). Out of
  scope until volume justifies; would eliminate 60-90s/booking.
- Time-precision callbacks. Day-precision only.
- Auto-retirement of dead leads after N unanswered attempts.
- Configurable session times (currently just "morning" / "evening" labels).
- Per-industry booking-rate-driven rotation reordering.
- Pre-call prep digest email Monday morning.
- Demo show-rate forecasting based on time-to-demo gap.
