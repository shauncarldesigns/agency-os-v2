# Claude Code Kickoff — Agency OS v2.1 Refactor

Read `spec/refactor-v2.1.md` carefully before doing anything else. It describes a refactor of this existing repo — NOT a new build. Most of the code stays. Targeted modifications only.

## What you're working on

This is an existing deployed app for running a one-person web design agency. The current brief generation system produces weak output and doesn't match the actual sales workflow. You are refactoring it to:

1. Replace `pageBrief.ts` with a two-prompt architecture (master brief + monthly batch brief)
2. Add a three-timeframe workflow (homepage demo → foundation build → monthly SEO cycle)
3. Add a manual completion checklist (replaces the abandoned Cowork API integration)
4. Fix prospect search pagination
5. Add industry filter + soft delete to pipeline

## Before you write any code

1. Read `spec/refactor-v2.1.md` in full.
2. Read the existing files you'll be modifying so you understand current behavior:
   - `agency-os-backend/src/prompts/pageBrief.ts` (will be replaced)
   - `agency-os-backend/src/db/schema.sql` (will be extended)
   - `agency-os-backend/src/services/places.ts` (has bugs to fix)
   - `agency-os-backend/src/services/reviewMiner.ts` (kept as-is, but referenced)
   - `agency-os-backend/src/routes/briefs.ts` (will be rewritten)
   - `agency-os-backend/src/routes/leads.ts` (modified for soft delete)
   - `agency-os-dashboard/src/components/build/` (the Build tab UI — to be renamed Briefs)
   - `agency-os-dashboard/src/components/sites/` (the Sites tab UI — to add Site Detail page)
3. Read `mockups/agency-os-v2-mockup.html` for the Site Detail page visual reference (the rest of the mockup is partially out of date — only the Site Detail page direction is current).
4. Show me a brief plan (5-10 bullet points) of how you'll approach Phase 1 before writing any code.

## Hard rules

- **Do this in phases as described in section "Build order" of the spec.** Stop at each checkpoint and confirm with me before proceeding.
- **Phase 1 is the highest-priority and highest-risk piece.** Get the master brief prompt right in isolation before touching anything else. Do NOT modify routes, schema, or UI in Phase 1.
- **Don't invent functionality not described in the spec.** If you think something is needed but isn't in the spec, ask first.
- **Don't add new dependencies without asking.** Especially no new npm packages, no new external APIs.
- **Don't touch the Reports tab** (`gsc.ts`, `pagespeed.ts`, the reports routes, the reports UI). Out of scope.
- **Don't touch Search Console or PageSpeed integrations.** Out of scope.
- **Ask before running any destructive operations** — wrangler database migrations on remote, file deletions, force-pushes.
- **Verify schema columns before adding them.** Some columns the spec mentions might already exist on `projects`. Check with `.schema projects` first.

## Phase 1 — start here

The goal of Phase 1 is to prove the master brief prompt produces Apex-quality output BEFORE touching the rest of the app. Specifically:

1. Create `agency-os-backend/src/prompts/masterBrief.ts` as a standalone module with a `buildMasterBriefPrompt(input, mode)` function that takes structured input and returns a prompt for Claude.
2. Create `scripts/test-master-brief.ts` — a Node script that:
   - Loads hardcoded test data for a real-feeling business (use Northshore Plumbing or a fake but realistic example — see the Apex Roofing reference brief in the spec)
   - Calls Claude via the existing `claude.ts` service
   - Prints the resulting markdown to console
3. Run the test script and show me the output.
4. We iterate the prompt together until output quality matches the Apex example.

Do NOT modify the schema, routes, or UI in Phase 1. Just build the prompt module and the test script.

## Reference: the Apex example brief format

The format the prompt should produce is documented in section "Reference: the Apex master brief format" of `spec/refactor-v2.1.md`. Save that format as a separate file at `spec/brief-templates/master-brief-example.md` so it can be referenced as a "what good looks like" example in the prompt itself.

## Communication

- After reading the spec, show me your Phase 1 plan in 5-10 bullets.
- After each phase, summarize what changed in 3-5 bullets and wait for confirmation before continuing.
- If you encounter ambiguity, ask. If you're confident about a small choice (variable naming, file structure within a phase), make the call and tell me what you decided.
- Honest assessments preferred. If something in the spec seems wrong, say so — don't silently work around it.

Start by reading `spec/refactor-v2.1.md` in full and then showing me your Phase 1 plan.
