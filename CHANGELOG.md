# Changelog

Reverse chronological. One entry per merged PR with user-visible change.
Pure internal refactors, CI tweaks, and dep bumps may be omitted.

Backend Worker auto-deploys via CI on merge. Dashboard requires manual
`cd agency-os-dashboard && npm run deploy` — entries below note "dashboard"
when a manual deploy was needed.

## 2026-08

### Access session and sign-out recovery (dashboard)

- **Agency OS now recovers expired Cloudflare Access API sessions through the
  login flow and returns to the dashboard**, while Sign out clears the Access
  session in place and shows a useful sign-back-in screen instead of navigating
  to Cloudflare's "No Access cookie found" page.

### Pipeline briefs: hero H1-first rule repeated in hero copy (backend)

- **Generated pipeline briefs now repeat the "no eyebrow/kicker/pill badge
  above the H1" prohibition verbatim inside the HERO COPY section**, not
  just in CONSTRAINTS — landingsite.ai was ignoring the rule when it only
  appeared once at the bottom of the brief. Regenerate a lead's brief to
  pick up the change.

### LandingSite Builder Employee (backend + dashboard + local worker)

- **Brief preparation now runs inside the durable Builder employee instead of
  the open dashboard page.** Start records the batch immediately, the employee
  prepares missing briefs in the background before browser work, and the
  operator can leave the page or safely pause/resume the run without losing
  preparation progress. Brief failures retry three times without stopping the
  rest of the batch. A same-day hotfix represents preparation as the existing
  durable `running` state plus a `Preparing brief` step, matching the original
  D1 state constraint so active runs can be claimed normally.
- **Email Outreach, Text Outreach, and Builder now share one server-side
  audience definition.** Email's To Call lane requires a completed demo plus
  a missing/invalid email; call-routed prospects without a demo remain in
  Awaiting Build. Builder queues the union of the Email and Text Awaiting Build
  audiences while manual-review phone routes remain safely excluded.
- **Interrupted Builder jobs can now be resumed from the dashboard.** The
  guarded Resume build action only appears when D1 says a website is Building
  but the browser employee is idle, offline, or in error; it preserves the
  retry attempt and reuses the existing open LandingSite editor instead of
  creating a duplicate project.
- **Completed jobs now clear their retained LandingSite editor URL** before
  the employee returns idle or claims another lead, preventing a later resume
  from ever inheriting the previous company's project.
- **Builder batches now support 20, 40, or 60 sites**, while continuing to
  process one website at a time. The next-batch review is a compact drawer
  with remove/restore controls, and Safety exclusions are collapsed by default.
- **The Builder now reads the validated `*.agcy.dev` URL directly from the
  Preview Website anchor** instead of clicking it, opening a tab, and polling
  the preview page. It locates the anchor by its `*.agcy.dev` href first, so
  LandingSite text-spacing changes cannot leave a completed build waiting.
  Legacy preview tabs are cleaned up when the next job starts.
- **Successful Builder jobs no longer retain Playwright video or trace ZIPs.**
  Failures keep a small JSON error log plus screenshot; heavyweight traces are
  opt-in for targeted debugging, with 30-day artifact retention by default.
- **Builder eligibility now fails closed across dashboard counts, brief
  preparation, queue creation, worker claims, retries, and URL completion.**
  Not-interested or qualified/demo-booked leads, existing projects, existing
  websites, and previously saved demo URLs are excluded and surfaced in a
  dashboard Safety exclusions list instead of being built. The exact next
  batch is previewed in a compact drawer, and only reviewed lead IDs can be queued.
- **Builder runs are now capped at an operator-selected batch of 20, 40, or
  60 sites (default 20)**. Only briefs needed by that batch are prepared; all
  remaining Awaiting Build leads stay queued for a later run.
- **Builder Employee now installs as an always-on macOS login service**,
  restarts after crashes, prevents duplicate local workers, and exposes local
  status/restart/log commands.
- **Awaiting Build leads can now flow through a single-process Playwright
  employee into Ready to Send**, with a durable D1 queue, dedicated Chrome
  profile, state-based LandingSite completion, three-attempt retry handling,
  failure artifacts, and dashboard pause/retry/health controls.
- **The Builder dashboard is now an operator cockpit** with distinct employee,
  run, and job status; readiness checks; automatic missing-brief preparation;
  current-build progress; detailed queue results; live events; diagnostics;
  median/24-hour metrics; and inspectable run history.
- **Email Outreach is now build-first instead of call-gated**: email-bearing,
  no-site leads enter Awaiting Build before a call, Start Builder prepares any
  missing app-owned briefs, and the existing URL-completion service schedules
  email automation after the demo is ready.

### Email Outreach: filter by site built (dashboard)

- **A "Site built / No site yet" filter joins the industry and city filters
  on the Email Outreach page** (board and automation views) — for leads
  rerouted from Text Outreach whose sites are already built, so the operator
  can call the build-complete leads first.

### Text Outreach: archive any active lead immediately (dashboard)

- **The archive button on Text Outreach cards (board + grid) now shows for
  every sent_no_reply / engaged lead**, not just stale ones — for "STOP"
  replies and immediate not-interested outcomes. Stale leads keep the amber
  styling; fresh ones get a neutral icon with a rose hover. Same confirm +
  undo flow; engaged leads still require a recorded sales-call outcome
  (server rule unchanged).

### Last-chance call: email capture now sends the intro email immediately (dashboard)

- **Capturing an email in the last-chance call fires the intro email right
  away** (via the automation's existing `send_now` action) instead of
  waiting out the 10-minute review window — the prospect can check their
  inbox while still on the phone. The automation then continues into the
  normal follow-up flow. If the immediate send fails, the modal says so and
  the email stays queued for review on the Email Outreach page.
- **A "Get them to the inbox" email-track stage opens the warm script after
  the send**: the email's actual sender + subject line, hold-the-air small
  talk while the email lands, an untracked open-the-site-on-your-side link
  so the operator walks the site with them, and a choice between advancing
  to "Get their reaction" or recording "follow up later" (the email
  sequence takes over).

### Last-chance call: channel recovery — resend text or switch to email (dashboard)

- **The last-chance call modal gains a "Texts not landing?" section** for
  sent_no_reply leads: resend the tracked site link by text (opens the
  follow-up composer), or capture an email mid-call and switch the lead to
  the email-outreach motion. Email capture reuses the canonical shape
  (email + ready_to_send + Email Captured → backend schedules the email
  automation, intro email sends from the Email Outreach queue) and flips
  `phone_route` to `call`, so the lead leaves the Text Outreach queue and
  **all engagement from then on attributes to email, not text** (channel is
  derived from the email automation/send rows).

### Last-chance call: mid-call pivot into the warm sales script (dashboard)

- **The last-attempt call modal gains a "They're interested — open the sales
  script" button** that switches into the warm-lead sales script mid-call.
  The opening stage swaps to a trimmed "Get their reaction" version (the
  intro already happened on this call); every later stage, the objection
  responses, and the plan/close flow are the standard warm script. UI-only
  pivot — lead status still changes via the tracked link or the recorded
  outcome.

### Text Outreach: "No engagement — last chance" board column (dashboard)

- **Sent — no reply leads whose text sequence is exhausted now split into
  their own board column** ("No engagement — last chance", rose phone icon)
  and grid filter pill ("Last chance — call"), so the texting queue stays
  clean. Purely derived from `noReplyStep` — the lead's `pipeline_status`
  stays `sent_no_reply`; no backend or schema change.

### Email capture call: call button moved to the modal header (dashboard)

- **The "Open call" email-capture modal's call button now sits in the
  header next to the record button** (matching the sales-call modal)
  instead of a full-width footer bar, so the script and outcome buttons
  get the full height of the modal.

### Lead Finder: last-search stats + next scheduled search (dashboard)

- **The Prospect inbox now shows a "Last search" panel** — a segmented
  composition bar breaking down where every result went (new / refreshed /
  already in pipeline / ineligible) with a "+N new candidates" or "nothing
  new" headline, and the error message when a run failed. Answers "why did
  the run add nothing?" without querying the database.
- **A "Coming up" schedule lists the next 3 automated runs** (industry ·
  location + day, next one highlighted) using the same rotation math as the
  cron: completed scheduled runs modulo the industry×location combinations,
  run days from the discovery settings in the operator's timezone.
- `GET /api/prospect/inbox-summary` returns the full last-run stat columns
  and a computed `schedule.upcoming` list.

### Pipeline UX: tracking-block card only for pre-brief sites + Email label

- **The lead modal's "Confirmed visitor tracking" card now appears only for
  sites whose cached brief predates the brief-embedded tracking snippet**
  (detected by the `outreach_token` confirmation code in `pipeline_brief`).
  Sites built from current briefs already carry the block, so the card was a
  duplicate instruction; its copy now says it's a retrofit for older sites.
- **Dashboard "Needs action" header relabels "Call N" to "Email N"** — the
  button routes to the Email Outreach page and counts email-motion leads, so
  the Call label was misleading. Dashboard deploy needed.

### Research page design-system compliance + in-session local dev

- **Research page and market detail now follow the app's page skeleton** —
  wrapped in `page-container` (72rem centered, standard padding) with the
  standard flex header row instead of a one-off full-bleed hero card.
  Dashboard deploy needed.
- **Local development is now in-session by default.** `.claude/launch.json`
  is committed (backend Worker on 8788, dashboard on `127.0.0.1:5174`) so
  Claude sessions run the dev stack for the operator; CLAUDE.md documents the
  worktree bootstrap and the build-local-then-ship-to-prod loop. Added
  local-only Research demo seed (`src/db/seeds/market-research-demo.sql`).

### Research: add markets by city name

- **Adding a market no longer requires looking up Google's geo target CSV or typing coordinates.** The add-market form is now industry + a city typeahead over a seeded lookup of all 562 active Wisconsin city geo targets (from Google's `geotargets-2026-07-16` dataset); the criteria ID rides along invisibly and city-center coordinates are resolved server-side via the existing Google Places key. Backend + dashboard + migration (`2026-08-06-geo-targets-wi.sql`, apply before deploy).

### Market research — demand and map pack per market (Phase 1)

- **New Research page answers, per industry × city market: is there search demand here, and who currently owns it.** Operators define markets (industry, location, Google Ads geo target ID, map coordinates), then run research manually or via the monthly refresh on the 1st. Each run pulls a ranked keyword list — monthly volume, CPC range, competition, and 12-month seasonality sparkline — from the Google Ads API (behind a swappable provider interface), and captures the live Google map pack for the top “near me” terms via Outscraper at the market's exact coordinates. Ranking businesses without a website are flagged as targets. Settings adds a Market research config section (seed templates, industry search terms, map pack counts, batch cap, provider) and a Google Ads integration health card that distinguishes missing credentials from a developer token still awaiting Basic Access approval. Demand is stored per market, never per lead. Backend + dashboard + migration (`2026-08-06-market-research.sql`, **apply before deploying the Worker** — settings reads fail without it). New Worker secrets `GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` / `GOOGLE_ADS_REFRESH_TOKEN` and vars `GOOGLE_ADS_LOGIN_CUSTOMER_ID` / `KEYWORD_VOLUME_PROVIDER`.

### Warm sales calls and agreement-pending clients

- **Engaged Email and Text Outreach leads now finish in one guided warm-sales-call workflow instead of repeating the initial capture script or ending with more messages.** The staged call adapts to the prospect's needs, keeps calling and recording controls in the header, requires explicit branch choices, and carries the selected Build & Maintain or Growth plan directly into a new agreement-pending client workspace. Clients & Sites adds a dedicated pending-agreement count, filter, and section; these workspaces remain excluded from MRR and onboarding until the agreement is marked signed. Backend + dashboard.

