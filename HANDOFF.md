# Session Handoff — Agency OS v2

_Snapshot: 2026-08-10. Point-in-time notes; goes stale fast. Durable
architecture, deploy mechanics, and gotchas live in `CLAUDE.md` (auto-read
every session). Full PR-by-PR log lives in `CHANGELOG.md`. Practice-call
reference docs live in `docs/`._

## State

Security hardening shipped through PRs #197–#198. Cloudflare Access is live on
the custom dashboard/API domains and production is now `AUTH_MODE=access`; the
browser-bundled and Worker-side legacy key have been retired.
The Agency OS Access application now protects the planned app/API hostnames;
team domain and AUD are captured in `wrangler.toml`. Next: create custom domains,
test passwordless login for `info@shauncarldesigns.com`, then switch to
`AUTH_MODE=access`, remove the production Vite API key, and disable public R2.

## Builder Employee (2026-08-10, shipping)

- Added a one-at-a-time Playwright bulk employee under `builder-worker/`. It
  runs as the `com.agencyos.builder-employee` macOS LaunchAgent, starts at
  login, restarts after crashes, and prevents duplicate local processes. It
  uses a dedicated persistent Chrome profile, fills
  LandingSite's Business Name + Business Description fields, captures the
  validated `*.agcy.dev` `href` directly from the Preview Website anchor, and
  returns it without opening or polling a separate preview tab.
- D1 `builder_runs`, `builder_jobs`, `builder_events`, and `builder_control`
  provide durable queue state, leases/retries, safe-point pause/stop, worker
  health, live steps, failure diagnostics, and run history. Migration:
  `2026-08-10-builder-employee.sql`.
- The Builder dashboard is an operator cockpit: separate employee/run/job
  state, health/readiness, automatic missing-brief preparation, current-build
  progress, queue results, URL/error/artifact details, live activity, median
  and 24-hour metrics, and historical-run inspection/retry. New runs are
  capped server-side at 60 sites; the operator can select 20, 40, or 60, and
  only missing briefs inside that exact batch are generated. Next-batch review
  and Safety exclusions are compact, collapsed-by-default drawers.
- A guarded **Resume build** action recovers an orphaned `building` lease after
  a Mac/worker restart. It is offered only when the employee is idle, offline,
  or errored, releases the stale lock without consuming another attempt, and
  instructs the employee to reuse the already-open LandingSite editor. It must
  fail rather than create a duplicate if no existing editor is open.
- Builder eligibility is fail-closed and must be applied at status display,
  brief selection, queue insertion, job claim, retry, and successful result.
  Eligible leads are undeleted `cold`/`contacted` records in
  `awaiting_build`, with no existing website/demo URL, no project, no booked
  demo, and no Not Interested outcome. Dashboard Safety exclusions expose
  stale Awaiting Build flags without allowing those leads into a run. The
  dashboard previews the exact next batch with remove/restore controls and
  submits those lead IDs; the backend revalidates the reviewed IDs before insertion.
- Artifact policy: successes retain nothing; failures retain JSON + screenshot.
  Video recording is disabled. Failure traces require explicit
  `BUILDER_TRACE_ON_FAILURE=true`; artifacts expire after 30 days by default.
- Email Outreach is now build-first. Email-bearing, no-site leads enter
  **Awaiting Build** before **To Call**; leads without a usable email fall back
  to the call lane. Builder completion saves the tracking URL and schedules
  the existing email automation/review window—no call outcome is required.
- Runtime secret: `BUILDER_API_TOKEN` must match the local employee's
  `.env.local`; the production secret was installed on 2026-08-10. The
  Builder process remains local rather than running on Cloudflare, but its
  LaunchAgent keeps it available to the live dashboard automatically. Use
  `npm run service:status`, `service:restart`, or `service:logs` from
  `builder-worker/` for host-level recovery.

## Outreach visibility + UI fixes (2026-08-08/09, PRs #226–#232, all deployed)

- **PR #232:** Email Outreach page gained a "Site built / No site yet"
  filter (board + automation views) — for VoIP-rerouted leads whose sites
  are already built, so build-complete calls come first.

- **PR #231:** archive button on every active Text Outreach card (was gated
  behind the stale check), and archiving now requires a note — stored in the
  archive activity meta and mirrored onto the lead's timestamped notes.
  Jerry's Household Plumbing (lead 13, prod) replied STOP: reply-engagement
  undone and lead archived directly in prod D1 with reason `replied_stop`.
  For STOP replies: archive directly, do NOT tap "They replied" first
  (engaged leads require a sales-call outcome before archiving).

