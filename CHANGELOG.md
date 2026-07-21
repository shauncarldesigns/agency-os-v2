# Changelog

Reverse chronological. One entry per merged PR with user-visible change.
Pure internal refactors, CI tweaks, and dep bumps may be omitted.

Backend Worker auto-deploys via CI on merge. Dashboard requires manual
`cd agency-os-dashboard && npm run deploy` — entries below note "dashboard"
when a manual deploy was needed.

## 2026-07

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
