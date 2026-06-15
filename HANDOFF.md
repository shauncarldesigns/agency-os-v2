# Session Handoff — Agency OS v2

_Snapshot: 2026-06-14. Point-in-time notes; goes stale fast. Durable architecture,
deploy mechanics, and gotchas live in `CLAUDE.md` (auto-read every session).
Full PR-by-PR log lives in `CHANGELOG.md`._

## State

All PRs below are **merged to `main`**. The backend Worker auto-deployed via CI on
each merge. The dashboard requires a manual `npm run deploy` from `main` — see the
deploy section at the bottom for what's pending operator-side.

## What shipped since the last handoff (PRs #36–#47)

Grouped by theme.

### Cloudflare DNS Management (PRs #42–#47) — major feature

Six-phase build that adds end-to-end DNS management for client domains. Quick
Action button in the project sidebar flips between **⚡ Add domain & DNS** (no
domain set) and **🔧 Manage DNS** (zone exists). All three landingsite DNS
records are created automatically with proxy OFF.

- **#42 — Schema + types.** 6 new columns on `projects` (domain, cf_nameservers,
  dns_status, dns_last_checked, registrar, domain_owner_email). Reuses existing
  `cf_zone_id`. Partial index `idx_projects_dns_pending` for the cron's SELECT.
- **#43 — Cloudflare service + DNS endpoints.** `services/cloudflare.ts` gains
  `createZone`, `getZoneStatus`, `listDnsRecords`, `createDnsRecord` — all
  throwing a typed `CloudflareError`. `routes/dns.ts` exposes `/dns/{setup,
  status, retry}` under `/api/projects/:id`. `services/dnsConstants.ts` is the
  single source of truth for the 3 landingsite records.
- **#44 — Quick Action UI + setup/manage modals.** New `DnsSetupModal.tsx`
  (domain field with client-side validation matching backend regex) and
  `DnsManagePanel.tsx` (zone status + copy-to-clipboard nameservers + per-record
  found/missing + Refresh + Retry).
- **#45 — Sidebar DNS section.** New "DNS" card below Data Sources, mirroring
  the Google Places row pattern. Self-polls every 60s while `dns_status='pending'`,
  stops on `active`. Cheap on CF subrequests because polling stops automatically.
- **#46 — Edit Project domain/registrar/owner email + confirm flow.** New
  "Domain & DNS" section in the OperatorInputForm. Inline yellow callout +
  `window.confirm()` when changing the domain on a project with an existing
  zone. Backend `?replace=true` query param on `/dns/setup` for the confirmed
  domain swap. Old zone left in CF account for manual cleanup.
- **#47 — Hourly DNS polling cron.** `0 * * * *` schedule calls
  `pollPendingDnsZones()` — finds pending zones, hits CF, flips to active when
  delegated. Always stamps `dns_last_checked`.

**One-time operator setup that landed during this work:** the Cloudflare API
token (`CLOUDFLARE_API_TOKEN` Worker secret, currently the **Agency OS API**
token in CF dashboard) needed `Zone:Edit` + `DNS:Edit` + `Account Settings:Read`
permissions added. `CLOUDFLARE_ACCOUNT_ID` Worker secret was set but value was
empty/stale and had to be re-set with `fb5e6618ae5c1a662bbfa0a63b28a34a`.

### Other work

- **#41 — Centralize tier pricing.** New `lib/pricing.ts` is the single source
  of truth — tier price strings + `TIER_MRR` were duplicated across 8 files.
  No behavior change.
- **#40 — Pricing update.** Tier 1 → $950 one-time; Tier 2 → $799 build + $79/mo.
  Tier 3 unchanged.
- **#39 — Sites: restore card shell on Prospects stat tile.** Tile was passing
  `variant="prospect"` as className but `prospect` isn't a styled class — it
  was rendering without rounded corners or background.
- **#38 — Trash: hard-delete action for soft-deleted leads.** Per-row "🗑 Delete
  forever" + bulk delete strip in trash view. Backend endpoint already existed
  (`?hard=true`); only the UI was missing.
- **#37 — Lead modal phone is now a `tel:` link.** Click-to-call.
- **#36 — Docs refresh.** Captured PRs #17–#35 into CLAUDE.md / HANDOFF.md.

## New documentation convention (added this session)

`CHANGELOG.md` now exists at the repo root. The convention going forward is
that **Claude updates CHANGELOG.md, CLAUDE.md, and HANDOFF.md as part of
shipping PRs** — operator shouldn't have to remember. See the "Conventions"
section of CLAUDE.md for the rules.

## Open items / next session candidates

Roughly priority order. None blocking.

1. **DNS subdomain mode.** Cloudflare doesn't allow zones for subdomains
   (`magee-plumbing.agncy.dev` returns CF 1116). If `*.agncy.dev` style
   client demos are a real workflow, the setup flow needs to detect
   "this is a subdomain of a zone I already own" and add records to the
   existing zone instead of creating a new one. ~Phase 7.
2. **DNS setup modal: pre-submit subdomain warning.** Cheap follow-up — soft
   warning when the operator types something with more than one dot, before
   they hit submit and see the CF 1116. Catches the common typo case
   without needing the bigger Phase 7.
3. **Compound filtering on Sites tab.** Current filter is single-select.
   "Tier 3 prospects" or "Paused clients" require a real filter row.
   Not urgent; single-select handles the common cases.
4. **Bulk-enrich latency.** ~50 leads/invocation is still ~30 min wall-clock
   for a full sweep. Real fix is a background job — cron triggers exist to
   build on. Out of scope until operator hits the friction.
5. **`reviewExtraction.ts` still requests `differentiators`.** PR #19 removed
   the field from `MinedReviewData` but the Claude prompt still asks for it
   in JSON output. Wasted ~50 tokens per enrichment. One-line cleanup.
6. **`OperatorInputForm` photography field.** Dropped from the brief in #23
   but the form input is still there. Dead UX; could remove the field too.
7. **Reports module's `cf_zone_id` analytics path is effectively dead.** No
   landingsite client is proxied through CF (proxy OFF is mandatory), so
   `getZoneAnalytics` returns zeros silently. Worth removing from monthly
   snapshots — or replacing with Cloudflare Web Analytics (JS snippet) if
   landingsite supports custom script injection.

## Recently verified working

- DNS setup flow end-to-end on `agency-os-test-...` apex test domain — zone
  created, 3 records added with proxy off, sidebar shows Pending → expected
  records all ✓ Found. Manage panel copy-to-clipboard works.
- Trash bulk-delete on 7 soft-deleted projects (the post-test cleanup run).
- Pricing tile sublabels match across Pipeline TierStats, Sites stat tiles,
  QualifyLeadModal, and OperatorInputForm.

## Deploy state to confirm

- **Backend Worker:** all PRs above auto-deployed via CI on merge. Last expected
  HEAD on `main` is the squash-merge of PR #47.
- **Dashboard:** last manual deploy after PR #46 (verified bundle
  `index-KGhqcXpC.js` serving from apex). If you ship anything between #47
  and the next session, re-deploy with `cd agency-os-dashboard && npm run deploy`.
- **Migrations to apply:** `2026-06-14-dns-management.sql` was applied to remote
  D1 immediately after PR #42 merged. No outstanding migrations.

## Operator must-do before next DNS test

- If `CLOUDFLARE_ACCOUNT_ID` Worker secret was rotated again, re-set it with
  the value from CLAUDE.md (`fb5e6618ae5c1a662bbfa0a63b28a34a`).
- For real client domains, test with an apex (e.g. `example.com`) — not
  a subdomain — until Phase 7 lands.
