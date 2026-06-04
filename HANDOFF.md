# Session Handoff — Agency OS v2

_Snapshot: 2026-06-04. Point-in-time notes; goes stale fast. Durable architecture,
deploy mechanics, and gotchas live in `CLAUDE.md` (auto-read every session)._

## State

All PRs below are **merged to `main`**. The backend Worker auto-deployed via CI on
each merge. The dashboard requires a manual `npm run deploy` from `main` — see the
deploy section at the bottom for what's pending operator-side.

## What shipped since the last handoff (PRs #17–#35)

Grouped roughly by theme rather than strict chronological order.

### Project lifecycle + workflow

- **#17 — Qualify-flow refactor.** Killed the auto-spawn-project-on-enrich path
  and the "Generate Homepage Demo" feature. Pipeline qualification is now a
  modal with explicit tier picker + optional note → atomic create-project +
  mark-lead-client + redirect. Lead modal stage dropdown locks at `client`.
- **#22 — Consolidate project editor.** Collapsed three editing surfaces (TBD
  chips in brief panel, inline `+ Add` pills on matrix, standalone EditProjectModal)
  into one unified `OperatorInputForm`. TBD tokens render as non-clickable yellow
  pills; matrix axes are read-only and edited through the modal.
- **#31 — Quick Brief modal.** Cleaner restoration of the old "demo homepage"
  feature. Pure client-side formatter — business name + reviews verbatim —
  copied to clipboard for landingsite. Zero Claude synthesis. Accessible from
  Brief Studio sidebar + Site card button on every tier.
- **#34 — Prospect status.** New projects from qualify default to `'prospect'`,
  excluded from MRR. Sites grid shows Prospects stat tile + yellow badge on
  prospect cards. One-click "✓ Mark as active client" on prospect cards flips
  to `'building'` and stamps `contract_start`. Edit Project modal gains a full
  status picker (prospect / building / live / paused / dead).
- **#35 — Clickable stat tiles.** Each tile on the Sites tab is a one-click
  filter for the grid below. Active tile gets an accent outline. Click again to
  clear. Tier filters are intersected with `active` status (so "Tier 3 active"
  shows only signed Tier 3 clients, not Tier 3 prospects).

### Brief generation (page brief evolution)

- **#19 — Target Audience + dead-path cleanup.** Master brief gains a
  Target Audience section with five fields (primary customer, what brings them,
  what they worry about, why they choose this business, primary conversion goal).
  Per-page brief rewritten to stop dictating layout — became a "job description"
  format. Dead `differentiators` field removed from `MinedReviewData`.
- **#24 — Brief uses project axes as authoritative.** Master brief prompt
  was reading mined `service_areas` only — operator-curated `project.service_areas`
  (set via the editor modal) was never seen by Claude. Result: matrix grew when
  the operator added Green Bay, but the brief stayed scoped to whatever the
  reviews mined. Now the prompt is fed `project.services` + `project.service_areas`
  as the source of truth, with strict QUALITY BAR rules to enumerate them
  verbatim.
- **#26 — Page brief v3 (letter form).** Failure of v2 was platform-default
  fluff (premier/trusted/passionate) because landingsite was synthesizing copy
  with no specific words to lift. New format: structured SEO block at top + prose
  creative-director memo below. Headline + subhead suggestions quoted inline as
  strong suggestions. Customer quotes verbatim. Built-in anti-fluff word ban list
  enforced in every brief.
- **#27 — Services rename + Service Areas hub.** Foundation page label
  *"Services Overview"* → *"Services"*. URL slug explicitly maps to `/services`.
  New foundation page *"Service Areas"* (slug `/service-areas`) added,
  conditionally rendered when project has 2+ service areas. Hub-page focused
  per-page guidance: SEO-first, short letter, link-dense, lists every city.
- **#28 — Mine local landmarks.** Reviewer-mentioned neighborhoods, landmarks,
  named districts (e.g. *"East Side of Green Bay"*) now mined separately from
  cities into `extracted_local_landmarks` (new column). Master brief appends them
  as parentheticals on each city's bullet. Service-area page briefs use them for
  genuine local color. Migration in `db/migrations/2026-06-01-local-landmarks.sql`.

### Enrichment robustness

- **#21 — Bulk re-enrich.** Row checkboxes on the Pipeline table + tri-state
  header checkbox + "↻ Re-enrich Selected (N)" button on the existing
  EnrichmentStrip. Same backend endpoint, optional `ids` parameter.
- **#29 — Fix bulk enrich subrequest cap + false-positive enriched state.**
  Outscraper poll cadence 2s → 8s (cuts subrequests from 60 to 15 max per task).
  `enrichLead` now throws if Places returns nothing AND the lead has no prior
  data — was silently marking failures as `'enriched'`. `enrich-all` loop
  detects `"Too many subrequests"` and aborts cleanly with structured response
  fields. Dashboard `BULK_LIMIT` 50 → 25.
