# Agency OS v2.1 — Refactor Spec

**Project:** Agency OS v2 → v2.1 refactor
**Owner:** Shaun Gehrke
**Repo:** https://github.com/shauncarldesigns/agency-os-v2
**Status:** Refactor of an existing deployed app — NOT a new build

---

## Purpose of this refactor

The existing app is built and deployed but the brief generation produces weak output and the workflow doesn't match how the agency actually operates. This refactor:

1. Replaces the brief generation system with a **two-prompt architecture** (master brief + monthly batch brief) that produces Apex-quality briefs from real lead data
2. Adds a **three-timeframe workflow** to match the actual sales cycle (cold homepage demo → foundation build → monthly SEO cycle)
3. Adds a **manual completion checklist** to replace the abandoned Cowork API
4. Fixes the **prospect search pagination** bug
5. Adds **industry filtering** and **soft-delete** to the pipeline

The existing infrastructure (auth, dashboard shell, Pipeline UI, Reports, Search Console integration, Places enrichment, review mining, deploy pipeline) is kept as-is. Only what's listed below changes.

---

## The real workflow this app supports

Three timeframes, in order:

### Timeframe 1 — Cold Homepage Demo (pre-call)

Operator finds a lead in Prospect, enriches it, and the app generates a **homepage-only brief** using only Google reviews + Places data. The brief is pasted into landingsite.ai to produce a demo homepage. On the cold call, the operator says *"I already built you a site — want to see it?"* and shows the homepage to close a meeting.

No website scraping happens at this stage. Review-mined data is enough because landingsite.ai produces good homepage content from review themes alone.

### Timeframe 2 — Foundation Build (post-signing, week 1-2)

Lead becomes Project. Operator fills in fields the app couldn't auto-detect (founded year, owner certifications, brand colors, photography direction, curated testimonials). At this stage, the app **scrapes the lead's existing website** if they have one, to extract brand voice signals.

The app then generates a **Master Brief** in the Apex format covering the entire site: identity, voice, services, areas, testimonials, site structure, SEO. This is pasted into landingsite.ai's "Create Website" form, which auto-scaffolds the route structure. Cowork (or the operator) then drives landingsite.ai chat to populate each page individually.

### Timeframe 3 — Monthly SEO Cycle (ongoing, Tier 3 only)

Every month, each Tier 3 client is owed ~5 new service-area pages as part of the $499/month retainer. The app surfaces the SEO Coverage Matrix (service × city) showing which combinations are built, queued, or not started. The operator (with Claude-recommended suggestions) picks the next batch.

The app generates a **Monthly Batch Brief** containing the chosen pages plus relevant context (review quotes mentioning those cities, services already built, internal-linking targets, brand voice reference). This brief is pasted into Cowork, which then writes per-page prompts on its own and drives landingsite.ai.

As each page goes live, the operator marks it complete in the app's checklist.

---

## What changes — file by file

### 1. `agency-os-backend/src/db/schema.sql` — schema additions

#### NEW: `briefs` table

Promotes briefs to a first-class entity. Replaces the current pattern of storing brief content scattered across `pages.brief_content` and `brief_jobs.brief_markdown`.

```sql
CREATE TABLE IF NOT EXISTS briefs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Type of brief
  kind              TEXT NOT NULL,  -- 'homepage_demo' | 'master' | 'monthly_batch'
  -- Content
  content_markdown  TEXT NOT NULL,
  -- Status
  status            TEXT NOT NULL DEFAULT 'generated',  -- 'generated' | 'in_progress' | 'completed' | 'archived'
  -- For monthly batches: which month this is for
  batch_period      TEXT,  -- e.g. '2026-06' for monthly_batch briefs, NULL otherwise
  -- Generation metadata
  generated_by_model TEXT,
  generation_input  TEXT,  -- JSON snapshot of the data used to generate this brief
  -- Timestamps
  generated_at      TEXT DEFAULT (datetime('now')),
  completed_at      TEXT,
  -- Versioning (if a brief is regenerated, the old one is archived)
  supersedes_brief_id INTEGER REFERENCES briefs(id)
);
CREATE INDEX IF NOT EXISTS idx_briefs_project ON briefs(project_id, kind, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_briefs_monthly ON briefs(project_id, batch_period) WHERE batch_period IS NOT NULL;
```

#### NEW: `brand_attributes` table

