# Changelog

Reverse chronological. One entry per merged PR with user-visible change.
Pure internal refactors, CI tweaks, and dep bumps may be omitted.

Backend Worker auto-deploys via CI on merge. Dashboard requires manual
`cd agency-os-dashboard && npm run deploy` — entries below note "dashboard"
when a manual deploy was needed.

## 2026-06

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