### Text Outreach close path and application activity log

- **Text Outreach now moves directly from engagement to a closing call instead of inserting a calendar stage.** The walkthrough recommendation is now “Call to discuss site,” call outcomes no longer prepare HoneyBook links, scheduling follow-ups and calendar conversion analytics are removed from the active interface, and legacy calendar clicks no longer raise engagement scores. Settings adds a persistent Activity & Errors feed for mutations, failed or slow API requests, scheduled triggers, status codes, durations, sanitized error details, search, an errors-only view, and ten-second refresh while open. Logs retain 30 days and never store request bodies or credentials. Backend + dashboard + migration (`2026-08-05-application-events.sql`, apply before deploy).
- **Client workspace Activity is now a real operational timeline instead of placeholder copy.** It combines project configuration, onboarding, website/DNS, Page Matrix and brief milestones, SEO audit runs, reporting refreshes, report history, growth work, and linked outreach conversion events. Internal clients without prospect records receive the same project-based history. Backend + dashboard.

### Outreach-to-Master Brief continuity

- **The brief that produced the original Email or Text Outreach site now remains useful after conversion without becoming a competing source of truth.** Client cards replace the obsolete Quick Brief generator with a read-only Outreach Brief artifact, while new or regenerated Master Briefs receive that artifact as lowest-priority continuity context beneath confirmed Discovery, project, lead, and review data. Supported homepage messaging, SEO targets, proof, and design direction can carry forward; outreach-era assumptions and tracking instructions cannot. Client-card editing has also been removed because Configuration is now the single editing surface. Backend + dashboard.

### Monthly growth commitments and compact onboarding

- **Growth-plan fulfillment now treats three page actions as the monthly commitment rather than a hard work limit.** Brief Studio separates committed creation/improvement work from an expandable bonus backlog, protects started commitments from replacement, reports bonus completions without changing the `3 of 3` denominator, and uses SEO audit severity to fill only open monthly slots. New page briefs include a pre-publish SEO checklist, live pages can be revalidated from Page Insights, and Discovery plus asset collection now live as compact, consistent cards within Onboarding instead of Brief Studio. Backend + dashboard + migration (`2026-08-05-growth-commitment-slots.sql`, apply before deploy).

### Website health and SEO crawl operations

- **The Website workspace now provides an actionable operating view for live-site health.** Operators can refresh PageSpeed, run a bounded technical SEO crawl, review prioritized page-level findings, import already-live pages into Brief Studio when no Page Matrix exists, and turn crawl findings into update briefs without first generating a master brief. Audit reruns reconcile resolved work, the Page Matrix and Page Insights surface current crawl context, and eligible live Tier 3 sites receive a rolling 30-day audit through the existing daily maintenance trigger. Backend + dashboard + migration (`2026-08-04-seo-crawl-audits.sql`, apply before deploy).

### Search Console reporting repair

- **Reporting now calls Google Search Console’s case-sensitive `searchAnalytics` endpoint correctly, restoring impressions, clicks, rankings, keywords, and page data after refresh.** The obsolete Cloudflare zone-analytics request has been removed from report collection because client sites use DNS-only records and do not send traffic through Cloudflare’s proxy; Cloudflare remains responsible for domain and DNS management. Backend.

### DNS configuration save action and spacing

- **Domain & DNS configuration now saves registrar and domain-owner email independently from Cloudflare operations.** The linked-zone status card and action rows have consistent spacing, primary domains are protected from inline edits after a zone is linked, and DNS refresh uses the shared icon system. Dashboard.

### LandingSite configuration cleanup

- **Client workspaces no longer show or accept a LandingSite project ID, because LandingSite does not provide one.** Website configuration retains the actionable LandingSite URL, live domain, Search Console property, and reporting recipient fields. Backend + dashboard.

### Client workspaces and managed growth operations

- **Clients & Sites now runs each signed account from a dedicated workspace instead of mixing operational settings into Brief Studio.** Workspace navigation separates onboarding, website work, Brief Studio, reporting, activity, and inline configuration; client cards show onboarding progress while internal/test workspaces stay out of MRR and lead statistics. The managed-growth workflow tracks Foundation → Expansion → Optimization, recommends the next pages or optimization work, prevents duplicate brief generation, links versioned update briefs to live pages, and clears completed work immediately. Page Matrix cards now show live Search Console metrics and open a page-insights drawer with trends, recommendations, brief history, and page metadata; planned/live totals react to service and service-area changes. Reporting is contained within each workspace, the legacy report navigation is removed, and legacy emoji UI has been replaced with the shared icon system. Backend + dashboard + migrations (`2026-08-04-client-conversion.sql`, `2026-08-04-growth-monthly-page-target.sql`, `2026-08-04-growth-cycles.sql`, `2026-08-04-growth-strategies.sql`, `2026-08-04-growth-page-recommendations.sql`, `2026-08-04-growth-completion-signals.sql`, `2026-08-04-growth-work-item-briefs.sql`, `2026-08-04-client-onboarding.sql`; apply before deploy).

### Enrichment progress and reversible outreach actions

- **Lead enrichment now reports real backend progress instead of leaving the operator at an indefinite loading state.** A responsive progress modal shows the active enrichment stage, completed steps, percentage, and remaining work while safely polling in the background. Text Outreach’s optimistic Messages handoff, URL saves, pipeline transitions, and lead trash actions now use a shared compact Undo notification; actionable timers pause while the app is hidden or an external Messages dialog has focus, then resume when the operator returns. Backend + dashboard + migration (`2026-08-03-enrichment-progress.sql`, apply before deploy).

### Email capture call workspace and private recording playback

- **Email Outreach’s first-call modal is now a focused two-column email-capture workspace.** The personalized script, inline email capture, and post-capture close sit beside expandable objection responses, Google reputation context, prior call history, and outcome-linked notes; the Call Center recorder is available directly in the modal and attaches its upload to the selected outcome. Current and historical recordings play inline in both Email Outreach and lead/client Call History, while legacy public R2 references are safely translated through the authenticated Worker playback route so the recording bucket can remain private. Backend + dashboard.

### Workspace UI consistency and Lead Finder bulk intake

- **Email Outreach, Call Center, Reports, Lead Pipeline, and Lead Finder now share a consistent responsive page shell and interaction design.** Email Outreach completes the former Call Outreach rename (including its route), adds search parity with Text Outreach, and removes redundant headings; Call Center aligns its controls and spacing; Reports adopts the current card system; Pipeline uses a recoverable Archive action for completed not-interested prospects and replaces the legacy enrichment accent with a full-card border. Lead Finder puts manual results above the automated inbox, adds Google Maps research links to inbox cards, and supports selecting up to 25 manual results for one bulk pipeline add with accurate partial-success reporting. Backend + dashboard.

### Sidebar workflow and modal score context

- **The main sidebar now follows the operating workflow: Dashboard, Lead Finder, Lead Pipeline, Email Outreach, Text Outreach, then Call Center.** The former Call Outreach navigation label uses an email icon while retaining its existing route and behavior; lead detail modals restore the opportunity-score explanation directly on the score with responsive hover and keyboard-focus support. Dashboard.

### Automated Lead Finder inbox

- **Lead Finder can now discover no-website home-service prospects on a configurable schedule and hold them for operator review.** Settings controls the enabled weekdays, local run hour, approved industries, search locations, phone requirement, score floor, run size, inbox capacity, rejection suppression, and expiration without a redeploy. The responsive prospect inbox supports manual runs plus bulk approval or rejection, rechecks website and phone eligibility before pipeline entry, suppresses duplicates, rotates profiles idempotently through the existing hourly Worker trigger, and reports invalid local Google Places credentials clearly. Backend + dashboard + migration (`2026-08-03-automated-lead-finder.sql`, apply before deploy).

### Core workspace UI refresh

- **Lead Pipeline, Clients & Sites, Brief Studio, Lead Finder, and the selected-company Call Center now share one responsive design system.** Pipeline adds sticky sortable headers, a locked company column, compact cross-channel routing and latest-touch context, and a one-click return to last-updated order; client projects are grouped above prospects, portfolio and Brief Studio cards scale cleanly to mobile, Lead Finder gains a clearer search/review surface, and Call Center uses consistent Lucide icons, full-width execution panels, and responsive outcome controls. Backend + dashboard.

### Workspace settings and integration health

- **The sidebar Settings and operator footer now open real workspace controls.** Agency OS persists general identity, calling/outreach composition, engagement thresholds, agency defaults, pricing references, service conventions, and writing guidance; new calling weeks consume the configured session size, score floor, and industry rotation. Integration cards report configuration health without exposing Worker secrets, System & Data shows live D1 totals and supports CSV export and manual Clarity sync, and the operator menu adds profile access, shortcut help, and Cloudflare Access sign-out. Backend + dashboard + migration (`2026-08-02-agency-settings.sql`, apply before deploy).

### Access security hardening

- **Agency OS now uses passwordless Cloudflare Access and no longer embeds production API credentials in the browser.** Administrative API requests validate Access JWT signatures, audience, issuer, and the exact operator email; dashboard requests use the protected session. CORS and browser security headers are restricted, public outreach redirects are rate-limited, call recordings play through an authenticated Worker route instead of public R2, uploads are constrained, scraper URLs reject local/private targets, and production dependencies audit clean. Backend + dashboard.

## 2026-07

### Confirmed outreach visits

- **Tracked outreach links now distinguish confirmed visitors from automated link scanners.** The Worker records coarse Cloudflare location/network signals and classifies each redirect without storing full IP addresses; bots and implausible foreign or hosting-network checks remain visible as screened Activity events but do not add engagement points or move cards. Updated demo-site tracking blocks confirm a visible page load or interaction before awarding the 40-point visit signal, while existing sites retain safe legacy behavior until their first upgraded confirmation. The lead Activity tab includes a one-click control for copying the upgraded block. Backend + dashboard + migration (`2026-07-31-outreach-click-confirmation.sql`, apply before deploy).

### Engagement attribution dashboard

- **The dashboard now attributes each lead’s first engagement to the text that caused it.** Intro, Reminder, and Final nudge cards show engaged leads, conversion rate, and prior-period movement with 7-day, 30-day, and all-time filters. Needs action is now a compact top-of-dashboard strip containing only genuinely Engaged leads not called since their latest click, reply, or calendar interaction; channel-aware Text and Call controls open the correct outreach board. Backend + dashboard.

### Channel-safe Call Outreach history

- **Call Outreach cards no longer mistake prior Text Outreach activity for sent emails.** Leads with text-history actions such as intro sent, followed up, or sent without reply now show “No outreach yet” until they actually enter the email workflow; email sequence chips and decay timers remain isolated to real email outreach. Dashboard.

### Call-first email outreach automation

- **Call Outreach now runs a complete Resend-backed email workflow from captured email through final operator review.** The Kanban adds Awaiting Build, Ready to Send, Sent — No Reply, Final Review, and Engaged phases; site saves automatically start a ten-minute review window, fixed automation steps send engagement-aware follow-ups, and safe controls support pause, skip-wait-and-send, per-lead email edits, stop, reversible Final Review moves, callbacks, explicit archive, and score-based Engaged actions. A dedicated automation view exposes live schedules, delivery/open/click events, provider failures, and engagement scores; call cards retain phase-local outcome chips and full activity history. Resend webhooks, first-party open pixels, tracked demo clicks, recipient validation, a five-minute Worker cron, and final-review safeguards provide the backend engine. Backend + dashboard + migration (`2026-07-30-email-outreach.sql`, apply before deploy).
- **Call execution now has a dedicated Call Center page.** Call Outreach remains the Kanban and opens focused call modals, while the existing session execution cockpit is preserved under Call Center with the selected company/session context. Dashboard.