Stores brand-voice data that doesn't fit cleanly into existing project columns. Each row is one piece of brand context for a project.

```sql
CREATE TABLE IF NOT EXISTS brand_attributes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,  -- 'tagline' | 'certification' | 'review_theme' | 'photography_direction' | 'positioning' | 'differentiator' | 'value' | 'other'
  value           TEXT NOT NULL,
  source          TEXT,  -- 'scrape' | 'reviews' | 'operator' | 'claude'
  weight          INTEGER DEFAULT 1,  -- For ranking/priority when multiple exist
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brand_attr_proj ON brand_attributes(project_id, category);
```

#### NEW: `testimonials` table

Curated testimonials get a real home, distinct from the raw Google reviews stored as JSON on `leads`.

```sql
CREATE TABLE IF NOT EXISTS testimonials (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_name     TEXT NOT NULL,
  author_location TEXT,
  quote           TEXT NOT NULL,
  rating          INTEGER,
  source          TEXT,  -- 'google' | 'operator' | 'website' | 'other'
  is_featured     INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_testimonials_proj ON testimonials(project_id, is_featured);
```

#### MODIFY: `pages` table — add columns

```sql
ALTER TABLE pages ADD COLUMN brief_id INTEGER REFERENCES briefs(id);
ALTER TABLE pages ADD COLUMN batch_period TEXT;  -- which monthly batch this page belongs to
ALTER TABLE pages ADD COLUMN published_url TEXT;  -- the actual live URL once built
ALTER TABLE pages ADD COLUMN marked_complete_at TEXT;
ALTER TABLE pages ADD COLUMN operator_notes TEXT;  -- free-form notes from the operator
```

Status values for `pages.status` are now: `'planned'` | `'briefed'` | `'in_progress'` | `'complete'` | `'archived'`.

#### MODIFY: `projects` table — add columns

```sql
ALTER TABLE projects ADD COLUMN monthly_pages_target INTEGER DEFAULT 0;  -- e.g., 5 for Tier 3
ALTER TABLE projects ADD COLUMN tagline TEXT;
ALTER TABLE projects ADD COLUMN founded_year INTEGER;
ALTER TABLE projects ADD COLUMN owner_credentials TEXT;  -- e.g., "GAF Master Elite, 18 years in trade"
ALTER TABLE projects ADD COLUMN primary_color TEXT;  -- already exists, verify
ALTER TABLE projects ADD COLUMN accent_color TEXT;
ALTER TABLE projects ADD COLUMN photography_direction TEXT;  -- e.g., "Real crews on roofs, no stock photos"
ALTER TABLE projects ADD COLUMN scrape_completed_at TEXT;
ALTER TABLE projects ADD COLUMN scrape_data TEXT;  -- JSON of raw scrape output
```

Some of these may already exist — verify before adding to avoid duplicate column errors.

#### MODIFY: `leads` table — soft delete

```sql
ALTER TABLE leads ADD COLUMN deleted_at TEXT;  -- NULL = active, timestamp = soft-deleted
```

All lead queries should add `WHERE deleted_at IS NULL` unless explicitly viewing trash.

---

### 2. `agency-os-backend/src/prompts/` — new prompt files

#### DELETE: `pageBrief.ts`

Replaced entirely. The current implementation is a string-interpolation template that produces structural prompts, not content briefs.

#### NEW: `masterBrief.ts`

Generates the full Apex-format master brief for a project. Used for both the homepage demo (constrained mode) and the post-signing foundation build (full mode).

Inputs:
- All project data
- All review-mined data (services, areas, owner names, strengths, pitch quotes, differentiators)
- All brand_attributes for the project
- All testimonials for the project
- Raw Google reviews
- Scrape data if available
- Mode: `'homepage_only'` | `'full_site'`

Output: A markdown document in the Apex format. See `spec/brief-templates/master-brief-example.md` (Apex Roofing example) for the exact structure to produce.

The prompt must instruct Claude to:
- Use ONLY data provided — do not invent specifics (founded years, certifications, owner names)
- Where data is missing, write `[TBD: operator to fill in]` rather than fabricating
- Synthesize brand voice from the review themes
- In `homepage_only` mode, output only the Business Overview, Brand Voice, Services, Service Areas, Differentiators, Customer Reviews, and a Site Structure section listing ONLY "Homepage"
- In `full_site` mode, output the complete Apex-format brief with all sections including the full site structure