- **PR #230:** mid-call email capture now sends the intro email immediately
  (automation `send_now`) and auto-advances the modal onto a new
  "Get them to the inbox" email-track stage (sender + subject script,
  hold-the-air small talk, untracked walk-the-site-together link) before
  "Get their reaction". Capture UI moved into the left script pane.

- **PR #229:** last-chance call modal gained (a) a mid-call pivot into the
  warm sales script with a trimmed "Get their reaction" opening, and (b) a
  "Texts not landing?" channel recovery: resend the tracked link (nested
  composer — the call modal stays open) or capture an email mid-call, which
  schedules the email automation, flips `phone_route` to `call` (lead moves
  to the Email Outreach queue), and shifts attribution to email via the
  derived channel logic. No backend changes.

- **Discovery cron debugged — nothing was broken.** Friday's (Aug 7) scheduled
  run completed: 50 results, all already-known/ineligible, 0 new (the first
  rotation combo duplicated the Aug 3 manual Plumbing/Green Bay search;
  manual runs don't advance the rotation cursor). Next runs advance through
  the 10-combo cycle Mon/Wed/Fri 8am.
- **PR #226:** Lead Finder Prospect inbox shows a Last search panel
  (composition bar: new/refreshed/already-in-pipeline/ineligible) and a
  Coming up list of the next 3 scheduled runs (`schedule.upcoming` on
  `GET /api/prospect/inbox-summary`, same rotation math as the cron).
- **PR #227:** email-capture call modal's call button moved to the header
  (matches sales-call modal); footer bar removed.
- **PR #228:** Text Outreach board gained a derived "No engagement — last
  chance" column + "Last chance — call" grid pill for sent_no_reply leads
  with `noReplyStep >= 2`. Frontend-only; `pipeline_status` untouched.
- Research page markets still have `last_researched_at = NULL` — monthly
  refresh won't fire until Sept 1; run manually if data is wanted sooner
  (blocked on Google Ads Basic Access anyway, see below).

## In-session local dev + Research polish (2026-08-08)

- **Development model changed:** Claude sessions run the dev stack (backend
  8788, dashboard 127.0.0.1:5174) via the committed `.claude/launch.json`;
  the operator only opens the browser. Bootstrap + local→prod loop documented
  in CLAUDE.md "Local development". Session servers die with the session —
  restart them on request.
- Research page + market detail refit to the `page-container` standard.
- Local-only demo seed for the Research page:
  `agency-os-backend/src/db/seeds/market-research-demo.sql` (three fictional
  markets; sentinel geo ids `999000x`; rerunnable). Was briefly applied to
  prod by mistake and fully removed the same day — prod has only the two real
  Green Bay markets.
- Google Ads token still awaiting Basic Access — real research runs fail with
  DEVELOPER_TOKEN_NOT_APPROVED; the demo seed exists so the UI is reviewable
  meanwhile.

## Market Research Phase 1 (2026-08-06, PR pending at snapshot)

- New **Research** page (nav: Dashboard → Research → Lead Finder): markets are
  industry × location pairs; each run pulls keyword volume/CPC/competition/
  12-month trend from Google Ads (provider-swappable) and the live map pack
  for the top near-me terms from Outscraper at explicit market coordinates.
  No-website map pack entrants are visually flagged as targets.
- Settings adds a Market research section (`research_json`) and a Google Ads
  health card that separates "not configured" from "Basic Access approval
  pending".
- **Deploy checklist for this PR:** apply `2026-08-06-market-research.sql` to
  remote D1 BEFORE the Worker deploys (settings reads select `research_json`),
  then manual dashboard deploy. Operator-side setup still required before real
  data flows: developer token from the MCC API Center, Basic Access
  application (keyword research use case — has lead time), refresh token with
  the adwords scope, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` var, and at least one
  (free, non-spending) client account under the MCC for planning calls.
- **Monthly refresh rides the hourly cron** (1st of month, 9am Chicago guard)
  because the Worker is at Cloudflare's five-cron-trigger limit.
- **Phase 2 punch list (deliberately not built):** join demand data to
  `leads`; demand factor in `opportunity_score` / `services/scoring.ts`; call
  ammo in the lead modal and Call Center; demand floors in Lead Finder
  discovery config; DataForSEO provider implementation if Ads Basic Access
  stalls; map pack rank-over-time visualization (history is already stored
  append-only).

## Warm sales close and pending agreements (2026-08-06)

- Engaged Email and Text Outreach leads share the `warm-lead-sales-call`
  playbook. Email Capture remains only for the first call; an engaged email lead
  now opens the staged sales call rather than repeating the capture script.
- The call header owns Call and Record. A persistent footer owns Back plus the
  current decision or forward action, culminating in **Advance to client** with
  the selected Build & Maintain or Growth plan.
- Advancing creates a project with `status='prospect'`, which is presented in
  the UI as **Agreement pending**. The linked lead remains qualified, the
  workspace is excluded from MRR and onboarding, and signing moves the project
  to building while marking the lead as a client.
- Clients & Sites has an Agreement Pending stat/filter and a dedicated section
  above active clients. Project Activity includes pending, signing, and final
  conversion events. No migration is required.

## Text Outreach close path and application diagnostics (2026-08-05)

- Text Outreach no longer offers or sends calendar links. Engagement scores at
  the former walkthrough threshold now recommend **Call to discuss site**; the
  call-prep flow records the outcome and exposes **Convert to client** only after
  an agreement. Calendar-click history remains in D1 for audit compatibility but
  no longer affects Clarity scoring or current pipeline recommendations.
- Settings → **Activity & errors** reads from `application_events`. It records
  successful mutations, failed requests, slow requests, unhandled Worker errors,
  and scheduled-trigger starts with status/duration and sanitized response error
  details. It excludes request bodies and credentials, refreshes every 10 seconds
  while open, supports search plus an errors-only filter, and retains 30 days.
- Migration: `2026-08-05-application-events.sql`.

## Client workspace activity timeline (2026-08-05)

- Workspace → **Activity** now loads a unified project timeline from existing
  operational records rather than displaying placeholder copy. Sources include
  project creation/configuration, scrape and DNS checks, briefs, Page Matrix
  additions and live milestones, onboarding completions, report history, Search
  Console snapshots, SEO audit runs, and monthly growth work.
- Linked client projects also include their conversion/outreach events. Internal
  workspaces such as Shaun Carl Designs have no `lead_id`, so their history is
  intentionally populated from project-owned records and does not depend on a
  prospect record.
- Endpoint: `GET /api/projects/:id/activity`. It synthesizes and sorts the
  timeline at read time; no migration or duplicated activity rows are required.

## Outreach-to-Master Brief continuity (2026-08-05)

- Lead conversion already preserves `leads.pipeline_brief` as a project brief
  with `kind='outreach'`. Client cards and the workspace now expose that exact
  artifact as **Outreach brief**; the former name-and-reviews Quick Brief
  generator has been removed and opening/copying the artifact has no model cost.
- Master Brief generation reads the saved outreach artifact (falling back to
  the linked lead's cached pipeline brief for older records) as lowest-priority
  continuity context. Discovery and confirmed project facts remain authoritative,
  followed by verified lead/review data. The prompt may retain supported homepage
  messaging, SEO targets, proof, and visual direction but must discard conflicting
  assumptions, tracking blocks, and one-page structural limitations.
- Existing Master Briefs are unchanged until deliberately regenerated. Page
  Briefs continue to derive only from the authoritative Master Brief.
- Client cards no longer include Edit; Workspace → Configuration is the single
  client-editing path.

## Monthly growth commitments and onboarding placement (2026-08-05)

- A Growth client has three committed page actions per month by default. Page
  creation, content improvement, technical repair, and conversion improvement
  can occupy a committed slot; additional work remains available as bonus work
  and never changes the monthly denominator.
- Brief Studio shows committed progress first and keeps surplus audit/page
  recommendations under **Continue working**. Operators can promote a backlog
  item into an open slot or explicitly replace an untouched planned item;
  started work cannot be replaced. Client cards report completed bonus work
  separately.
- Audit findings fill only unoccupied commitment slots in severity order. The
  complete crawl backlog remains available, while reruns continue reconciling
  resolved findings.
- Generated page briefs end with an unchecked pre-publish SEO release gate.
  After publication, Page Insights can rerun the live crawl and refresh that
  page's technical findings.
- Business Discovery and Asset Collection now sit as compact, matching cards in
  Onboarding. Discovery completion is an automatic checklist item; the existing
  manual asset-receipt item remains the operator's final confirmation.
- Migration: `2026-08-05-growth-commitment-slots.sql`.

## Website health and SEO crawl operations (2026-08-05)

- The Website workspace now combines live-site identity, PageSpeed/search
  snapshots, page inventory, a plain needs-attention list, and a technical SEO
  audit card. The audit crawls up to 50 same-origin pages and checks discovery,
  response/redirect health, indexability, titles, descriptions, H1s, canonicals,
  thin content, image alt text, schema, sitemap coverage, orphaning, duplicate
  metadata, and expected Page Matrix URLs.
- Audit history is stored in `seo_audit_runs`, `seo_audit_pages`, and
  `seo_audit_findings`. Manual runs are available from the Website workspace;
  the existing daily maintenance trigger also audits a bounded set of live Tier
  3 sites whose last successful audit is at least 30 days old.
- Findings reconcile into one actionable growth item per affected page. Resolved
  findings complete their corresponding work, affected Page Matrix cards surface
  the current audit state, and operators can generate update briefs from crawl
  and project context even when an existing site never had a master brief.
- Existing one-off sites can import the latest crawl inventory into Brief Studio.
  The import classifies foundation, service, and custom pages, links crawl records,
  updates page totals, and is idempotent; creating brand-new planned pages still
  requires the normal master-brief workflow.
- Migration: `2026-08-04-seo-crawl-audits.sql`.

## Client workspaces and managed growth operations (2026-08-04)

- Clients & Sites now opens dedicated client workspaces with Overview,
  Onboarding, Website, Brief Studio, Reporting, Activity, and Configuration
  views. Reporting no longer has a separate main-sidebar destination.
- Configuration keeps editable client, contract, website/reporting, DNS, and
  integration fields together. The onboarding checklist combines system-detected
  and operator-confirmed tasks and surfaces progress on each client card.
- Growth work follows Foundation → Expansion → Optimization. The monthly page
  target is three, but page production is treated as one tactic within continuous
  visibility, website, Google Business, proof, and conversion improvement.
- The recommendation queue identifies the next page or live-page improvement,
  highlights the matching matrix card, permits an alternate choice, and prevents
  repeated brief charges. Optimization items generate versioned update briefs;
  completing the brief completes the linked work item and restores the page's
  live state without a reload.
- Live Page Matrix cards expose Search Console position, movement, impressions,
  and clicks. Clicking one opens Page Insights with current metrics, trends,
  recommendation context, brief history, page metadata, and related actions.
- Planned-page totals are derived from current services and service areas while
  retaining the project's intentional planned-scope offset. Local expansion and
  fully built optimization fixtures live under `agency-os-backend/src/db/seeds/`.
- Release migrations, in dependency order: `2026-08-04-client-conversion.sql`,
  `2026-08-04-growth-monthly-page-target.sql`, `2026-08-04-growth-cycles.sql`,
  `2026-08-04-growth-strategies.sql`, `2026-08-04-growth-page-recommendations.sql`,
  `2026-08-04-growth-completion-signals.sql`,
  `2026-08-04-growth-work-item-briefs.sql`, and
  `2026-08-04-client-onboarding.sql`.

## Automated Lead Finder inbox (2026-08-03)

- Lead Finder now has a durable `prospect_candidates` review inbox and
  `prospect_search_runs` audit history. Migration:
  `2026-08-03-automated-lead-finder.sql`.
- Targeting is intentionally locked to businesses without a website and a
  server-curated home-services list. Settings controls enabled state, M/W/F-style
  schedule, local hour, industries, locations, phone requirement, score floor,
  run/inbox limits, rejection suppression, and candidate expiration.
- The existing hourly Worker trigger checks the configured local weekday/hour;
  scheduled keys make retries idempotent and the profile rotation advances only
  after completed scheduled runs. Discovery is disabled by default.
- The responsive inbox supports manual discovery and bulk approve/reject up to
  25 candidates. Approval refetches Google details and rejects candidates that
  acquired a website or lack a phone before creating a cold pipeline lead.
- Local discovery requires a real `GOOGLE_PLACES_API_KEY` in `.dev.vars`; the
  checked-in/local placeholder is reported as disconnected rather than failing
  with a generic Google 400.

## Access security hardening (2026-08-02)

- Planned protected hosts: dashboard `app.shauncarldesigns.com`, API
  `api.shauncarldesigns.com`; public tracking remains `try.shauncarldesigns.com`.
- Access team domain: `https://tight-disk-cf65.cloudflareaccess.com`; the
  application AUD is stored as the non-secret `ACCESS_AUD` Worker variable.
- Worker auth verifies Cloudflare Access JWT issuer, audience, signature, and
  exact operator email. Legacy API-key and mixed rollout modes remain available
  only for the staged transition.
- Dashboard requests include Access credentials; production validation no longer
  requires a browser-bundled `VITE_API_KEY`. CORS and security headers are narrow.
- Outreach redirects have a Cloudflare rate-limit binding. Scraping rejects
  private/local targets. Audio uploads are audio-only and capped at 25 MB.
- Recordings are served through authenticated `/api/recordings/file/*`; existing
  public URLs are understood without a database migration. Disable R2 `r2.dev`
  only after this Worker/dashboard version is deployed and playback is verified.

## Confirmed outreach visits (2026-07-31)

- `/r/:lead_id` records each observation in `outreach_clicks` with coarse
  Cloudflare country/region/city, ASN/organization, browser signals, optional
  bot signals, classification, confidence, reasons, and a 24-hour token. Full
  IP addresses are not stored.
- Known crawlers and implausible foreign or hosting-network checks are screened:
  the Activity trail retains them for debugging, but they do not add points,
  increment sessions, promote cards, or complete email automation.
- Updated Clarity/site-header blocks confirm a visible two-second page load or
  user interaction through `POST /r/:lead_id/confirm`. Only plausible confirmed
  visits create the existing authoritative `click_tracked` signal.
- Existing sites are rollout-safe: plausible redirects keep legacy credit until
  the first valid beacon self-enrolls the lead, without double-counting that
  visit. Later redirects require confirmation.
- Activity shows confirmed or screened location/reason details and offers
  **Copy tracking block** for upgrading an existing demo site.
- Migration: `2026-07-31-outreach-click-confirmation.sql`.

## Call Outreach email engine (released 2026-07-31)

- Call Outreach is now a call-first email Kanban: To Call → Awaiting Build →
  Ready to Send → Sent — No Reply → Final Review / Engaged. Capturing an email
  updates the lead record; saving the site URL auto-starts automation when the
  recipient is valid. Placeholder and likely mistyped addresses route to an
  explicit Update email action.
- Resend sends from `info@shauncarldesigns.com`. The Worker stores send and
  provider IDs, consumes signed delivery/open/click/failure webhooks, tracks a
  first-party open pixel and `/r/:lead_id?channel=email` demo clicks, and runs
  due automations every five minutes.
- The fixed per-lead workflow is ten-minute review → initial email → 48-hour
  engagement check → no-open/opened-no-click follow-up → five-day wait → final
  touch → three-day wait → operator Final Review. It never auto-archives.
- Controls are per lead: pause/resume, skip wait and send now, edit the next
  email, stop, move to Final Review with a 15-second server-backed undo, extend
  review, or explicitly archive. Final Review cards use Call now and preserve
  no-answer, voicemail, and callback outcomes within that phase.
- Engaged actions are score-driven: 40–69 email follow-up, 70–89 Call now,
  90+ Call immediately. Call outcomes write both `call_log` and
  `lead_activity`; card chips are phase-local while Activity remains durable.
- Automation Grid shows live node state, timing, engagement score, send/event
  inspection, and per-lead controls. A Resend-safe local fixture uses
  `delivered@resend.dev`.
- The session execution cockpit moved to the dedicated Call Center page; Call
  Outreach owns the Kanban and focused call/build/email modals.
- New Worker secrets/config: `RESEND_WEBHOOK_SECRET` secret plus
  `OUTREACH_EMAIL_FROM`, `OUTREACH_EMAIL_REPLY_TO`, and `OUTREACH_PUBLIC_URL`
  vars. The existing `RESEND_API_KEY` remains the send credential.

## Text Outreach engagement sequence (PR #183)

- Engaged remains one Kanban column. The card-level sequence is derived from
  `lead_activity` rather than a new status column: score-based first action
  (Ask for Feedback / Offer a Walkthrough / Call Now), Waiting for Reply,
  Send Final Follow-up, then Call — Last Chance.
- Engaged recommendations clamp to the 40-point floor, so Nurture cannot
  appear after a tracked click even if an older malformed row has a lower
  stored score.
- After 30 days without activity, an Engaged card becomes stale and exposes
  a compact archive control. Archive is reversible; Undo restores both the
  Engaged status and the pre-archive last-action timestamp.
- The Site built chip links to `site_url_raw` in a new tab. Older rows fall
  back to the tagged URL with outreach UTM parameters removed; the operator
  preview never uses the `/r/:lead_id` tracker.
- Local seed data includes one Engaged card for every possible primary
  action plus a stale/archive example.

## Sent — No Reply sequence (PR pending at snapshot)

- Ready to Send is unchanged. After the intro moves a lead into Sent — No
  Reply, recorded `followed_up` activity drives Send Reminder → Send Final
  Nudge → Call — Last Chance inside the same column.
- The reminder keeps the existing “bump this back up” tracked-link copy.
  The final nudge also includes the tracked homepage link and asks for an
  easy yes/no response.
- A manual “They replied” icon promotes a non-clicking lead to Engaged with
  a 40-point floor. Undo restores the previous status, score, grade, and
  reasons.
- Replying is not treated as visiting: Engaged leads with zero tracked
  sessions continue receiving the homepage link until
  `pipeline_sessions > 0`.
- Completed no-reply sequences become stale after 14 inactive days and can
  be archived. Local seed data covers every action/state.

## What shipped recently (PRs #129–#153)

Two headline features, built from an external design-spec package
(`agency-os-v2-pipeline/` — README + build brief + two canonical `.jsx`
visual specs):

### Dashboard KPI view (#147, #149, #153)

- **[#147](https://github.com/shauncarldesigns/agency-os-v2/pull/147)** The Dashboard tab is no longer an empty placeholder. It now shows a KPI-first view for the Automated Pipeline: hot leads ready to call, this week's reply-rate slot, meetings booked this week, active pipeline size, funnel strip, channel split, and a Needs action list. Backend endpoint: `GET /api/dashboard/pipeline-kpis`.
- **[#149](https://github.com/shauncarldesigns/agency-os-v2/pull/149)** Added a concrete Automated Pipeline activity row under the headline KPIs: sites created from `url_saved`, intro texts from `intro_sent`, follow-ups from `followed_up`, and engaged leads / total visits from `click_tracked`, all week-scoped with previous-week deltas.
- **[#153](https://github.com/shauncarldesigns/agency-os-v2/pull/153)** Corrected "Sites created" to count active built sites in the Automated Pipeline (`site_url` present and non-terminal pipeline status), so it matches the Ready to send queue even when sites were saved before the current calling week. Also redeployed the dashboard with production env after a bad bundle embedded `localhost:8788`.
- Current truth boundary: SMS send/tap/engagement/book metrics are real (`lead_activity`, `pipeline_sessions`, `demos`). Reply rate and Facebook split intentionally render as "not tracked" until the app records reply/channel events explicitly.

### Automated Pipeline → Sites bridge (#148)

- **[#148](https://github.com/shauncarldesigns/agency-os-v2/pull/148)** Automated Pipeline now has a real demo-booking bridge into Sites. The engaged Call Prep modal replaces `Log call` with `Book demo`; the automated lead-detail header also has a fallback `Book demo` action. Both reuse `POST /api/leads/:id/qualify`, create a Sites prospect project, and route the operator to Sites.
- `POST /api/leads/:id/qualify` and session booked outcomes now set `leads.pipeline_status='booked'`. `/api/pipeline/leads` excludes `booked` / `archived`, so leads leave the active Automated Pipeline Kanban once they become a prospect or client.

### Clean tracking links (#150)

- **[#150](https://github.com/shauncarldesigns/agency-os-v2/pull/150)** The Automated Pipeline SMS composers now use `VITE_TRACKING_URL` for public `/r/:lead_id` links instead of `VITE_API_URL`. Production is configured for `https://try.shauncarldesigns.com`, attached to the existing Worker as a custom domain, so texted links look like `https://try.shauncarldesigns.com/r/11` while API calls stay on the Worker API hostname.
- **[#151](https://github.com/shauncarldesigns/agency-os-v2/pull/151)** Follow-up hotfix: `workers_dev = true` is explicit in `wrangler.toml` so adding the custom domain does not strand the existing dashboard API hostname.

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

1. Retire the public `agency-os-v2-dashboard.pages.dev` hostname after the
   custom app domain rollout: add a Cloudflare Bulk Redirect (preserve paths
   and query strings, include preview subdomains unless previews remain
   intentionally available), make `app.shauncarldesigns.com` canonical in
   repo docs, and verify the Pages hostname can no longer bypass Access.
2. Runtime demo scripts vs `docs/practice-demo-calls.md` drift — pending
   operator decision.
3. HVAC pool empty (sessions composing for `hvac_contractor` find nothing).
4. `reviewExtraction.ts` still requests unused `differentiators` field.
5. Pitch card backfill — many leads still have null `pitch_card_text`.
6. `voicemail.md` playbook script still missing content.
7. Generated-variant promotion workflow (playbook_generations → markdown).
8. Auto-project-on-booked can double-create projects.

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