- **#33 — Bail fast on subrequest cap inside the pipeline.** Three more code
  paths that were swallowing cap exhaustion: Outscraper poll retry loop,
  Promise.allSettled on Outscraper + PageSpeed, and Claude review-mining catch
  block. All now propagate `Too many subrequests` errors so enrich-all stops
  cleanly instead of marching through doomed retries.

### UI polish

- **#18 — Matrix sync.** Inline `+ Add service` / `+ Add city` pills on the
  matrix (removed in PR #22's consolidation). Brief-additions callout when the
  brief mentions things not on the matrix. "Matrix may be stale" pill on the
  Master Brief card.
- **#20 — Regenerate button.** Brief editor panel gains a `↻ Regenerate` button
  for master briefs. Confirm dialog warns that manual edits will be lost. Locks
  panel during the ~30–60s call.
- **#25 — Stats counts fix.** "Pages live" was hardcoded `0`; "Briefed · awaiting
  complete" was over-counting briefs that had been marked complete on the page
  side. Both now driven from page rows (which carry authoritative status), not
  briefs. Adds the planned-pages denominator (`X / Y`).
- **#30 — Reviews column + sort.** Pipeline gets a Reviews column between
  Score and City showing `{count} · {rating}★`. Sort dropdown: Recently updated
  (default), Most reviews, Highest score, Highest rating.
- **#32 — Pipeline enrichment filter.** New dropdown between Tier and Website:
  All / Enriched / Pending / Enriching / Failed.

### Backend cleanup

- **#23 — Drop photography_direction.** Backend dropped the field from
  `MasterBriefProject` and `collectMinedData`. Form field stays as a harmless
  orphan in the DB.
- **Service-area grid hide-below-2.** Single-city projects don't render the
  service × city grid (was just a vertical duplicate of the service pages row).

## Open items / next session candidates

Roughly priority order. None are blocking.

1. **Compound filtering on Sites tab.** Current filter is single-select (click a
   tile to filter). "Tier 3 prospects" or "Paused clients" require a real filter
   row — would need a re-think of the stats-tiles-as-filters UX. Not urgent;
   single-select handles the common cases.
2. **Bulk-enrich latency.** Worker subrequest cap awareness is solid now, but
   ~50 leads/invocation is still ~30 min wall-clock for a full sweep. Real fix
   is moving to a background job — `wrangler.toml` already has cron triggers
   to build on. Out of scope until the operator hits the friction.
3. **`reviewExtraction.ts` still requests `differentiators`.** PR #19 removed
   the field from `MinedReviewData` but the Claude prompt still asks for it in
   the JSON output. Wasted ~50 tokens per enrichment. One-line cleanup.
4. **Stale `.zshrc` PATH entries.** `/tmp/node-v22.15.0-...` is exported twice
   in `~/.zshrc` (lines 105–106). Harmless (skipped, the path doesn't exist),
   but worth cleaning up next time.
5. **OperatorInputForm photography field.** Dropped from the brief in #23 but
   the form input is still there. Dead UX; could remove the field too.

## Recently verified working

- Pipeline bulk re-enrich on 25 leads → completes cleanly without hitting
  subrequest cap on the post-#33 deployed Worker.
- Quick Brief modal → clipboard copy → landingsite ingestion produces a usable
  demo (the test site at https://kyles-plumbing-test.agcy.dev/ was generated
  this way).
- Sites grid + clickable filter tiles (post-#35 build) — operator confirmed in
  PR test plan.
- Page brief v3 letter form on Kyle's Plumbing — Target Audience block visible
  in the master, no `## Hero` / `## Trust strip` section dictation in page briefs.

## Deploy state to confirm

- **Backend Worker:** all PRs above auto-deployed via CI on merge. Last expected
  HEAD on `main` is the squash-merge of PR #35
  (`Sites: make stat tiles clickable to filter the grid`).
- **Dashboard:** the operator needs to run `cd agency-os-dashboard && npm run deploy`
  on `main` to ship the latest UI changes from PR #34 + #35 (and anything else
  since the last deploy). Quick check:
  ```bash
  curl -s -H "Cache-Control: no-cache" "https://agency-os-v2-dashboard.pages.dev/?cb=$(date +%s)" \
    | grep -oE 'assets/index-[A-Za-z0-9]+\.js' | head -1
  ```
  Compare to the bundle hash printed by `npm run build` locally to see if a
  deploy is still pending.
- **Migrations to apply:** if `db/migrations/2026-06-01-local-landmarks.sql`
  hasn't been applied to remote D1 yet, run:
  ```bash
  cd agency-os-backend
  npx wrangler d1 execute agency-os-v2 --remote --file=src/db/migrations/2026-06-01-local-landmarks.sql
  ```