The prompt is the most important artifact in this refactor. It should be developed and tested in isolation before integration — see Phase 1 below.

#### NEW: `monthlyBatchBrief.ts`

Generates a focused brief for N service-area pages chosen for a specific month.

Inputs:
- The project (for brand voice context — references the master brief)
- The list of chosen pages (service × city pairs)
- For each city, any relevant review quotes that mention it
- The list of pages already built (for internal-linking context)
- The monthly_pages_target (e.g., 5)
- The batch_period (e.g., '2026-06')

Output: A single markdown document that:
- Briefly recaps brand voice (1 paragraph)
- Lists each page to build with: URL pattern, H1, local context to incorporate, customer quote to use (if available), internal links
- Includes a "build these in order" instruction
- Ends with a checklist of pages for the operator

This brief is small (1-2 pages). It's designed to be pasted into Cowork, which then writes per-page prompts on its own.

#### KEEP: `reviewExtraction.ts`

No changes. Already works well.

#### KEEP: `pitchPrep.ts`, `execSummary.ts`

No changes.

---

### 3. `agency-os-backend/src/services/` — new + modified services

#### MODIFY: `places.ts`

Two bugs to fix:

**Bug 1: No pagination.** `searchPlaces` calls `places:searchText` with `maxResultCount: 20` and returns the first response only. Google's Text Search (New) returns up to 60 results across 3 pages via `pageToken`. Fix:

```ts
// Pseudocode — adapt to actual implementation
export async function searchPlaces(apiKey, query, location, radiusMeters = 8000) {
  const allResults: PlaceResult[] = [];
  let pageToken: string | undefined = undefined;
  let pageCount = 0;
  const MAX_PAGES = 3;

  while (pageCount < MAX_PAGES) {
    const body: any = {
      textQuery: `${query} in ${location}`,
      maxResultCount: 20,
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(/* ... */, { body: JSON.stringify(body), /* ... */ });
    const data = await res.json();
    allResults.push(...(data.places ?? []).map(mapPlace));

    pageToken = data.nextPageToken;
    if (!pageToken) break;
    pageCount++;

    // Google requires a short delay before requesting next page
    await new Promise(r => setTimeout(r, 2000));
  }

  return allResults;
}
```

**Bug 2: Broken locationBias.** Current code:
```ts
locationBias: radiusMeters
  ? { circle: { center: { latitude: 0, longitude: 0 }, radius: radiusMeters } }
  : undefined
```
Center is hardcoded to (0, 0) — off the coast of Africa. Either:
- Geocode the `location` string to get real lat/lng and use it as the circle center, OR
- Remove `locationBias` entirely and rely on the text query (`${query} in ${location}`) for location filtering

The simpler fix is to remove `locationBias`. Text Search handles location-in-query well.

#### NEW: `scraper.ts`

Scrapes content from a lead's existing website for brand voice signals. Only runs in Timeframe 2 (post-signing), not during prospecting.

Behavior:
- Input: a URL
- Fetch with a normal browser User-Agent, respect robots.txt
- Parse out: page title, meta description, h1s, h2s, body text (cleaned of nav/footer)
- If multiple pages are linked from homepage (e.g., About, Services), fetch up to 3 additional internal pages
- Pass the combined extracted text to Claude with a prompt that extracts:
  - Tagline / positioning statement
  - Owner story or about-page summary
  - Certifications or awards mentioned
  - Service descriptions in their own words
  - The 5-10 most distinctive phrases used
- Store raw scrape output in `projects.scrape_data` as JSON
- Insert extracted items into `brand_attributes` with `source = 'scrape'`

Failure modes to handle gracefully:
- No website on file → skip entirely
- Site returns 4xx/5xx → log, skip, don't error
- Site is JS-only (SPA with no SSR) → fetch will get empty body, log and skip
- robots.txt disallows scraping → respect it, skip

#### KEEP: `reviewMiner.ts`

No changes. Already produces the right output.

#### KEEP: `pagespeed.ts`, `gsc.ts`, `cloudflare.ts`, `claude.ts`, `scoring.ts`, `pdf.ts`, `email.ts`

No changes.

---

### 4. `agency-os-backend/src/routes/` — modified routes

#### MODIFY: `briefs.ts`

Replace the current implementation. New endpoints:

