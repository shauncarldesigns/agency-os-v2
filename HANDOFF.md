# Session Handoff — Agency OS v2

_Snapshot: 2026-06-16. Point-in-time notes; goes stale fast. Durable
architecture, deploy mechanics, and gotchas live in `CLAUDE.md` (auto-read
every session). Full PR-by-PR log lives in `CHANGELOG.md`._

## State

All PRs below are **merged to `main`**. The backend Worker auto-deployed via
CI on each merge. The dashboard was manually deployed after each UI-touching
phase.

## What shipped since the last handoff (PRs #58–#65)

These are all **post-launch iterations on the Calling Dashboard** based on
the operator's first real test sessions. Each one came from running a
session and hitting something that didn't work right.

### #58 — Industry rotation key vs label (the big "0 leads matched" bug)
The session composer's industry rotation array used display labels
(`'Plumbing'`, `'HVAC'`, `'Electrical'`, etc.) but the actual `leads.industry`
column stores Google Places `primaryType` strings (`'plumber'`,
`'electrician'`, `'roofing_contractor'`, `'general_contractor'`).

Every session was generating with `industry='Plumbing'`, the composer's
`WHERE industry = ?` returned 0 rows, the widening cascade tried to drop
score floor / geo / 14-day but the industry mismatch was the actual
bottleneck → operator hit Start, got "0/0 dialed", burn-through fired
instantly.

`INDUSTRY_ROTATION` is now `{key, label}` pairs. Sessions store the key
(`'plumber'`), UI uses `industryLabel()` to display (`'Plumbing'`).

**Side fix:** session cards now show the day-of-week prefix
(`Mon · Morning — Plumbing`) so multiple days don't look identical.

### #59 — Maps link + morning/evening sort
Two small operator asks: (1) want to look at the GBP listing mid-call for
research → added `🗺️ Maps ↗` link in the exec-view contact row, uses
`place_id` for exact resolution. (2) sessions were ordered alphabetically
which put evening before morning → SQL changed to
`ORDER BY CASE block WHEN 'morning' THEN 0 ELSE 1 END`.

Also promoted `googleMapsUrl` helper from `LeadModal` into shared
`lib/format.ts`.

### #60 — Previous/Next/Skip nav row
Original Skip wrote a permanent `skipped` outcome and never re-surfaced the
lead. Operator wanted "park this for later." Switched ExecutionView from
one-lead-at-a-time fetch to full session load + client-side `currentIndex`.
Added `← Previous · Skip for now · Next →` row. Skip-for-now wraps to first
uncalled at end so skipped leads naturally come back around.

### #61 — Exec view as a page (not a modal)
Operator hit Booked → BookDemoModal opened ON TOP of the ExecutionView
modal → confusing modal-on-modal stacking. Bigger problem: the exec view
felt cramped in a modal when it should be the operator's whole world during
calling.

ExecutionView now renders as a full page (replaces the dashboard view when
a session is active). Header + Nav hidden. Prior-calls toggle added above
the notes textarea. Next button dropped (overlapped with Skip too much).

### #62 — Brief Studio layout + booking inline
Big restyle to match the rest of the app. Two-column `bs-layout`:
- **Main column:** Pitch card / notes / outcomes / inline callback picker
- **Sticky right sidebar:** Scores card, Signals card, Prior Calls card (the read-only reference material)

Booking happens inline now — when operator clicks "Booked demo", the main
column swaps to a new BookingPane (full HoneyBook embed + lead-info copy
buttons + confirm fields). Sidebar reference stays visible during booking
so operator can glance at scores/signals/prior-calls while filling the
form. `BookDemoModal.tsx` deleted.

### #63 — Log a Call form + sidebar auto-refresh
The bare notes textarea wasn't enough — operator wanted richer outcome
options ("Spoke with Owner", "Spoke with Gatekeeper") and follow-up dates
on any call, not just terminal callbacks. Replaced the textarea with the
orange "Log a Call" card from the Pipeline LeadModal:
- Outcome dropdown (8 options)
- Follow-up date
- Notes textarea
- Save Call Entry button — logs without advancing
- Outcome buttons below still advance + drive session state

Sidebar Prior Calls card auto-refreshes when a call is saved via a
`refreshKey` bump.

### #64 — Booking creates project + Brief Studio Client card
Three changes in one PR:
1. **Bug:** Booked-demo from exec view set `lead.status='qualified'` but
   never created a project. Lead got stuck — no Sites entry, no way to
   run Quick Brief for demo prep. Pipeline qualify creates a project; exec
   view didn't. Backend now does, defaulting to the lead's
   `recommended_tier` (fallback T3), and returns it in the response.
2. **Feature:** Post-booking modal prompt — "✓ Demo booked / 🛠 Pause &
   build demo / Keep calling." Pause path closes the session, switches to
   Sites tab, deep-links into the new project's Brief Studio. Matches the
   operator's stated workflow: when a demo books, immediately pause cold
   calling and prep the demo site.