### Phone-routing tooltip cleanup

- **Lead details now keeps phone-routing metadata inside the active route tooltip.** The redundant inline line-type and carrier label is removed, and the hover/focus tooltip renders above the modal footer without clipping. Dashboard.

### Attributed outreach dashboard metrics

- **The dashboard now prioritizes Text Outreach Activity and replaces loosely correlated funnel/channel cards with actionable, lead-attributed metrics.** Follow-up activation measures leads whose first engagement happened after a follow-up; Calendar → booked measures tracked calendar opens that later produced a demo. A Chicago-time 8am–8pm send-time chart replaces the unused Facebook Channel Split card and shows intro versus follow-up volume by hour. Backend + dashboard.

### Text Outreach search controls

- **Text Outreach now has Industry and City filters plus a one-click Refresh control beside search.** Search covers company, industry, city, address, and phone; the same controls filter grid and board views, and status counts update to match the narrowed lead set. Dashboard.

### H1-first outreach heroes

- **Generated outreach-site briefs now explicitly prohibit AI-cliché pill badges above the H1.** The H1 must be the hero’s first text element, with eyebrow labels, kickers, category chips, and announcement pills banned in both the hero instructions and final constraints. Backend.

### Outreach last-touch timers

- **Text Outreach cards now show the latest real action, its age, and follow-up count at a glance.** A four-stage color-decay indicator makes fresh, cooling, due, and overdue touches visually distinct in both grid and board views; vague “Updated” labels are replaced with activity-backed names such as “Follow-up #2 sent,” “Calendar opened,” or “Engagement recorded.” Backend + dashboard.

### Tracked scheduling follow-up

- **Text Outreach now turns unsuccessful calls and calendar interest into a visible scheduling workflow.** Call outcomes prepare tailored texts containing a tracked HoneyBook link; replies and site clicks combine into a 55-point intent baseline regardless of order, while opening the calendar creates a separate 80-point scheduling signal without pretending a demo was booked. Calendar-opened leads can text or call about scheduling, explicitly record a booking, or archive the lead, and sending the scheduling follow-up advances the card to a call recommendation. Backend + dashboard.
- **Generated briefs now require every page H1 to name both the service and its target location.** Creative supporting language remains allowed, but the trade/service and city or service area must stay in the literal H1 and headline direction for reliable local SEO targeting. Backend.
- **Pipeline briefs no longer prescribe a hero layout.** They still provide exact hero copy, typography, proof, CTA requirements, and a distinguishing visual element, but landingsite.ai now chooses the hero composition, image placement, columns, and rating/CTA arrangement for more varied designs. Backend.
- **Pipeline briefs no longer assign invented color palettes or hex codes.** When no verified branding is available, landingsite.ai now chooses colors from the business’s trade, imagery, personality, and positioning without representing them as established brand colors. Backend.

### Sent — No Reply outreach sequence

- **Sent — No Reply now advances through a complete, activity-backed outreach sequence inside one column.** Cards progress from Send Reminder to Send Final Nudge to Call — Last Chance, become archive-eligible 14 days after the completed text sequence, and expose a compact “They replied” action that promotes the lead to Engaged with a reversible 40-point floor. Every text retains the tracked homepage link until the lead records a real visit, including leads promoted by a reply before clicking. Ready to Send remains unchanged. Backend + dashboard.
- **Text Outreach card actions now keep a consistent compact layout at every stage.** Archive, reply, and view controls share a fixed right-aligned icon group, while the primary action remains content-width and cannot push the icons through the card padding. Dashboard.

### Engaged outreach sequence

- **Engaged leads now progress through a tracked follow-up sequence without creating more Kanban columns.** The card action starts from score-based Ask for Feedback / Offer a Walkthrough / Call Now, advances from recorded text activity to Waiting for Reply → Send Final Follow-up → Call — Last Chance, becomes stale after 30 inactive days, and can then be archived with Undo restoring the original stale timestamp. Engaged can never show Nurture, card controls use compact icons, and the Site built chip opens the clean raw URL without outreach tracking. Backend + dashboard.

### Intent-based text outreach

- **Engaged follow-up now changes by the lead’s score instead of using one generic message.** Nurture (0–39) resurfaces the tracked demo link, Follow Up (40–69) asks what they liked or would change without repeating the link, Walkthrough (70–89) asks for a 10–15 minute conversation, and Hot (90–100) becomes a call-only action with the no-oriented opener and busy/free branches. Recommendations in Text Outreach and Lead Activity use the same four bands. Dashboard.

### Clarity export quota handling

- **Clarity exports no longer exhaust the project’s daily API quota or leave stale 429 warnings on individual leads.** Clarity enrichment now runs every four hours instead of piggybacking on the hourly DNS poll, leaving manual-sync headroom under the ten-call daily quota. Rate limits stay in Worker logs rather than being assigned to every lead, any successful export clears earlier project-wide errors even for leads without a current matching URL row, and a temporary per-lead suppression window keeps deleted operator test traffic from being re-imported while it ages out of Clarity’s rolling three-day export. Backend + migration (`2026-07-28-clarity-ignore-window.sql`, apply before deploy).

### Reliable outreach engagement scoring

- **Text Outreach sessions now come only from the app-owned tracked link instead of shared-project Clarity aggregates.** Fixes cross-client URL-metric leakage that could show impossible counts such as 100 sessions, gives the first verified text-link click a 40-point floor and immediate Engaged promotion, limits Clarity scoring to the matching URL row after that click, keeps every positive session dot green, and removes the retired Reset test activity UI and API. Backend + dashboard.

### DNS launch wiki

- **The Agency Wiki now documents the complete Cloudflare-to-landingsite domain launch.** The DNS page covers client-owned domain rules, information to collect, preserving MX/SPF/DKIM before delegation, the Agency OS setup flow, nameserver handoff, propagation and SSL verification, special cases, reusable registrar Looms, and a copy-ready client email template. Dashboard.

### Client Discovery workspace

- **Projects now have a dedicated Website Planning discovery workspace before Brief Studio.** Signed clients get the full autosaving 15–20 minute questionnaire; prospect projects can explicitly open the same workflow in test mode without changing lifecycle or MRR. Completing Discovery syncs durable facts into Project Info, closes the workspace, and refreshes Brief Studio; strategic answers and general notes remain Discovery context and feed Master Brief generation ahead of mined data. Later Discovery edits flag the current brief as stale. Backend + dashboard + migration (`2026-07-27-project-discovery.sql`, apply before deploy).

### Full Text Outreach test reset (PR #177)

- **Reset test activity now restores a built lead to its true pre-send baseline.** The control keeps the generated brief and saved site URL, clears Clarity scores, visits, sync history, and test outreach events, then moves the card back to Ready to Send. Backend + dashboard.

### Outreach history details and site signals (PR #176)

- **Lead Activity now reads like a real history instead of a raw event list.** Outreach trail rows show exact timestamps, saved demo URLs, generated brief context, and the message body for intro/follow-up texts when captured. Text Outreach and Call Outreach cards show a compact site-built signal, and Engaged cards compute the next-best action from sessions, recency, and Clarity score. Dashboard + local seed data.

### Engagement test reset for demo-site validation (PR #175)

- **Lead Detail now has a reset engagement control for safe Clarity testing.** The Activity tab can clear a lead's demo-site visit count, engagement score, reasons, and Clarity sync state without touching notes, call logs, the generated brief, or the site URL. Backend + dashboard.

### Clarity engagement scoring for demo sites (PR #174)

- **Clarity is now wired as the Text Outreach engagement intelligence layer.** Adds Clarity project config, per-lead install snippets in the demo-site brief, D1 engagement score fields, a manual/hourly Clarity sync service, dashboard hot-lead scoring, Text Outreach score badges, and Lead Detail Activity score reasons. Backend + dashboard + migration (`2026-07-27-clarity-engagement.sql`, apply before deploy).

### Phone routing automation and Lead Pipeline review queue (PR #173)

- **Phone routing now runs during enrichment and review numbers have a Lead Pipeline home.** Twilio classification is folded into enrichment without overwriting unchanged manual route overrides, Text Outreach loses the maintenance-style Classify phones button, Lead Pipeline gets a Phone Review toggle, and lead/table phone-route UI is more compact with hover details, refresh-icon recheck, condensed website badges, and smaller enrichment status icons. Backend + dashboard.

### Manual phone-route override for outreach boards (PR #172)

- **Operators can now override Twilio phone routing from the lead detail modal.** Adds a route override endpoint and lead-level controls to move a number between Text Outreach, Call Outreach, and Manual Review when Messenger or real-world deliverability disagrees with Twilio's line-type signal. Backend + dashboard.

### Twilio phone routing for outreach boards (PR #171)

- **Text Outreach and Call Outreach can now separate leads by phone type.** Adds Twilio Lookup phone classification, lead-level route fields, one-off and batch classification actions, and board/sidebar filtering so landlines move to Call Outreach while mobile and VoIP numbers stay in Text Outreach. Backend + dashboard.

### Lead notes separated from call logs (PR #170)

- **Lead detail now has real notes that do not mark a prospect contacted.** Adds a Notes tab and note-only save endpoint, plus Call Outreach cards now use the same `View lead` footer pattern as Text Outreach and no longer show an inline Not interested action. Backend + dashboard.

### Call outreach board + Text Outreach dashboard filters (PR #169)

- **Call Outreach now works as a lead Kanban board and the dashboard activity strip is range-filterable.** Replaces the old sessions-first call page with To Call / Retry / Waiting / Follow-Up Due columns, card actions that open the call execution center, a No Answer outcome, sidebar count and naming cleanup, plus a Text Outreach Activity strip with Last 7 days / Last 30 days / All time filters. Backend + dashboard.

### Dashboard KPI send-count consistency (PR #168)

