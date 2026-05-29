# Session Handoff — Agency OS v2

_Snapshot: 2026-05-28. Point-in-time notes; goes stale. Durable architecture,
deploy mechanics, and gotchas live in `CLAUDE.md` (auto-read every session)._

## State

All work below is **merged to `main` and deployed live**. Local `refactor/v2.1`
is synced to `origin/main`. Working tree clean.

## What shipped this session (PRs #5–#15)

1. **Brief variance** — rewrote `prompts/pageBrief.ts` to be "angle-led" (pick a
   positioning angle from the business's own review themes, then write; sections are a
   menu, not a rigid template). `BRIEF_MODEL` → `claude-opus-4-7`.
2. **Opus 4.7 temperature 400 fix** — Opus 4.7 rejects `temperature`; `services/claude.ts`
   now strips it for `/opus-4-7/`. Variance now comes from the prompt, not temperature.
3. **Outscraper reviews** — `services/outscraper.ts` fetches up to 50 reviews (Places caps
   at 5), merged/deduped with Google's 5. Per-fetch timeouts (15s/10s) + 120s poll
   deadline. Worker secret `OUTSCRAPER_API_KEY` set. Falls back to Google's 5 on failure.
4. **Parallel enrichment** — Outscraper + PageSpeed run concurrently
   (`Promise.allSettled` in `routes/enrich.ts`). PageSpeed timeout 45s → 90s.
5. **Pipeline UI** — Website column + "All Websites / No website / Has website" filter
   (`LeadsTable.tsx`, `PipelinePanel.tsx`), scoped to enriched leads.
6. **Master brief modal** — "Select all / Deselect all" for testimonials
   (`OperatorInputForm.tsx`).
7. **Lead modal** — restored v1 Google Maps link (`LeadModal.tsx`), uses `query_place_id`
   when a `place_id` exists.
8. **Deploy automation** — Worker CI workflow + dashboard `npm run deploy` script.

## Open items (next session — roughly priority order)

1. **Bulk-enrich latency (biggest).** `enrich-all` runs leads *sequentially*; with
   Outscraper now ~2 min/lead, a 25-lead batch ≈ 50 min and may hit Worker limits. Fix:
   batch across leads (`Promise.all` in groups) OR move Outscraper to a background job —
   `wrangler.toml` already has cron triggers to build on.
2. **Outscraper cost gating.** ~$0.05/lead at 50 reviews. Consider gating to higher-tier
   leads, or skip if `reviews_fetched_at` is recent (column exists, not yet a guard).
3. **CI Node 20 deprecation.** GitHub forces Node 24 on Jun 2, 2026. Bump
   `actions/checkout@v4`, `setup-node@v4`, `wrangler-action@v3` when newer versions land
   (non-breaking until then).
4. **Brief still templated?** If briefs feel same-y on Opus 4.7, it's the prompt or input
   data, not temperature (Opus ignores it). Push the angle-selection step harder in
   `pageBrief.ts`, or loosen the intentionally-rigid `masterBrief.ts` (separate task).

## Recently verified working

- Live enrich (leads 7, 183): Outscraper backfill (15 / 43 reviews), PageSpeed scoring
  56/57, parallel execution confirmed via `wrangler tail`.
- Worker CI: green end-to-end deploy on merge to `main`.
- Dashboard features confirmed in production bundles (Website column, testimonials
  select-all, Maps link) and via browser preview.