```
POST /api/projects/:projectId/briefs/master?mode=homepage_only|full_site
  → Generate a master brief, store it, return the markdown

POST /api/projects/:projectId/briefs/monthly-batch
  → Body: { batchPeriod: '2026-06', pages: [{ service, city }, ...] }
  → Generate a monthly batch brief, create page rows, return the markdown

GET /api/projects/:projectId/briefs
  → List all briefs for a project, most recent first

GET /api/briefs/:briefId
  → Get a single brief by ID

POST /api/briefs/:briefId/regenerate
  → Body: { feedback?: string }
  → Generate a new version, archive the old one (sets supersedes_brief_id)

PATCH /api/pages/:pageId/complete
  → Body: { publishedUrl: string, notes?: string }
  → Mark a page as built. Sets status='complete', marked_complete_at, published_url
```

#### MODIFY: `prospect.ts`

After the `places.ts` pagination fix, expose a `pageToken` parameter on the prospect search endpoint so the frontend can request additional pages on demand if 60 isn't enough.

#### MODIFY: `leads.ts`

Add soft-delete:

```
DELETE /api/leads/:id
  → Sets deleted_at = now(). Returns 204.

POST /api/leads/:id/restore
  → Sets deleted_at = NULL.

GET /api/leads?include_deleted=true
  → Returns deleted leads.
```

All existing GET routes default to `WHERE deleted_at IS NULL`.

Add industry filtering:
```
GET /api/leads?industry=plumbing
  → Filter by industry field.
```

#### NEW: `brand-attributes.ts`

CRUD for brand_attributes:
```
GET /api/projects/:projectId/brand-attributes
POST /api/projects/:projectId/brand-attributes  → Body: { category, value, source }
DELETE /api/brand-attributes/:id
```

#### NEW: `testimonials.ts`

CRUD for testimonials:
```
GET /api/projects/:projectId/testimonials
POST /api/projects/:projectId/testimonials  → Body: { authorName, authorLocation, quote, rating, source }
PATCH /api/testimonials/:id  → Body: { isFeatured?, quote?, ... }
DELETE /api/testimonials/:id
```

#### NEW: `scrape.ts`

```
POST /api/projects/:projectId/scrape
  → Triggers scraper.ts for the project's website. Returns the scrape result.
```

#### REMOVE: `webhook.ts` (Cowork callbacks)

The Cowork callback endpoints are no longer needed since the operator manually marks pages complete via the PATCH /api/pages/:id/complete endpoint.

---

### 5. `agency-os-dashboard/` — UI changes

The dashboard is React + Vite. The 5 tabs (Prospect, Pipeline, Build, Sites, Reports) stay. Changes by tab:

#### Pipeline tab

- Add an industry filter dropdown above the leads table
- Add a "Delete" action on lead rows (with confirm modal) → soft-delete
- Add a "Trash" view accessible from the tab header → shows soft-deleted leads with "Restore" action

#### Prospect tab

- After pagination fix on backend, add a "Load more" button to fetch additional pages of results (up to 60 total)
- No other changes

#### Build tab — RENAME to "Briefs"

The Build tab becomes a brief management view. Restructure:

- Drop the "Queue for Cowork" button and any "Cowork status" indicators (the green pulsing dot in the header should also be removed)
- Add a "Generate Homepage Demo" action on qualified leads (status = 'qualified' or higher) that doesn't yet have a project. This creates a project shell + generates a homepage_demo brief.
- For existing projects, show:
  - "Generate Master Brief" action (only if no master brief exists yet) → opens an operator-input form (see below)
  - "Generate Monthly Batch" action (Tier 3 only) → opens the batch selection UI (see below)
  - History of all briefs generated for the project (master, monthly batches, homepage demos) with status

#### Operator-input form (pre-master-brief)

Before generating the master brief, the operator confirms/fills:
- Business details: confirm name, address, phone, founded year, owner name
- Owner credentials (free text): "GAF Master Elite certified, 18 years in trade"
- Brand colors: primary + accent
- Photography direction: short text or pick from presets ("rugged contractor", "warm family", "modern minimal")
- Services list: confirm review-mined services, add/edit
- Service areas list: confirm review-mined areas, add/edit
- Testimonials: review the 5 Google reviews, mark which to feature, edit text if needed, OR paste additional ones the owner provided