3. **Brief Studio sidebar:** redundant Status Legend replaced with a
   **Client** card (business / owner / phone / email / location / "Client
   since"). Falls back through project → lead values so it always shows
   what's available.

### #65 — Outcome column updates from exec view + stuck-lead cleanup
Pipeline list has an Outcome column showing each lead's most recent
meaningful interaction. `routes/calls.ts` already keeps it current
(LeadModal CallLogTab + new Log a Call form). The session outcome handler
was writing `call_log` entries but never touching `lead.outcome` — so the
Pipeline column showed "—" for leads called via the exec view.

Each outcome now maps to a friendly label:
| outcome | label | badge |
|---|---|---|
| voicemail | Voicemail Left | blue |
| not_interested | Not Interested | red |
| callback | Callback Requested | yellow |
| booked | Demo Booked | green (new outcomeBadge case) |
| skipped | — (silent) | — |

`outcomeBadge` in `lib/format.ts` got a `'booked'` → green case.

**Cleanup applied to remote D1:** 5 stuck test leads (Dave Steltz's,
Mueller, Jahnke, Ken's, Cliff Young) reset to `cold`. 4 `demos` + 4
`demo_events` rows deleted. 1 orphan project (id 38) deleted. Magee Plumbing
(id 15, project 37) preserved as the only real prospect.

## Open items / next session candidates

Priority order. None blocking.

1. **HVAC has 0 leads in the data.** The industry rotation includes
   `hvac_contractor` but the operator hasn't prospected any HVAC contractors
   yet. HVAC sessions will compose 0 strict, then widen → end up pulling
   from outside HVAC. Either prospect HVAC via the Prospect tab to fill the
   bucket, or skip HVAC days on the Monday-view session edit modal until
   the pool exists.
2. **Pitch card backfill script.** 165 existing leads have null
   `pitch_card_text`. Operator generates on-demand via the ↻ button. A
   one-time bulk backfill (~$2–3 in Haiku) would mean no first-call lag for
   any lead. Worth considering once calling kicks into gear.
3. **Jump-to-next-block in BurnThroughComplete.** Currently a no-op toast
   ("ships in Phase 9 polish"). Real implementation would wrap the current
   session, find the next planned one, and start it inline.
4. **DNS subdomain mode** (~Phase 7 of DNS feature). If `*.agncy.dev`
   subdomain demos become a real workflow, the setup flow should detect
   subdomains and add records to the existing parent zone instead of
   trying to create a new one (Cloudflare 1116).
5. **DNS setup modal subdomain warning.** Cheap follow-up from the DNS
   feature — soft warning when input has >1 dot.
6. **`reviewExtraction.ts` still requests `differentiators`.** PR #19
   removed the field but the Claude prompt still asks. Wasted tokens.
   One-line cleanup.
7. **Compound filtering on Sites tab.** Single-select tile click handles
   common cases; "Tier 3 prospects" needs a real filter row. Not urgent.
8. **Bulk-enrich latency.** ~30 min wall-clock for a full sweep. Real fix
   is a background job using the cron triggers already in `wrangler.toml`.
9. **Reports module's `cf_zone_id` analytics path is effectively dead.**
   No landingsite client is CF-proxied (proxy OFF mandatory), so
   `getZoneAnalytics` returns zeros silently. Worth removing from monthly
   snapshots or swapping in CF Web Analytics if landingsite supports
   custom script injection.

## Recently verified working

- Industry rotation matches real `leads.industry` values; sessions compose
  ~30+ leads each on Plumbing / Electrical / Roofing / General Contracting.
- Maps link in exec view opens the exact GBP listing.
- Previous/Skip nav lets operator park a lead and return later.
- Brief Studio-styled exec page with sidebar Scores/Signals/Prior Calls.
- Booking creates a real prospect project; "Pause & build demo" lands in
  the new project's Brief Studio with Quick Brief one click away.
- Pipeline Outcome column now reflects exec-view outcomes (Voicemail
  Left / Not Interested / Callback Requested / Demo Booked).
- Sites tab shows Magee Plumbing as the only prospect; other 5 stuck-test
  leads are back in the calling pool as `cold`.

## Deploy state

- **Backend Worker:** auto-deployed via CI through PR #65.
- **Dashboard:** manually deployed after each UI-touching PR. Last deploy
  was after #65; verify the apex bundle hash matches a recent build hash
  if you suspect drift.
- **D1 migrations applied:** all listed in CHANGELOG. No outstanding
  migrations.

## One nuance worth knowing for next session

The booking flow now has a **TWO-stage write**:
1. `POST /sessions/:id/outcome` with `outcome='booked'` → creates project,
   sets lead → qualified, stamps demo pointers, creates demos + demo_events
   rows, returns the new project.
2. UI shows the post-booking prompt. "Pause & build" deep-links into
   Brief Studio; "Keep calling" just dismisses.

If the post-booking UX ever needs to change, the backend response shape
already returns `{ ok, demo, callbackId, project }` — `project` is what
drives the deep-link.

The same friendly-outcome-label mapping (#65) is what shows up in:
- Pipeline list Outcome column
- Lead modal call log
- Execution view Prior Calls sidebar card (via call_log entries)

Three surfaces, one source of truth in `routes/sessions.ts`.

## Out of scope (still — unchanged from prior handoff)

- HoneyBook API integration (replacing the embed)
- Time-precision callbacks
- Auto-retirement of dead leads
- Configurable session times
- Per-industry rotation reordering by booking-rate
- Pre-call digest email
- Demo show-rate forecasting