- **[#168](https://github.com/shauncarldesigns/agency-os-v2/pull/168) Automated Pipeline activity cards count sent leads the same way as the funnel.** Intro text and follow-up activity stats now count distinct leads rather than raw action rows, keeping the activity card aligned with the sent-count math. Backend.

### Dashboard KPI weekend activity range (PR #167)

- **[#167](https://github.com/shauncarldesigns/agency-os-v2/pull/167) Automated Pipeline KPIs now count weekend sends and engagement.** The dashboard KPI endpoint was reusing the calling-week helper that intentionally snaps Sat/Sun forward, so Saturday intro texts and tracked visits appeared as zero. Text+site KPIs now use the current Monday-Sunday week while the calling dashboard keeps its existing behavior. Backend.

### Operator docs — offer foundation and monthly fulfillment (PR #166)

- **[#166](https://github.com/shauncarldesigns/agency-os-v2/pull/166) Operator Docs now reflect the public offer structure.** Adds Offer Overview, Foundation Month, and Monthly Fulfillment docs so the app distinguishes first-month setup (website, GBP, listings, reviews, initial content) from recurring fulfillment (GBP activity, review management, three local pages/month, listing maintenance, ranking reports, and support). Dashboard.

### Pipeline brief — page purpose is the business's, not the operator's (PR #165)

- **[#165](https://github.com/shauncarldesigns/agency-os-v2/pull/165) Briefs no longer frame the page around the outreach motion.** The system prompt framed the homepage as a sales artifact ("make the operator's follow-up text from Shaun feel like a gift"), and that leaked straight into generated briefs — Thomson's PAGE PURPOSE told landingsite the page exists to legitimize cold outreach. Reframed business-first: the page's job is to rank for the searches the business's customers type, establish it as a real reputable local company, and convert visitors into calls and form submissions. Explicit rule that the brief never mentions the agency, operator, outreach, demos, or pitches, plus PAGE PURPOSE section rules. Regenerate to pick up. Backend.

### Pipeline brief — schema type from company name, stray-review strip (PR #164)

- **[#164](https://github.com/shauncarldesigns/agency-os-v2/pull/164) Two fixes surfaced by live-testing #163.** Schema type inference now also reads the company name — Google categorized Thomson HEATING AND COOLING as `general_contractor`, so industry alone produced `GeneralContractor` where `HVACBusiness` is right. And when the model reproduces the review set under its own `CUSTOMER REVIEWS` header despite the prompt rule, the route now truncates the authored brief at that header before appending the real verbatim blocks, so reviews can't appear twice. Backend.

### Pipeline brief — SEO specifics + mined service areas (PR #163)

- **[#163](https://github.com/shauncarldesigns/agency-os-v2/pull/163) Pipeline briefs feed landingsite's SEO machinery directly.** New `SEO SPECIFICS (USE VERBATIM)` section: exact title tag, meta description, primary search phrase, Schema.org business type (mapped from the trade in code — Plumber, HVACBusiness, Electrician, RoofingContractor, GeneralContractor), and full area-served list. The review-mined `extracted_service_areas` towns are now passed into the brief (previously withheld entirely — landingsite only ever saw the home city) and feed the service-area section, areaServed schema, and nearby-community references. The verbatim contact block gains the lead's Google Maps listing URL (from `place_id`) as the schema `sameAs` citation link. FAQ guidance upgraded from topic-framing to real Q&A: definitive answers wherever data allows (hours, towns, services, owners), so FAQPage schema isn't thin "contact us" filler. Word cap 560 → 620. Regenerate to pick up. Backend.

### Pipeline brief — brief-authored hero copy (PR #162)

- **[#162](https://github.com/shauncarldesigns/agency-os-v2/pull/162) The brief now writes the hero headline itself.** Landingsite, left to generate its own hero, converged on the same trust-cliché formulas every time ("Honest HVAC Services You Can Trust", "Fair Prices, Real People"). Briefs now carry a `HERO COPY (USE VERBATIM)` section — an exact SEO-shaped H1 (primary services + town) and subhead the builder is told not to replace — written through one of 8 headline angles (service-catalog, customer-voice, numbers-led, owner-led, problem-first, area-led, specialty-led, question-led) assigned deterministically by lead id, so headlines vary across leads and stay stable per lead. Hero copy also gets hard phrase bans (honest, trust constructions, fair prices, real people, done right, etc.) plus a portability test: if the headline could sit on a competitor's site unchanged, rewrite it. Word cap 520 → 560. Regenerate a lead's brief to pick it up. Backend.

### Pipeline brief — assigned design directions (PR #161)

- **[#161](https://github.com/shauncarldesigns/agency-os-v2/pull/161) Each pipeline brief now carries a distinct visual direction.** Landingsite's builder, given no branding, converges on the same navy-professional template for every demo site. Briefs now include a `DESIGN DIRECTION` section — palette with exact hex codes, typography pairing, hero layout, and one signature element — assigned deterministically in code (seeded by lead id, from 10 palettes × 6 type pairings × 5 hero layouts × 8 signature elements), so a lead's look is stable across regenerates while neighboring leads look different. The prompt instructs landingsite to treat the direction as binding over its default industry styling and to add business-specific imagery notes. Word cap raised 450 → 520 to make room. Regenerate a lead's brief to pick it up. Backend.

### Pipeline brief — verbatim contact details (PR #160)

- **[#160](https://github.com/shauncarldesigns/agency-os-v2/pull/160) Pipeline briefs always carry exact contact details.** A generated brief could instruct landingsite to "include the phone number" without ever stating the digits (the model compressed the value it was given) — and since the brief is landingsite's only data source, the number was unusable. Briefs now get a server-side `CONTACT DETAILS (VERBATIM)` block (name, phone, address, parsed hours) appended between the authored brief and the reviews block, and the prompt requires contact details to be transcribed verbatim inline. Leads genuinely missing a value get an explicit "(none on file)" marker plus a rule to route contact through the form instead of demanding data we don't hold. Regenerate a lead's brief to pick it up. Backend.

### Pipeline brief — full review set on demand (PR #159)

- **[#159](https://github.com/shauncarldesigns/agency-os-v2/pull/159) Brief generation pulls the full review set.** Google Places caps stored reviews at 5; when a lead's Google listing shows more reviews than we hold, brief generation now backfills the full set (up to 50) via Outscraper — in parallel with the Claude call, so typical latency stays ~10s and worst case ~2 min. The refreshed set persists to the lead (`google_reviews` + `reviews_fetched_at`), so the Quick Brief and Reviews tab benefit too. Any Outscraper failure falls back to the stored set without blocking the brief. Modal spinner copy notes the possible longer wait. Backend + dashboard.

### Pipeline brief — Quick Brief review format (PR #158)

- **[#158](https://github.com/shauncarldesigns/agency-os-v2/pull/158) Pipeline brief reviews adopt the Quick Brief block format.** The `CUSTOMER REVIEWS (VERBATIM)` section appended to Automated Pipeline briefs now renders each review as its own block — author line, `5★ · 3 months ago` meta line, full text — matching the Sites tab's Quick Brief (the format already proven with landingsite same-day demos) instead of a dense numbered one-line dump. Both brief flows now feed landingsite identically-shaped review content. Regenerate a lead's brief to pick it up. Backend.

### Brief modal — actions on top (PR #157)

- **[#157](https://github.com/shauncarldesigns/agency-os-v2/pull/157) Site brief modal: Copy + Regenerate moved above the brief.** The action row now sits directly under the modal header instead of below the (often long) brief text, so no scrolling is needed to copy. Dashboard.

### Funnel strip cleanup (PR #156)

- **[#156](https://github.com/shauncarldesigns/agency-os-v2/pull/156) Funnel strip: single tracked send path, honest zero-state, reply metric dropped.** The SMS composers lose their Copy button — "Open in Messages" is now the only send action, so every send is recorded and the funnel can't go blind to copy-paste sends. Rate tiles that previously said "Not tracked" when nothing was sent now say "None sent" (they were always wired; the denominator was zero). Reply-per-tap is removed everywhere (funnel strip, hero tile, channel cards, backend response, types) by operator decision — replies land on the operator's personal phone via the `sms:` channel and aren't worth logging manually. Also pins the grid-card footer to the card bottom. Backend + dashboard.

### Dashboard production deploy guard (PR #155)

- **[#155](https://github.com/shauncarldesigns/agency-os-v2/pull/155) Dashboard deploy now blocks missing or localhost production env.** Adds a predeploy check so manual Pages deploys fail before upload if `.env.production` is absent or points the API/tracking URLs at localhost, preventing production bundles from losing live data again. Dashboard.

### Operator docs workflow expansion (PR #154)

- **[#154](https://github.com/shauncarldesigns/agency-os-v2/pull/154) Operator Docs now cover tracking, onboarding, pre-sale QA, and SEO growth.** Adds wiki pages for GA4/GTM/conversion setup, demo-site cleanup before prospects see a build, new-client onboarding access and baseline audits, and monthly SEO content/authority work. Dashboard.

### Dashboard load + site count fix (PR #153)

- **[#153](https://github.com/shauncarldesigns/agency-os-v2/pull/153) Dashboard redeployed with production API env and site-created count aligned to the send queue.** Fixes a bad dashboard deploy that embedded `localhost:8788` as the API base, and changes the Automated Pipeline "Sites created" KPI to count active built sites (`site_url` present in the live automated queue) instead of only current-week URL-save events. Backend + dashboard.

### Operator docs tab (PR #152)

- **[#152](https://github.com/shauncarldesigns/agency-os-v2/pull/152) Dashboard gains an Operator Docs wiki.** Adds a new Docs tab with searchable checklist pages for after-launch client work, project lifecycle movement, DNS setup, Brief Studio, weekly calling, and monthly client review. Dashboard.

### Worker API route restore (PR #151)

- **[#151](https://github.com/shauncarldesigns/agency-os-v2/pull/151) Dashboard API hostname restored after clean tracking domain launch.** Keeps `try.shauncarldesigns.com` as the clean tracking custom domain while explicitly leaving the original `workers.dev` API route enabled via `workers_dev = true`, so existing dashboard builds can continue calling the API hostname. Backend.

### Clean Automated Pipeline tracking URL (PR #150)

- **[#150](https://github.com/shauncarldesigns/agency-os-v2/pull/150) Automated Pipeline texts now use a clean tracking domain.** Adds `try.shauncarldesigns.com` as a Worker custom domain and introduces `VITE_TRACKING_URL` so SMS composers text `https://try.shauncarldesigns.com/r/{leadId}` instead of the long `workers.dev` API hostname. The API URL stays separate. Backend + dashboard.

### Automated Pipeline activity KPIs (PR #149)

- **[#149](https://github.com/shauncarldesigns/agency-os-v2/pull/149) Dashboard now shows concrete Automated Pipeline activity counts.** Adds a second KPI row under the headline cards with real week-scoped counts for sites created (`url_saved`), intro texts sent (`intro_sent`), follow-ups sent (`followed_up`), and engaged leads / total visits (`click_tracked`), each with previous-week deltas. Backend + dashboard.

### Automated Pipeline demo booking bridge (PR #148)

- **[#148](https://github.com/shauncarldesigns/agency-os-v2/pull/148) Automated Pipeline can book demos into Sites.** Adds a `Book demo` path to the engaged Call Prep modal and a fallback `Book demo` button in the automated lead-detail modal header. Both reuse the existing tier picker / qualify flow to create a Sites prospect project, link `lead.project_id`, navigate to Sites, and mark the automated `pipeline_status` as `booked`. The automated queue now excludes `booked` / `archived`, so prospects and clients leave the active Kanban once they move into Sites. Backend + dashboard.

### Dashboard KPIs (PR #147)

- **[#147](https://github.com/shauncarldesigns/agency-os-v2/pull/147) Dashboard becomes a KPI-first pipeline view.** Replaces the empty Dashboard placeholder with a real KPI surface for the text + site funnel: Hot leads ready to call, this week's reply-rate slot, meetings booked this week, active leads in pipeline, funnel strip (tap rate / engagement rate / reply per tap / book rate), channel split, and a Needs action list sorted by recent tracked engagement. Adds `/api/dashboard/pipeline-kpis` so the page reads real app data from `lead_activity`, `leads`, and `demos`; reply rate and Facebook channel show as not tracked until the app logs those first-class events. Backend + dashboard.

### Five-star rating strips (PR #146)

- **[#146](https://github.com/shauncarldesigns/agency-os-v2/pull/146) Real star strips on pipeline cards.** The lone ★ glyph is replaced by a five-star strip with fractional fill (4.6 renders four full stars and a 60%-filled fifth) on the Automated Pipeline's grid cards, board cards, and the shared lead-detail modal header. New `components/shared/StarRating.tsx`. Dashboard.

### Call Sessions absorbs the Dashboard (PR #145)

- **[#145](https://github.com/shauncarldesigns/agency-os-v2/pull/145) Everything from the Dashboard moved into Call Sessions; Dashboard emptied.** The Call Sessions tab now opens with the full operating view (today's sessions + Generate week, Hot Leads, prospecting block, agency summary, objections overview) and flows into a new "Session history" section with the week-paginated past/present/upcoming browser. The Dashboard tab shows a placeholder — intentionally reserved for a future feature. Dashboard.

### Automated Pipeline Kanban board (PR #144)

- **[#144](https://github.com/shauncarldesigns/agency-os-v2/pull/144) Kanban board view with guarded drag-and-drop.** A Grid/Board toggle (persisted) next to the search bar switches the Automated Pipeline to a four-column board — Awaiting build / Ready to send / Sent — no reply / Engaged — with stage icons, live counts, and compact draggable cards that keep the stage action + View lead one tap away. Drops are real status changes routed through the same guarded transitions as the buttons: dropping into Ready to send opens the Site brief modal (the move requires a live URL), dropping into Sent marks the intro sent with the 6s Undo pill, Engaged explains it flips automatically on a tracked-link click, and backwards moves point at Undo. Search applies in both views; status filter pills only show in grid (the board's columns are the statuses). Dashboard.

### Collapsible sidebar (PR #143)

- **[#143](https://github.com/shauncarldesigns/agency-os-v2/pull/143) Sidebar collapses to an icon rail.** A panel toggle in the top bar (desktop only — the mobile drawer is unchanged) animates the sidebar between the full 256px layout and a 68px icon-only rail: centered icons with hover tooltips, count badges pinned to the icon corner, section dividers instead of labels, brand mark only, avatar-only footer. Choice persists in localStorage across reloads. Dashboard.

### Mobile responsiveness (PR #142)

- **[#142](https://github.com/shauncarldesigns/agency-os-v2/pull/142) Fluid cards + no horizontal overflow on any screen.** The Automated Pipeline / Call Sessions / Playbook analytics card grids lacked a base column definition, so the implicit grid track inherited the widest card's min-content and dragged every card past small viewports — fixed with explicit `grid-cols-1` (`minmax(0,1fr)`), letting card labels truncate as designed. Card rating chips now wrap as a unit instead of splitting the star from the number. Legacy panels fixed centrally: lead tables and the stage funnel scroll horizontally inside their own rounded wrapper instead of stretching the page, the Clients & Sites grid collapses its 360px column floor on narrow screens, section-header action rows wrap, stat tiles can shrink, and the Lead Finder search form stacks below 640px. Verified at 375×812: every page reports zero horizontal overflow; desktop layouts unchanged. Dashboard.

### Automated-context modal polish + SMS name fix (PR #141)

- **[#141](https://github.com/shauncarldesigns/agency-os-v2/pull/141) Lead-detail modal tuned per context + SMS composer name fix.** In the Automated Pipeline context only: the Overview returns to the pipeline card's icon rows (regular-font phone, hours), the address row itself is now the Google Maps link (replacing the big green listing card), the Outcome/Stage/Tier selects are hidden, and the footer's Close button is replaced by the Activity summary card (last action + site sessions — the header ✕ closes). Cold Call Pipeline context is unchanged (selects, Maps card, Close + Book demo). Also fixes the SMS composers greeting leads with `["Chad` — `owner_names` holds a JSON array string and the first-name derivation now parses it properly. Dashboard.

### Shared lead-detail modal (PR #140)

- **[#140](https://github.com/shauncarldesigns/agency-os-v2/pull/140) One lead-detail modal for both pipelines.** Merges the Cold Call Pipeline's rich LeadModal (Overview / Reviews / Pitch Prep / Call Log tabs, Google Maps card, tier + opportunity-score banner, outcome/stage/tier editors, Book demo) into the Automated Pipeline's Tailwind visual language as `components/shared/LeadDetailModal.tsx`, and uses it from both entry points: Cold Call Pipeline row click, and Automated Pipeline "View lead". The automated context adds an Activity tab (pipeline status, site sessions, live-site link, outreach trail). Old `pipeline/LeadModal.tsx` deleted. Dashboard.

### Pipeline brief — verbatim reviews appended (PR #139)

- **[#139](https://github.com/shauncarldesigns/agency-os-v2/pull/139) Pipeline brief now carries the full mined review set verbatim.** After Claude authors the brief, the Worker appends a `CUSTOMER REVIEWS (VERBATIM)` block built straight from `leads.google_reviews` (Google's 5 + Outscraper's backfill up to 50) — numbered, with rating, exact unedited text, author, and recency; rating-only reviews skipped. Deliberately not routed through Claude so landingsite gets exact content with zero paraphrase risk. The prompt now instructs the authored sections to point the builder at the appended block instead of quoting piecemeal. Regenerate a lead's brief to pick it up. Backend.

### Brief modal — copyable business name (PR #138)

- **[#138](https://github.com/shauncarldesigns/agency-os-v2/pull/138) Copy button on the Site brief modal's business name.** landingsite asks for the business name in a field separate from the brief, so the modal header's subtitle now has a small copy icon next to the name — one click copies it, flips to a checkmark briefly. Dashboard.

### Design-language unification (PR #137)

- **[#137](https://github.com/shauncarldesigns/agency-os-v2/pull/137) Whole app now speaks the Automated Pipeline's Tailwind design language.** The legacy stylesheet's component classes were restyled to match the pipeline page exactly: blue→indigo gradient primary buttons with soft glow, borderless soft-fill secondary/ghost buttons, rounded-2xl cards with `shadow-slate-200`-style soft shadows, blue focus rings on all inputs, white pill toasts, softened modals, radii bumped to the 12/16px scale. Dead top-nav/header classes deleted. Every legacy panel (Dashboard, Cold Call Pipeline, Sites, Reports, Lead Finder, modals) picks the language up with zero JSX changes; per-panel Tailwind-utility conversion continues as cleanup. Dashboard.

### Pipeline brief — suggested sections (PR #136)

- **[#136](https://github.com/shauncarldesigns/agency-os-v2/pull/136) Pipeline brief gains a SUGGESTED SECTIONS block.** The Automated Pipeline's landingsite brief now includes a suggested page layout — Hero, Services, About, Reviews, Service area with map, Contact form, FAQs — explicitly framed as guidance landingsite may adapt, not a mandate. Each section gets one line tailored from the lead's enrichment (Reviews cites the actual rating/count, Service area anchors on the business's city, FAQs frame topics without inventing answers). Backend.

### Sidebar shell + light theme (PR #134)

- **[#134](https://github.com/shauncarldesigns/agency-os-v2/pull/134) Phase 3 — sidebar shell + site-wide light theme.** Dark mode is gone. New fixed sidebar layout (AppShell, per the design mockup) with grouped nav, live count badges, mobile drawer, and per-page top bar; old dark Header/Nav deleted. The entire app rethemes to the light slate/blue-indigo palette via a token flip in `global.css` — every legacy panel keeps its functionality and goes light at once (full Tailwind migration continues in follow-ups). Two new pages: **Call Sessions** (week-paginated past/present/upcoming session browser; Dashboard stays today-focused) and **Playbook** (read-only Scripts / Objections / Follow-ups browser + objection Analytics). ExecutionView now renders inside the shell with the sidebar visible instead of taking over the screen. Prospect renamed Lead Finder. Dashboard.

### Automated Pipeline — styling cleanup (PR #132)

- **[#132](https://github.com/shauncarldesigns/agency-os-v2/pull/132) Automated Pipeline styling — 3-col grid + drop button borders.** Lays cards out three-across on desktop (`sm:grid-cols-2 lg:grid-cols-3`, `max-w-6xl` container) instead of a single centered column. Secondary buttons across the panel — filter pills, composer Copy buttons, BriefModal Copy + Regenerate, Undo pill, retry buttons — swap the outline-white style for a soft `bg-slate-100` fill so the queue reads cleaner without hard hairline edges. Dashboard.

### Automated Pipeline — on-demand brief generation (PR #131)

- **[#131](https://github.com/shauncarldesigns/agency-os-v2/pull/131) Automated Pipeline — on-demand brief generation.** Fixes the placeholder text in the Copy Brief modal. `POST /api/pipeline/leads/:id/brief` now calls Claude Haiku 4.5 with a new landingsite-ready prompt (`prompts/pipelineBrief.ts`) that grounds every claim in the enrichment data, applies the shared anti-fluff word list, and emits fixed section headers (BUSINESS OVERVIEW / TARGET AUDIENCE / PAGE PURPOSE / WHAT MUST APPEAR / WHAT TO EMPHASIZE / CONSTRAINTS). Result caches on `leads.pipeline_brief` and writes a `brief_generated` activity row; `{ regenerate: true }` forces a fresh gen. BriefModal auto-fires generation on open (spinner + inline retry on error) and gains a Regenerate icon button next to Copy. Backend + dashboard.

### Automated Pipeline — Phase 2 (PR #130)

- **[#130](https://github.com/shauncarldesigns/agency-os-v2/pull/130) Automated Pipeline — D1, Worker endpoints, click tracker, real data.** Turns the Automated Pipeline into a live view over the existing `leads` table. Migration adds `pipeline_status` + `site_url` + `pipeline_brief` + related columns to `leads` and a `lead_activity` audit table. New `/api/pipeline/*` endpoints handle list / detail / site-url save (UTM-tag + status flip) / outreach actions / undo. Public `GET /r/:lead_id` click tracker bumps `pipeline_sessions`, promotes `sent_no_reply → engaged` on first click, and 302s to the tagged URL — the intro/follow-up composers now text `${API_BASE}/r/{lead.id}` so every recipient click hits Layer 1 tracking. Frontend swaps sample data for the fetch, adds loading / error states, and shows a ~6s Undo pill after each optimistic transition. Backend + dashboard + migration (`2026-07-19-lead-pipeline.sql`, apply after merge).

### Automated Pipeline — Phase 1 (PR #129)

- **[#129](https://github.com/shauncarldesigns/agency-os-v2/pull/129) Automated Pipeline page (Phase 1) — text + site outreach queue.** Adds a new dashboard tab for the text + site outreach motion (brief → live URL paste → SMS-deep-link intro → engagement-aware follow-up → call prep). Ships against sample data so the whole flow — including `sms:` composer prefill on a real device — can be validated before the backend lands. Existing pipeline renamed to Cold Call Pipeline; the two motions stay separate. Introduces `tailwindcss` (v3, `preflight: false`) and `lucide-react`; the new page renders inside a `.pipeline-scope` wrapper so the existing dark panels stay untouched. Dashboard.

### Quick-oriented call approach (PR #121)

- **[#121](https://github.com/shauncarldesigns/agency-os-v2/pull/121) Quick-oriented call approach + narrow objection tray.** Adds a third cockpit approach chip (`Quick-oriented`) alongside No-oriented and Question-oriented. The new script follows the fast reputation-gap flow: strong reviews → limited proof beyond reviews → reputation-match check → demo-site reveal → ten-minute ask. While Quick-oriented is active, the objection panel narrows to six purpose-built chips: I'm busy, Too busy, Already have Facebook, Why do I need a website, Word of mouth, and Pushback. Backend + dashboard.
- **[#122](https://github.com/shauncarldesigns/agency-os-v2/pull/122) Quick-oriented Cost objection.** Adds a `Cost` chip to the Quick-oriented objection tray with a grounded under-a-grand option range, then redirects back to the ten-minute demo before detailed pricing. Backend + dashboard.
- **[#123](https://github.com/shauncarldesigns/agency-os-v2/pull/123) Quick-oriented Close stage.** Adds a `Close` stage between Demo ask and Confirm with the "worst case, tell me to go pound sand" same-day scheduling close. Backend playbook content.
- **[#124](https://github.com/shauncarldesigns/agency-os-v2/pull/124) Quick-oriented rebuttal reveal path.** Adds a right-side `Website calls` chip for "I get these calls all the time" and a left-side optional `Reveal - Rebuttal` stage between Demo reveal and Demo ask, keeping the skeptical-call reveal out of the objection tray. Backend + dashboard.
- **[#125](https://github.com/shauncarldesigns/agency-os-v2/pull/125) Cockpit notes beside active rebuttal.** Moves Notes into a side-by-side row with the active rebuttal on desktop, keeps Notes full-width when no rebuttal is open, and stacks cleanly on smaller screens. Dashboard.
- **[#126](https://github.com/shauncarldesigns/agency-os-v2/pull/126) Move Quick-oriented Reveal - Rebuttal earlier.** Reorders the left-side Quick-oriented chip row so `Reveal - Rebuttal` sits between Gap and Check. Backend playbook content.
- **[#127](https://github.com/shauncarldesigns/agency-os-v2/pull/127) Remove Quick-oriented Demo ask chip.** Drops the separate Demo ask stage from the Quick-oriented left-side flow so Reveal and Reveal - Rebuttal advance directly to Close. Backend playbook content.
- **[#128](https://github.com/shauncarldesigns/agency-os-v2/pull/128) Combine Quick-oriented Gap and Check chips.** Folds the reputation-match question into the Gap card and removes the separate Check chip so the quick flow moves straight from combined Gap to Reveal - Rebuttal / Reveal. Backend playbook content.

### Question-oriented call approach — Phase 1 (PR #112)

- **[#112](https://github.com/shauncarldesigns/agency-os-v2/pull/112) Cold-call cockpit approach selector + Question-oriented skeleton.** Adds a persistent two-chip switcher (`APPROACH: No-oriented / Question-oriented`) above the script panel; choice persists in `localStorage` under `agency-os-call-approach`. Selecting Question-oriented swaps the linear script panel for a discovery-first `QuestionOrientedPanel` — permission → lead-source → dynamic qualification (5 variants routed by the operator's lead-source pick) → impact → desired-outcome → solution reveal → demo ask, with tappable answer chips per stage that auto-tag `[QUESTION: Stage] → Answer` into the notes. Objection panel filters out website-specific chips (word-of-mouth, cant-afford, why-need-website, etc.) until the reveal stage; ✨ Generate alternative is hidden pre-reveal to prevent the LLM from leaking website mentions. No-oriented flow untouched — remains the default. Deferred to PR 2: problem-discovery branches + Discovery Summary card. New markdown: `cold-call-question-oriented.md`, `why-are-you-asking.md`, `early-not-interested.md`. Extends `Stage` with optional `answers[]` and `reveal_solution` fields.

### Demo interest level (PR #111)

- **[#111](https://github.com/shauncarldesigns/agency-os-v2/pull/111) Demo booking interest-level picker + surface.** Adds a required Hot / Warm / Cold pick to BookingPane so the operator's read of the prospect at booking time is recorded. 🔥 / ☀️ / ❄️ icons render next to the company name on the Priority Strip demo cards (Awaiting Status, No-Show Recovery, Demos Today) so temperature is visible before dialing the demo. The temperature is also prepended onto the linked call_log notes (e.g. `🔥 Hot interest`) so it persists in the LeadModal CallLogTab. Backend + dashboard + migration (`2026-07-02-demos-interest-level.sql`, apply after merge).

### Practice reference docs + polish (PRs #106–#108)

- **[#108](https://github.com/shauncarldesigns/agency-os-v2/pull/108) Update `practice-demo-calls.md` to latest operator-authored version.** Adds domain check flow, Google-landscape education, 5-point walkthrough with FAQ→AI hook, beefier Growth pitch (62 directories + monthly ranking reports + ChatGPT/Gemini). No app change.
- **[#107](https://github.com/shauncarldesigns/agency-os-v2/pull/107) Add `docs/practice-demo-calls.md` reference doc.** Full-flow demo call script for Claude chat practice sessions. Sibling to practice-cold-calls.md.
- **[#106](https://github.com/shauncarldesigns/agency-os-v2/pull/106) Add `docs/practice-cold-calls.md` reference doc.** Human/AI-readable snapshot of the live cold-call playbook — every stage, every objection chip, every variant, both demo scripts, email follow-up, and quick-reference table. Not parsed by the app.

### Dashboard — voicemail visibility (PR #105)

- **[#105](https://github.com/shauncarldesigns/agency-os-v2/pull/105) Voicemails to redial priority strip + stuck-status cleanup.** Sixth section on the dashboard Priority Strip alongside demos-awaiting / no-show / demos-today / callbacks-due. Query: leads with `outcome='Voicemail Left'`, `last_called_at` within 14 days, `status IN ('cold','contacted')`, ordered oldest-first. Badge flips gray→yellow at 7+ days. Also included: one-shot data cleanup of leads stuck at `status='cold'` with an outcome recorded. Backend + dashboard.

### Playbook content churn (PRs #103–#104)

- **[#104](https://github.com/shauncarldesigns/agency-os-v2/pull/104) Replace Not-tech-savvy standard chip with Too Busy (simple).** Standard-panel version of the seasonal-slowdown play — one-shot tap for a quick redirect. Deep Dive's `Too busy ↗` branching chip is the escalation path.
- **[#103](https://github.com/shauncarldesigns/agency-os-v2/pull/103) Swap Word-of-mouth rebuttal.** New copy: referral-hesitation reframe ("the next thing that person does is Google you").
- **[#102](https://github.com/shauncarldesigns/agency-os-v2/pull/102) Add "Busy + referrals" variant to Why-need-website-direct.** Fourth angle pill — late-game synthesis pivot when the operator's heard both busy + word-of-mouth.

### Playbook content — Angry Disarm restructure (PRs #97–#101)

- **[#101](https://github.com/shauncarldesigns/agency-os-v2/pull/101) Add Total Brush-Off chip (last-resort simple objection).** Recycles the "getting hammered with these calls" rebuttal removed from angry-disarm Path B. Deep Dive, order 5. Note flags mouthy tone.
- **[#100](https://github.com/shauncarldesigns/agency-os-v2/pull/100) Swap Angry Disarm Path B rebuttal.** Replaces the cold-calls reframe with the seasonal-slowdown play ("busy season now → quiet phone in 4 months").
- **[#99](https://github.com/shauncarldesigns/agency-os-v2/pull/99) Add Quick Fire variant to Why-need-website-direct.** Third angle pill — scannable list of 7 short benefit one-liners for rapid-fire delivery.
- **[#98](https://github.com/shauncarldesigns/agency-os-v2/pull/98) Move Angry Disarm from script-branch to deep-dive branching objection.** Same content, better surface — chip in objection panel (order 0) with 3 paths (Built it? / Don't need it / Not worth time).
- **[#97](https://github.com/shauncarldesigns/agency-os-v2/pull/97) Cherry-pick angry-disarm + narrow-time stages from ChatGPT-generated draft.** Two net-new stages + "never argue a stated fact" addendum on Hook note.

### Playbook content (PRs #91–#95)

- **[#95](https://github.com/shauncarldesigns/agency-os-v2/pull/95) Cold-call script restructure.** Dropped label/mirror/label-2 (never used), split close into three angles (Pound Sand / Walk Away With Ideas / Add To What You Built), reordered so terrible-time + not-interested sit right after Intro.
- **[#94](https://github.com/shauncarldesigns/agency-os-v2/pull/94) Add Busy → Demo redirect stage (branch).** Aggressive close for "I'm heading into back-to-back" — skip callback, go straight to demo invite with binary time.
- **[#93](https://github.com/shauncarldesigns/agency-os-v2/pull/93) Add Pushback stage (branch).** For "you built me a website?" energy.
- **[#92](https://github.com/shauncarldesigns/agency-os-v2/pull/92) Brief Studio inline-editable Client card.** Owner / Phone / Email always visible + click-to-edit. Prefills from linked lead when project field is empty.
- **[#91](https://github.com/shauncarldesigns/agency-os-v2/pull/91) Add seasonal-slowdown path to Too busy.** Turns "you're busy right now" into the seasonal-slowdown anxiety play. Fifth path.

### Cockpit UX + branch stages (PRs #88–#90)

- **[#90](https://github.com/shauncarldesigns/agency-os-v2/pull/90) Fix render branch stages in cockpit breadcrumb.** Previously the cockpit filtered branch:true stages OUT of the breadcrumb — they were silently invisible. Now renders every stage; branches get dashed border + italic. Fixes visibility of `Cost`, `Pushback`, `Hesitate`, `Terrible time`, `Not interested`.
- **[#89](https://github.com/shauncarldesigns/agency-os-v2/pull/89) Add Cost stage (branch).** For "how much does this cost?" — deflect until after demo.
- **[#88](https://github.com/shauncarldesigns/agency-os-v2/pull/88) Fix drop reveal stage + surface playbook parse errors usefully.** Removes stale `reveal` stage reference. Adds Hono `onError` handler so parser failures return the actual error message + broken file instead of a generic 500.

### Playbook content (PRs #78–#80)

- **[#80](https://github.com/shauncarldesigns/agency-os-v2/pull/80) Fix register why-need-website + why-need-website-direct in OBJECTION_FILES.** PR #79 added the files but forgot the explicit imports in `services/playbook.ts`. Wrangler Text-rule only bundles imported markdown, so the chips didn't appear until this fix.
- **[#79](https://github.com/shauncarldesigns/agency-os-v2/pull/79) SimpleObjection variants mechanism + review-count tokens + Why-need-website objections.** New variants[] array on simple objections renders as a chip row (`[Default] [Variant Label]`). New interpolation tokens `[review_count]`, `[review_avg]`, `[reviews]`. Two new objections: `why-need-website` (branching, 3 paths) + `why-need-website-direct` (simple with 2 initial variants). ExecutionView populates `scores.reviews` from `lead.google_review_count + rating` for the tokens to resolve.
- **[#78](https://github.com/shauncarldesigns/agency-os-v2/pull/78) Playbook: tighten Intro + Hook lines on cold-call script.** New Intro: "help them get found on Google." New Hook: neutral "is that something you are working on?" replaces the leading-question framing.

### Cockpit polish (PRs #81–#84)

- **[#84](https://github.com/shauncarldesigns/agency-os-v2/pull/84) BookingPane: revert contact/email to read-only CopyField.** Cockpit header already handles inline edit; BookingPane just displays copy-to-clipboard chips.
- **[#83](https://github.com/shauncarldesigns/agency-os-v2/pull/83) Cockpit header: fix wrapped phone + orphan score gap.** Grid columns re-sized to auto so scores hug the right edge; phone hero pinned to content width with white-space: nowrap.
- **[#82](https://github.com/shauncarldesigns/agency-os-v2/pull/82) Cockpit: row layout for owner/email + prefill from enrichment.** Phone hero + Owner + Email flow horizontally to the right of the phone. Owner prefills from `owner_names` mined during enrichment (faded italic + "from reviews" hint).
- **[#81](https://github.com/shauncarldesigns/agency-os-v2/pull/81) Inline-editable owner + email on cockpit header + BookingPane.** New `InlineEditField` shared component. Click-to-edit, autofocus, commits on blur/Enter, cancels on Escape.

### Call Recordings (PRs #85–#87)

- **[#87](https://github.com/shauncarldesigns/agency-os-v2/pull/87) Orphan recording recovery.** `GET /api/leads/:id/recordings` lists every R2 object under `calls/{leadId}/` prefix and marks which are already attached to a call_log row. `POST /api/leads/:id/recordings/attach` creates a placeholder call_log row for orphans. CallLogTab renders yellow "orphan recordings" block with "Save to call log" button.
- **[#86](https://github.com/shauncarldesigns/agency-os-v2/pull/86) Recordings always create a call_log row + merge with outcome.** `/api/recordings` now INSERTs a placeholder call_log row (`outcome='Recording'`) immediately after R2 upload succeeds. If the operator then submits an outcome, the outcome handler UPDATEs that row instead of creating a duplicate. Recordings never orphan.
- **[#85](https://github.com/shauncarldesigns/agency-os-v2/pull/85) Call recordings — MediaRecorder + R2 + cockpit Record button.** New R2 bucket `agency-os-recordings` (public). Cockpit utility row gets a Record button with 4 states (idle / recording / uploading / done). MediaRecorder API + getUserMedia. Recordings saved at `calls/{leadId}/{ts}-{rand}.webm`. Timer rebases to record-start. Lead modal shows "🎙 Play recording ↗" link on any call_log entry with a URL.

### Week Planner + Hot Leads (PRs #76–#77)

- **[#77](https://github.com/shauncarldesigns/agency-os-v2/pull/77) Hot leads — operator-curated priority queue.** Pipeline bulk action button "🔥 Add to hot leads (N)". Backend lazily creates a single hot session (sentinel `session_date='hot'`, `block='hot'`, `kind='hot'`) and appends leads as session_leads rows. Loosens active-session lock to per-kind so hot + one auto session can coexist. New Hot Leads card above the WeekPlanner on the dashboard.
- **[#76](https://github.com/shauncarldesigns/agency-os-v2/pull/76) Week planner — unified weekly sessions view.** Replaces the day-of-week-routed sessions grid. "Working Now" banner surfaces active session regardless of date (fixes stuck-Tuesday-on-Wednesday bug). Session cards show per-outcome progress via `GET /api/sessions/week` aggregates. Drops the calling / prep / review / quiet mode routing.

### Docs refresh (PRs #74–#75)

- **[#75](https://github.com/shauncarldesigns/agency-os-v2/pull/75) Cockpit token interpolation on scripts + rebuttals.** Fix: cockpit was rendering `[Company Name]` and other tokens literally instead of interpolating them. Client-side `interpolate()` mirrors backend. `tradeLabel()` normalizes Google Places `primaryType` for the `[their trade]` slot.
- **[#74](https://github.com/shauncarldesigns/agency-os-v2/pull/74) Docs sync after playbook system shipped (#67-#73).** Refreshed CHANGELOG, CLAUDE.md, HANDOFF.md.

## 2026-06

### Playbook system — Chris Voss sales cockpit (6 PRs)

Converts the calling exec view from a static lead viewer into an active sales playbook. Markdown-authored scripts + objection rebuttals, branching diagnostics, Claude-generated alternative rebuttals when stock doesn't land, full auto-logging of objection hits, and an analytics layer on the dashboard for frequency + handled-rate per objection.

- **[#73](https://github.com/shauncarldesigns/agency-os-v2/pull/73) Dashboard analytics — agency summary + objections overview (Phase 5).** New `/api/dashboard/agency-summary` + `/api/dashboard/objections-overview` endpoints. Always-on analytics section at the bottom of the dashboard: 4 metric cards (Calls/day, Dial→Set %, Demos held, New projects) + objections grid with frequency bars + handled-rate %, color-graded with a red "rewrite this" CTA for any objection at <30% handled-rate with 5+ hits. Range toggle Last-30-days / All-time. Backend + dashboard.
- **[#72](https://github.com/shauncarldesigns/agency-os-v2/pull/72) Calling cockpit UI — playbook integration (Phase 4b).** Full rewrite of `ExecutionView.tsx` from the Brief-Studio-styled layout to the spec's cockpit: lead header / script panel / objection panel / notes / outcome bar. Tap an objection chip → auto-tags `[MM:SS · OBJECTION: ...]` to notes, opens the rebuttal card. Branching objections (Too busy, Send email) show diagnostic prompt + 3-card path picker. ✨ Generate alternative wires through Phase 3 to surface 3 Claude variants; Use this swaps the variant in. Pitch card / Log-a-Call form / sidebar Scores+Signals+Prior-Calls dropped — replaced by the script panel + objection chips + notes auto-tag. Dashboard.
- **[#71](https://github.com/shauncarldesigns/agency-os-v2/pull/71) Playbook API client + objection_hits column (Phase 4a).** Plumbing for the cockpit UI. Backend: `call_log.objection_hits` JSON column (migration `2026-06-17-call-log-objection-hits.sql`); `/api/leads/:id/calls` and `/api/sessions/:id/outcome` now accept + persist objection hit arrays. Dashboard: `lib/playbook.ts` types, `api.playbook.*` namespace, `usePlaybook()` hook (module-cached lazy loader for scripts + objections). Backend + dashboard.
- **[#70](https://github.com/shauncarldesigns/agency-os-v2/pull/70) Playbook generate-rebuttal endpoint + log table (Phase 3).** `POST /api/playbook/generate-rebuttal` — Claude Haiku 4.5, JSON-shape-validated, 3 variants per call. `POST /api/playbook/generations/:id/mark-used` — operator's "Use this" choice. New `playbook_generations` table logs every call including failures (migration `2026-06-17-playbook-generations.sql`). Prompt in `prompts/rebuttalGen.ts` is verbatim the spec: Chris Voss method, first-person singular, Wisconsin contractor voice, tactical empathy. Backend.
- **[#69](https://github.com/shauncarldesigns/agency-os-v2/pull/69) Playbook runtime + read endpoints (Phase 2).** `services/playbook.ts` parser (frontmatter splitter + `yaml.parse` + section splitter for `## Stage:` / `## Path:` / `## Touch:` headers) with lazy module-cached loaders. Public API: `getScript / listScripts / getObjection / listObjections / listObjectionsByCategory / getFollowUp / interpolate / renderStage / renderRebuttal` (token interpolation supports `[Company Name]`, `[Name]`, `[city]`, `[state]`, `[their trade]`). Read endpoints at `/api/playbook/{_debug,scripts,scripts/:id,objections,objections/:id,follow-ups/:id}`. Wrangler bundles the markdown as Text via `[[rules]]` (Workers have no fs). Bundle 240→527 KiB. Backend.
- **[#68](https://github.com/shauncarldesigns/agency-os-v2/pull/68) Playbook content seed (Phase 1).** 13 markdown files under `agency-os-backend/src/playbook/`: 3 scripts (cold-call-no-oriented, demo-tier3-primary, demo-tier2-primary), 6 simple objections (word-of-mouth, facebook-page, cant-afford, bad-experience, not-tech-savvy, talk-to-partner), 2 branching objections (too-busy with 4 paths, send-email with 3 paths), 1 combo (busy-plus-email), 1 follow-up sequence (email day 2/5/14). Zero risk — pure content, nothing imported yet. Backend.

### Other

- **[#67](https://github.com/shauncarldesigns/agency-os-v2/pull/67) Bump global type size + body weight for readability.** `html{font-size:18px}` (+12.5% across all rem-based UI) + body `font-weight:500`. Operator reported difficulty reading at prior sizes. Dashboard.

### Calling Dashboard — post-launch operator-feedback iterations (8 PRs)

After the calling dashboard shipped (PRs #49–#57), the operator started running real test sessions and surfaced bugs / UX gaps. These PRs follow up on that feedback.

- **[#65](https://github.com/shauncarldesigns/agency-os-v2/pull/65) Session outcomes update Pipeline outcome column.** Backend session-outcome handler was writing `call_log` but never updating `lead.outcome`, so the Pipeline's Outcome column never reflected calls made via the execution view. Maps each outcome to a friendly label (`Voicemail Left` / `Not Interested` / `Callback Requested` / `Demo Booked`). Cleanup: 5 stuck test leads reset to `cold`, 1 orphan project deleted; Magee Plumbing preserved as the only real prospect. Backend + dashboard.
- **[#64](https://github.com/shauncarldesigns/agency-os-v2/pull/64) Booking from exec view creates a project; Brief Studio sidebar gets Client card.** Three things: (a) exec-view booked-demo was setting `lead.status='qualified'` but never creating a project — left leads in limbo. Backend now creates the project at the lead's `recommended_tier` (fallback T3) and returns it. (b) Post-booking modal prompt — "Demo booked. Keep calling / 🛠 Pause & build demo" — wires the pause path to deep-link into the new project's Brief Studio. (c) Brief Studio sidebar's redundant Status Legend replaced with a Client card (business, owner, phone, email, location, contract start). Backend + dashboard.
- **[#63](https://github.com/shauncarldesigns/agency-os-v2/pull/63) Exec view: Log a Call form + sidebar auto-refresh.** Bare notes textarea replaced with the orange "Log a Call" card from the Pipeline LeadModal — outcome dropdown (8 options including Spoke with Owner / Gatekeeper / Interested / etc.), follow-up date, notes, Save Call Entry. Save doesn't advance; outcome buttons still advance. Sidebar Prior Calls card auto-refreshes via a refreshKey bump. Dashboard.
- **[#62](https://github.com/shauncarldesigns/agency-os-v2/pull/62) Exec view: Brief Studio layout + booking inline (no more modal).** Big restyle. Two-column `bs-layout`: main column = pitch / notes / outcomes / callback picker; sticky sidebar = Scores / Signals / Prior Calls cards. Booking happens inline — when operator clicks Booked, the main column swaps to BookingPane (full-width HoneyBook embed + copy fields + confirm). `BookDemoModal.tsx` deleted. Dashboard.
- **[#61](https://github.com/shauncarldesigns/agency-os-v2/pull/61) Exec view: page (not modal) + prior calls + drop Next.** ExecutionView converted from overlay-modal to a real page (replaces the dashboard view when active). Prior-calls toggle added above the notes textarea (lazy-loads via `api.leads.get`). "Next" button removed — overlapped with Skip-for-now without earning its place. Dashboard.
- **[#60](https://github.com/shauncarldesigns/agency-os-v2/pull/60) Exec view: Previous/Next/Skip nav row.** Switched from one-lead-at-a-time fetch to full session load + client-side `currentIndex` so the operator can navigate back and forth without re-fetching. `← Previous · Skip for now · Next →` row added below the outcome buttons. Burn-through now fires only when ALL leads have an outcome (not when next-uncalled returns null). Dashboard.
- **[#59](https://github.com/shauncarldesigns/agency-os-v2/pull/59) Exec view: Maps link + morning-before-evening session order.** Maps `↗` link added to the exec-view contact-info row (uses `place_id` for exact business resolution). Three session-list SQL queries changed from `ORDER BY block ASC` (alphabetical → evening before morning) to `ORDER BY CASE block WHEN 'morning' THEN 0 ELSE 1 END`. `googleMapsUrl` helper promoted from `LeadModal` to shared `lib/format.ts`. Backend + dashboard.
- **[#58](https://github.com/shauncarldesigns/agency-os-v2/pull/58) Fix: industry rotation uses Google Places keys, not friendly labels.** Composer was writing `industry='Plumbing'` to sessions, but `leads.industry` stores `'plumber'` (Google Places `primaryType`). Result: 0 leads matched every session — instant burn-through. `INDUSTRY_ROTATION` is now `{key, label}` pairs; sessions store the key, UI shows the label. Day-of-week prefix added to session card titles. 6 broken sessions deleted, rotation cursor reset. Backend + dashboard.

### Calling Dashboard feature (9 PRs + 1 spike)

- **[#56](https://github.com/shauncarldesigns/agency-os-v2/pull/56) Dashboard phase 8 — reschedule modal.** Replaces the Phase 4 `window.prompt` with a proper modal; defaults to 3 days after original; notes preserved in `demo_events` audit. Dashboard.
- **[#55](https://github.com/shauncarldesigns/agency-os-v2/pull/55) Dashboard phase 7 — Mon/Fri views + prospecting block.** Monday week-ahead with `SessionEditModal`; Friday week-in-review with stat cards, by-industry bars, callback recovery list. Shared prospecting task block (50/week target). Dashboard.
- **[#54](https://github.com/shauncarldesigns/agency-os-v2/pull/54) Dashboard phase 6 — HoneyBook split-pane booking modal.** Live HB embed in right pane + per-field copy buttons in left. Replaces Phase 5's window.prompt fallback. Dashboard.
- **[#53](https://github.com/shauncarldesigns/agency-os-v2/pull/53) Dashboard phase 5 — execution view.** Full-screen one-lead-at-a-time view; pitch card with ↻ generation; outcome buttons + keyboard shortcuts (1/2/3/4/S); burn-through complete screen. Dashboard.
- **[#52](https://github.com/shauncarldesigns/agency-os-v2/pull/52) Dashboard phase 4 — shell + sessions grid.** Dashboard tab becomes the default landing tab. Priority strip (demos awaiting status / no-show recovery / demos today / callbacks due). Sessions grid. Dashboard.
- **[#51](https://github.com/shauncarldesigns/agency-os-v2/pull/51) Dashboard phase 3 — backend session + outcome logic.** `services/sessionComposer.ts` (industry rotation + widening cascade), `services/dayOfWeek.ts` (Chicago tz), `routes/sessions.ts` (generate-week, outcome endpoint), `routes/callbacks.ts`, `routes/demos.ts`, `routes/dashboard.ts`. `prompts/pitchCard.ts` for on-demand Haiku-based pitch cards. Backend.
- **[#50](https://github.com/shauncarldesigns/agency-os-v2/pull/50) Dashboard phase 2 — schema + types.** 5 new tables (sessions, session_leads, callbacks, demos, demo_events) + 1 single-row config (weekly_rotation). 5 ALTER on leads for pointer columns. Backend.
- **[#49](https://github.com/shauncarldesigns/agency-os-v2/pull/49) Dashboard phase 0 — vocabulary refactor.** Renamed `Qualify → Book demo`. New lead-status semantic: `qualified` = "demo booked, project exists, awaiting outcome." New `not_interested` status. Prospect cards get `✗ Demo passed` button. Backfill of 1 existing `client` lead → `qualified`. Backend + dashboard.

### Cloudflare DNS Management feature (6 PRs)

- **[#47](https://github.com/shauncarldesigns/agency-os-v2/pull/47) DNS phase 6 — hourly polling cron for pending zones.** New `0 * * * *` cron flips `dns_status` from `pending` to `active` when Cloudflare detects nameserver delegation. Backend.
- **[#46](https://github.com/shauncarldesigns/agency-os-v2/pull/46) DNS phase 5 — Edit Project domain/registrar/owner email + confirm flow.** Domain field in Edit Project modal with `window.confirm` gate on domain swaps (orphans old CF zone). Dashboard + backend.
- **[#45](https://github.com/shauncarldesigns/agency-os-v2/pull/45) DNS phase 4 — sidebar DNS section with status polling.** New "DNS" card below Data Sources; auto-polls every 60s while pending. Dashboard.
- **[#44](https://github.com/shauncarldesigns/agency-os-v2/pull/44) DNS phase 3 — Quick Action UI + setup modal + manage panel.** Dynamic "Add domain & DNS" → "Manage DNS" button; focused setup modal; manage panel with copy-to-clipboard nameservers + Refresh + Retry. Dashboard.
- **[#43](https://github.com/shauncarldesigns/agency-os-v2/pull/43) DNS phase 2 — Cloudflare service + DNS endpoints.** `POST /api/projects/:id/dns/{setup,retry}` + `GET /api/projects/:id/dns/status`. Proxy hard-coded OFF (landingsite SSL conflicts with CF proxying). Backend.
- **[#42](https://github.com/shauncarldesigns/agency-os-v2/pull/42) DNS phase 1 — schema + types.** Adds `domain`, `cf_nameservers`, `dns_status`, `dns_last_checked`, `registrar`, `domain_owner_email` to projects. Reuses existing `cf_zone_id`. Backend.

### Other June work

- **[#41](https://github.com/shauncarldesigns/agency-os-v2/pull/41) Refactor: centralize tier pricing in `lib/pricing.ts`.** Single source of truth — tier prices + `TIER_MRR` were duplicated across 8 files. No behavior change. Dashboard.
- **[#40](https://github.com/shauncarldesigns/agency-os-v2/pull/40) Pricing update: Tier 1 → $950 one-time, Tier 2 → $799 build + $79/mo.** Tier 3 unchanged. Dashboard.
- **[#39](https://github.com/shauncarldesigns/agency-os-v2/pull/39) Sites: restore card shell on Prospects stat tile.** Visual fix — tile was missing rounded corners + background. Dashboard.
- **[#38](https://github.com/shauncarldesigns/agency-os-v2/pull/38) Trash: hard-delete + bulk delete for soft-deleted leads.** Per-row "🗑 Delete forever" + bulk strip in trash view. Dashboard.
- **[#37](https://github.com/shauncarldesigns/agency-os-v2/pull/37) Lead modal: phone number is now a `tel:` link.** Dashboard.
- **[#36](https://github.com/shauncarldesigns/agency-os-v2/pull/36) Docs: refresh README, CLAUDE.md, HANDOFF.md after PRs #17–#35.** No code change.
- **[#35](https://github.com/shauncarldesigns/agency-os-v2/pull/35) Sites: make stat tiles clickable to filter the grid.** Click a tile → filters Sites grid to that slice. Dashboard.
- **[#34](https://github.com/shauncarldesigns/agency-os-v2/pull/34) Add prospect status; only signed clients count toward MRR.** New `prospect` project status — qualified-but-not-signed leads excluded from MRR. Sites tile + badge added. Dashboard + backend.
- **[#33](https://github.com/shauncarldesigns/agency-os-v2/pull/33) Outscraper + enrich: bail fast on Worker subrequest cap.** Three swallowed-error paths fixed; bulk enrich now aborts cleanly instead of marching through doomed retries. Backend.
- **[#32](https://github.com/shauncarldesigns/agency-os-v2/pull/32) Pipeline: enrichment status filter.** New All/Enriched/Pending/Enriching/Failed dropdown. Dashboard.
- **[#31](https://github.com/shauncarldesigns/agency-os-v2/pull/31) Quick Brief modal: business name + reviews verbatim for landingsite demo.** Pure client-side, copies to clipboard, zero Claude synthesis. Dashboard.
- **[#30](https://github.com/shauncarldesigns/agency-os-v2/pull/30) Pipeline: Reviews column + sort by Most reviews / score / rating.** Dashboard.
- **[#29](https://github.com/shauncarldesigns/agency-os-v2/pull/29) Fix bulk enrich: subrequest budget exhaustion + false-positive enriched state.** Outscraper poll cadence 2s → 8s; bulk limit 50 → 25. Backend + dashboard.
- **[#28](https://github.com/shauncarldesigns/agency-os-v2/pull/28) Mine local landmarks/neighborhoods from reviews.** Surfaces "East Side of Green Bay" etc. as parentheticals on master brief city bullets and in service-area page briefs. Backend.
- **[#27](https://github.com/shauncarldesigns/agency-os-v2/pull/27) Matrix: rename "Services Overview" → "Services"; add "Service Areas" hub page.** Foundation pages now include `/service-areas` when project has 2+ cities. Dashboard + backend.
- **[#26](https://github.com/shauncarldesigns/agency-os-v2/pull/26) Page brief v3: letter form — SEO block + creative-director memo.** Anti-fluff word ban list baked into prompt; headline suggestions quoted inline; customer quotes verbatim. Backend.
- **[#25](https://github.com/shauncarldesigns/agency-os-v2/pull/25) Fix Brief Studio header stats.** "Pages live" was hardcoded; "Briefed · awaiting complete" over-counted. Dashboard.
- **[#24](https://github.com/shauncarldesigns/agency-os-v2/pull/24) Fix master brief: use `project.services` / `project.service_areas` as authoritative.** Mined `extracted_services` is signal-only. Backend.
- **[#23](https://github.com/shauncarldesigns/agency-os-v2/pull/23) Drop `photography_direction` from editor + hide service-area grid below 2 cities.** Backend + dashboard.
- **[#22](https://github.com/shauncarldesigns/agency-os-v2/pull/22) Consolidate project editing into one modal.** Three editing surfaces collapsed into the unified `OperatorInputForm`. Dashboard.
- **[#21](https://github.com/shauncarldesigns/agency-os-v2/pull/21) Pipeline: bulk re-enrich via row checkboxes + reused Enrich button.** Dashboard.
- **[#20](https://github.com/shauncarldesigns/agency-os-v2/pull/20) Brief editor: wire up the Regenerate button for master briefs.** Dashboard.
- **[#19](https://github.com/shauncarldesigns/agency-os-v2/pull/19) Brief generation refactor.** Master brief gains Target Audience section; per-page brief stops dictating layout (became a "job description" format). Backend.

## 2026-05

- **[#18](https://github.com/shauncarldesigns/agency-os-v2/pull/18) Matrix-brief sync (Option C).** Inline `+ Add service` / `+ Add city` pills on the matrix; brief-additions callout; matrix-may-be-stale pill. (Inline pills later removed in #22's consolidation.) Dashboard + backend.
- **[#17](https://github.com/shauncarldesigns/agency-os-v2/pull/17) Qualify-flow refactor.** Killed auto-spawn-project-on-enrich; pipeline qualification is now a modal with explicit tier picker. Sites tab projects can be deleted. Dashboard + backend.
- **[#16](https://github.com/shauncarldesigns/agency-os-v2/pull/16) Add CLAUDE.md + HANDOFF.md.** First durable session-handoff docs.
- **[#15](https://github.com/shauncarldesigns/agency-os-v2/pull/15) Fix 400 on brief generation: strip `temperature` for Opus 4.7.** Opus 4.7 rejects the param; service strips it for models matching `/opus-4-7/`. Backend.
- **[#14](https://github.com/shauncarldesigns/agency-os-v2/pull/14) Lead modal: restore Google Maps link.** Dashboard.
- **[#13](https://github.com/shauncarldesigns/agency-os-v2/pull/13) Fix dashboard deploy script: use `npx wrangler`.** Tooling.
- **[#12](https://github.com/shauncarldesigns/agency-os-v2/pull/12) Master brief: Select all / Deselect all testimonials.** Dashboard.
- **[#11](https://github.com/shauncarldesigns/agency-os-v2/pull/11) Outscraper: per-fetch timeouts + 120s poll deadline.** Backend.
- **[#10](https://github.com/shauncarldesigns/agency-os-v2/pull/10) Remove CI smoke-test comment.** Internal.
- **[#9](https://github.com/shauncarldesigns/agency-os-v2/pull/9) CI smoke test: verify Worker deploy workflow.** Internal.
- **[#8](https://github.com/shauncarldesigns/agency-os-v2/pull/8) Deploy automation: dashboard deploy script + Worker CI.** Backend now auto-deploys on merge; dashboard ships via `npm run deploy`.
- **[#7](https://github.com/shauncarldesigns/agency-os-v2/pull/7) Pipeline: Website column + no-website filter.** Dashboard.
- **[#6](https://github.com/shauncarldesigns/agency-os-v2/pull/6) Enrichment refactor: Outscraper reviews, Opus 4.7 briefs, parallel pipeline.** Major upgrade — review pool 5 → 50 via Outscraper; brief generation moves to Opus 4.7. Backend.
- **[#5](https://github.com/shauncarldesigns/agency-os-v2/pull/5) Page briefs: angle-led prompt + temperature bump.** Backend.
- **[#4](https://github.com/shauncarldesigns/agency-os-v2/pull/4) Refactor/v2.1 (continued).** Backend + dashboard.
- **[#3](https://github.com/shauncarldesigns/agency-os-v2/pull/3) Refactor/v2.1.** Backend + dashboard.
- **[#2](https://github.com/shauncarldesigns/agency-os-v2/pull/2) Prospect: default to Green Bay + filter for businesses with no website.** Dashboard.
- **[#1](https://github.com/shauncarldesigns/agency-os-v2/pull/1) Refactor brief system + workflow to v2.1.** Foundational restructure.