On submit: persists to `projects`, `brand_attributes`, `testimonials`, then calls the backend to generate the master brief.

#### Monthly batch selection UI (Tier 3 only)

When operator clicks "Generate Monthly Batch":
- Show the SEO Coverage Matrix (service × city grid)
- Cells are colored by status: built (green), briefed (yellow), planned (orange), not started (gray)
- Highlight Claude-recommended cells (the existing recommendation logic stays)
- Operator clicks up to `monthly_pages_target` cells (e.g., 5) to select
- Show a preview of context being fed to the prompt: which review quotes mention each selected city, which pages already exist for context
- Click "Generate Batch Brief" → creates the brief, returns markdown, shows it in a copy-able view

#### Sites tab

- Replace the existing Sites tab cards with the Site Detail page from the mockup
- Cards link to the detail page on click
- Site Detail page contains:
  - Project header (name, tier, status, "Open in landingsite.ai" link)
  - Quick stats (pages built, briefs generated, next monthly batch due, etc.)
  - SEO Coverage Matrix link
  - Brief History list (all briefs for the project)
  - **Build Checklist**: any pages with status='briefed' or 'in_progress' show as actionable items with a "Mark Complete" button that captures the published URL

#### Reports tab

No changes.

---

## Build order — phased rollout

Do these in order. Stop at each checkpoint and verify before continuing.

### Phase 1 — Master brief prompt (in isolation, no code changes)

**Goal:** Prove the master brief prompt produces Apex-quality output before integrating it.

Tasks:
1. Write `agency-os-backend/src/prompts/masterBrief.ts` as a standalone module that takes structured input and returns a Claude API call
2. Write a one-off test script (`scripts/test-master-brief.ts`) that hand-feeds a real lead's data (use the existing XIF Collision data or Northshore Plumbing test data) and outputs the result to console
3. Run it. Read the output. Compare against `spec/brief-templates/master-brief-example.md` (the Apex example).
4. Iterate the prompt until output quality matches.

**Do not modify the rest of the app yet.** This is the highest-risk piece — if the prompt is wrong, nothing else matters.

**Checkpoint:** Operator (Shaun) reviews 2-3 sample briefs generated from real lead data and confirms quality before moving to Phase 2.

### Phase 2 — Schema migration + briefs API

Tasks:
1. Add the new tables (`briefs`, `brand_attributes`, `testimonials`) and column additions to `schema.sql`
2. Write a migration script in `src/db/migrations/2026-05-refactor-v2.1.sql` so existing data isn't lost
3. Run migrations against local D1 first, then remote
4. Build the new routes (`briefs.ts`, `brand-attributes.ts`, `testimonials.ts`)
5. Delete `webhook.ts` and any associated Cowork callback code

**Checkpoint:** Verify with curl that all new endpoints work, master brief endpoint generates valid output, page completion endpoint updates state.

### Phase 3 — Frontend: Operator-input form + Briefs tab

Tasks:
1. Rename Build tab to Briefs in dashboard nav
2. Remove the Cowork pulse indicator from the header and all "Queue for Cowork" / "handed off to Cowork" copy throughout the app
3. Build the operator-input form component
4. Build the brief generation flow: form → POST to backend → display markdown with Copy to Clipboard
5. Build the brief history list view

**Checkpoint:** Operator can generate a homepage demo brief and a master brief end-to-end from the UI.

### Phase 4 — Scraping + Places fix + Pipeline tweaks

Tasks:
1. Implement `scraper.ts` and the `/api/projects/:id/scrape` endpoint
2. Add the scrape trigger to the operator-input form flow (auto-runs on form open if `lead.website` is set and no scrape_completed_at)
3. Fix the Places pagination + locationBias bugs in `places.ts`
4. Add the "Load more" button to Prospect UI
5. Add industry filter + soft-delete to Pipeline UI and backend

**Checkpoint:** Scrape produces useful brand_attributes for a lead with a website. Prospect search returns >20 results when available. Pipeline filter and delete work.

### Phase 5 — Site Detail page + Monthly Batch UI

Tasks:
1. Build the Site Detail page in Sites tab
2. Wire up the Build Checklist (mark complete with URL capture)
3. Build the Monthly Batch selection UI for Tier 3
4. Implement the monthly batch brief generation flow

