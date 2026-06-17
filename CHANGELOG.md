# Changelog

Reverse chronological. One entry per merged PR with user-visible change.
Pure internal refactors, CI tweaks, and dep bumps may be omitted.

Backend Worker auto-deploys via CI on merge. Dashboard requires manual
`cd agency-os-dashboard && npm run deploy` — entries below note "dashboard"
when a manual deploy was needed.

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