**Checkpoint:** Operator can generate a monthly batch brief, paste it into Cowork, and as pages go live, mark them complete in the app with their published URLs.

### Phase 6 — Polish + deploy

Tasks:
1. Audit the entire app for any remaining Cowork theater (status indicators with no backing state, etc.)
2. Update all toast messages and inline copy to reflect the new workflow
3. Test the full three-timeframe workflow end-to-end with a real lead
4. Deploy backend changes (`wrangler deploy`)
5. Deploy frontend changes (`wrangler pages deploy`)

---

## What's explicitly out of scope for this refactor

- Wisconsin DSPS licensing data integration (future)
- Facebook scraping (deferred — too fragile, low ROI for what it returns)
- Automated Cowork API integration (Cowork has no API, period — manual paste is the workflow)
- Multi-tenant or multi-user support (single-operator app)
- Billing/invoicing integration
- Email automation for client communications (Resend integration stays for monthly reports, no new email features)
- Mobile-responsive optimizations (desktop-first is fine for the operator dashboard)

---

## Critical constraints (do not violate)

- **Merchynt is white-labeled.** The word "Merchynt" appears nowhere in any client-facing content (PDFs, emails, UI copy). Internal-only references in code and dashboards are fine.
- **Master brief prompt must not invent facts.** Where data is missing, output `[TBD: operator to fill in]` placeholders, never fabricate.
- **No new dependencies on Cowork as a service.** Cowork is treated as "an external tool the operator uses." The app has no API integration with it.
- **The existing deploy URLs continue to work** (https://agency-os-v2-dashboard.pages.dev and the corresponding Worker). No URL changes.
- **Soft delete only for leads.** Hard delete is destructive — call history attaches to leads. Trash + restore pattern.
- **Do not break Reports.** The Search Console + PageSpeed integration in `gsc.ts` and `pagespeed.ts` represents real work already done. Don't touch it.

---

## Reference: the Apex master brief format

This is the format the master brief prompt must produce. Save this as `spec/brief-templates/master-brief-example.md` in the repo.

```markdown
# Site Brief: {Business Name}

## Business Overview
**Business Name:** ...
**Location:** {city, state}
**Phone:** ...
**Email:** ...
**Years in Business:** ... ({founded year})
**Description:** {2-3 sentence summary}
**Owner:** {name, credentials}

## Brand Voice
- {3-6 voice descriptors}
- Reading level: 6th-8th grade
- {audience target}
- {sentence/voice style}
- {tone notes}

## Brand Style
- **Primary color:** {hex}
- **Accent color:** {hex}
- **Vibe:** {short description}
- **Photography:** {direction}

## Services Offered
1. **{Service}** — {description}
2. ...

## Service Areas ({region})
- {City 1} (HQ)
- {City 2}
- ...

## Key Differentiators
- {differentiator 1}
- ...

## Customer Reviews to Reference
**{Author Name}, {Location}** ({rating} stars):
"{quote}"
...

## Site Structure Required
{numbered list of pages — homepage, about, services overview, individual service pages, service-area pages with all combinations, insurance/lead-gen pages, contact, FAQ}

## SEO Requirements
- Unique meta title and description per page
- Title format for service-area pages: "{Service} in {City}, {State} | {Business Name}"
- Meta descriptions: 150-160 characters
- Internal linking rules
- Schema markup requirements

## Important Build Instructions
{numbered list of final nudges to the site builder}
```

For the **homepage_only mode**, output only: Business Overview, Brand Voice, Brand Style, Services Offered, Service Areas, Key Differentiators, Customer Reviews to Reference, and a Site Structure section listing ONLY "Homepage" with the SEO and Build Instructions trimmed to homepage-relevant items.

---

## Decisions locked (do not re-litigate)

- Two-prompt architecture: master brief + monthly batch brief. No per-page prompts generated by the app.
- Master brief is generated once per project (regenerable, with old versions archived via `supersedes_brief_id`).
- Cowork is a manual paste destination, not an integration.
- Tier 3 monthly commitment is configurable per project (`monthly_pages_target`), defaults to 5.
- Homepage demo uses only review-mined + Places data. No scraping pre-call.
- Scraping happens only post-signing as part of the operator-input form flow.
- Service-area pages and standalone service pages both exist. Service-area pages link up to parent service pages.
- Manual completion checklist replaces Cowork API — operator marks pages complete with their published URL.

---

## End of spec
