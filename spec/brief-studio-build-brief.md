# Brief Studio Build — Claude Code Instructions

**Project:** Agency OS v2 — `refactor/v2.1` branch
**Repo:** https://github.com/shauncarldesigns/agency-os-v2
**Scope:** Build the Brief Studio page and master-brief workflow. Modify existing app — do not rebuild.

---

## Read first, then build

Before writing any code:

1. Check out the `refactor/v2.1` branch in the existing repo
2. Read these reference mockups (they live in the `mockups/` directory or get added as part of this task):
   - `brief-studio-mockup.html` — the **populated state** of the page (master brief generated, matrix active, brief editor panel open on a service-area cell)
   - `brief-studio-empty-state.html` — the **empty state** of the page (no master brief yet, skeleton matrix, callout to generate, modal overlay)
3. Show me a 5-bullet plan covering: which existing files you'll modify, which new files you'll add, what database changes are needed, and what you're NOT touching. Wait for my confirmation before writing code.

---

## What this build delivers

A new **Brief Studio** page that lives inside Site Detail and acts as the working surface for all brief work on a project. The page has two states:

- **Empty state** (no master brief yet) — yellow callout invites you to generate, matrix renders as skeleton, modal triggers from the callout button
- **Active state** (master brief exists) — master brief card with version metadata, matrix populated with cells in real statuses, clicking any cell opens the right-side Brief Editor panel

Both states share the same layout shell: topbar, stats row, master-brief-area, matrix card, sidebar with Status Legend / Quick Actions / Data Sources.

---

## Locked architecture decisions

These were settled in product discussion. Do not re-litigate:

- **Two brief types only**: master brief (one per project) and page briefs (many per project). No "monthly batch brief" concept.
- **Master brief generates page briefs.** Each page brief is short (250–800 words) and derives from the master. Master is the source of truth.
- **Page briefs are saved** in a `briefs` table, versioned, regeneratable.
- **Tier doesn't restrict the matrix.** Every project shows the full matrix regardless of tier. `billing_status` per page tracks `included` / `add-on` / `comp`.
- **No tier-based UI gating anywhere.** Tier only governs `monthly_pages_target` (e.g., 5 for Tier 3) and per-page billing categorization.
- **Manual completion checklist replaces Cowork API.** Three statuses: `planned` → `briefed` → `complete`. No "pasted" state. No URLs captured — just a timestamp when marked complete.
- **Master brief modal already exists** in the app (see screenshots in the project for reference — current modal includes Business Details, Brand, Services, Service Areas, Testimonials, Brand Attributes sections). The Brief Studio empty-state callout button triggers this **existing modal** — do not rebuild it.
- **Master brief card has no Edit or Regenerate buttons.** All editing happens via the right-side Brief Editor panel. Clicking the master brief card opens it in the panel.
- **Brief Editor panel — master brief variant**: hide the 4-step status bar (Briefed → Pasted → Live), replace with a meta strip showing version chip + last-updated timestamp + TBD count.
- **Brief Editor panel — page brief variant**: keep the 3-step status bar (Briefed → Pasted → Complete). Note: the original `brief-studio-mockup.html` shows 4 steps including "Pasted" — drop "Pasted" from the bar since we settled on three statuses. Update accordingly.
- **TBD items are handled inline** in the brief markdown. Click a `[TBD: ...]` token → opens an inline input that, on save, replaces the token with the entered value in the markdown.
- **The Build tab no longer exists.** Brief work has moved entirely into Site Detail → Brief Studio. Remove the Build tab from the dashboard nav. If a Build tab route still exists, redirect to Sites.

---

## Database changes

### New table: `briefs`

```sql
CREATE TABLE IF NOT EXISTS briefs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,           -- 'master' | 'page'
  page_id             INTEGER REFERENCES pages(id),  -- NULL for master briefs
  content_markdown    TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'briefed',  -- 'briefed' | 'complete' (page briefs); 'draft' | 'saved' (master briefs)
  version             INTEGER NOT NULL DEFAULT 1,
  generated_by_model  TEXT,
  generation_input    TEXT,                    -- JSON snapshot of inputs used
  tbd_count           INTEGER DEFAULT 0,       -- how many [TBD: ...] tokens remain in content_markdown
  supersedes_brief_id INTEGER REFERENCES briefs(id),  -- previous version when regenerated
  generated_at        TEXT DEFAULT (datetime('now')),
  completed_at        TEXT,                    -- when status moved to 'complete' (page briefs only)
  updated_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_briefs_project_kind ON briefs(project_id, kind);
CREATE INDEX IF NOT EXISTS idx_briefs_page ON briefs(page_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_briefs_master_per_project
  ON briefs(project_id) WHERE kind = 'master' AND supersedes_brief_id IS NULL;
```

The partial unique index enforces "one current master brief per project" — old versions stay around but `supersedes_brief_id` is set on regenerate.

### New table: `brand_attributes`

```sql
CREATE TABLE IF NOT EXISTS brand_attributes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  value       TEXT NOT NULL,                   -- e.g., "Licensed Master Plumber #MP-44892"
  source      TEXT,                            -- 'operator' | 'scrape' | 'reviews'
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brand_attr_proj ON brand_attributes(project_id);
```

### New table: `testimonials`

```sql
CREATE TABLE IF NOT EXISTS testimonials (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_name     TEXT NOT NULL,
  author_location TEXT,
  quote           TEXT NOT NULL,
  rating          INTEGER,
  source          TEXT,                        -- 'google' | 'operator' | 'website'
  is_featured     INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_testimonials_proj ON testimonials(project_id, is_featured);
```

### Modify `pages` table

```sql
ALTER TABLE pages ADD COLUMN brief_id INTEGER REFERENCES briefs(id);
ALTER TABLE pages ADD COLUMN billing_status TEXT DEFAULT 'included';  -- 'included' | 'add_on' | 'comp'
ALTER TABLE pages ADD COLUMN marked_complete_at TEXT;
```

Status values for `pages.status` are: `'planned'` | `'briefed'` | `'complete'`. Update any existing code referencing `'queued'` or `'in_progress'`.

### Modify `projects` table

Verify these don't already exist before adding (use `.schema projects`):

```sql
ALTER TABLE projects ADD COLUMN monthly_pages_target INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN tagline TEXT;
ALTER TABLE projects ADD COLUMN founded_year INTEGER;
ALTER TABLE projects ADD COLUMN owner_credentials TEXT;
ALTER TABLE projects ADD COLUMN accent_color TEXT;
ALTER TABLE projects ADD COLUMN photography_direction TEXT;
ALTER TABLE projects ADD COLUMN scrape_completed_at TEXT;
ALTER TABLE projects ADD COLUMN scrape_data TEXT;
```

### Drop/clean up

- Delete `brief_jobs` table if it still exists (replaced by `briefs`).
- Delete any webhook endpoint or route that was set up for Cowork callbacks.

### Migration safety

Write the migration as `agency-os-backend/src/db/migrations/2026-05-brief-studio.sql` and **run it against local D1 first**. Show me the output. Do not run against remote D1 until I confirm local worked.

---

## Backend changes

### Prompts

**Delete** `agency-os-backend/src/prompts/pageBrief.ts`. Replace with two new files:

**`agency-os-backend/src/prompts/masterBrief.ts`**

Function: `buildMasterBriefPrompt(input: MasterBriefInput): { system: string; user: string }`

Input includes: project basics (name, city, state, phone, email, founded year, owner name, credentials, tagline), brand (primary color, accent color, photography direction), services list, service areas list, brand attributes, featured testimonials, additional notes.

Output: a system + user prompt pair that produces the Apex-format master brief. The Apex example is the gold standard — match its sections, depth, and tone. The prompt must:
- Use only data provided
- Where data is missing, emit literal `[TBD: <field name>]` tokens that the UI will detect
- Synthesize brand voice from review themes + brand attributes
- End with a structured `Site Structure` section that the matrix renders from (services list + cities list → matrix cells)

Target output length: 1,500–2,500 words.

**`agency-os-backend/src/prompts/pageBrief.ts`** (new — same filename, completely different implementation)

Function: `buildPageBriefPrompt(masterBriefMarkdown: string, pageSpec: PageSpec): { system: string; user: string }`

`pageSpec` is: `{ type: 'homepage' | 'about' | 'services_overview' | 'contact' | 'faq' | 'service' | 'service_area' | 'custom'; service?: string; city?: string; customTitle?: string }`

The prompt receives the **full master brief markdown** as context and asks Claude to write a focused, condensed brief for one specific page. Output target: 250–800 words depending on type. Voice and brand must stay consistent with the master.

### Routes

**Modify `agency-os-backend/src/routes/briefs.ts`** — rewrite to support the new model:

```
POST   /api/projects/:projectId/briefs/master       Generate master brief from form submission
GET    /api/projects/:projectId/briefs/master       Get current master brief for project (or 404)
POST   /api/projects/:projectId/briefs/master/regenerate  Generate v2+ (sets supersedes_brief_id)

POST   /api/projects/:projectId/pages/:pageId/brief Generate page brief for a matrix cell
GET    /api/briefs/:briefId                         Get a brief by ID
PATCH  /api/briefs/:briefId                         Update content_markdown (after inline TBD fill or manual edit). Recalculate tbd_count.

PATCH  /api/pages/:pageId/status                    Body: { status: 'briefed' | 'complete' }. Sets marked_complete_at when status='complete'.
PATCH  /api/pages/:pageId/billing                   Body: { billing_status: 'included' | 'add_on' | 'comp' }
```

**Add `agency-os-backend/src/routes/brand-attributes.ts`** — basic CRUD scoped to a project.

**Add `agency-os-backend/src/routes/testimonials.ts`** — basic CRUD scoped to a project, with `PATCH` to toggle `is_featured`.

### Matrix derivation

Add `agency-os-backend/src/services/matrix.ts` with one function: `buildMatrixForProject(projectId)`. It reads the project's services + service areas (from `projects` table or derived from master brief) and returns a structured matrix:

```ts
{
  foundationPages: Array<{ type: 'homepage' | 'about' | 'services_overview' | 'contact' | 'faq' | 'custom', label: string, pageId: number | null, status: string, billingStatus: string }>,
  servicePages: Array<{ service: string, pageId: number | null, status: string, billingStatus: string }>,
  serviceAreaGrid: {
    services: string[],
    cities: string[],
    cells: Array<{ service: string, city: string, pageId: number | null, status: string, billingStatus: string }>
  }
}
```

Add endpoint: `GET /api/projects/:projectId/matrix`.

### TBD counter

Add `agency-os-backend/src/utils/tbd.ts` with `countTbds(markdown: string): number`. It counts occurrences of the `[TBD: ...]` pattern. Used on brief save to update `briefs.tbd_count`.

### Don't touch

- `gsc.ts`, `pagespeed.ts`, `reviewMiner.ts`, `pitchPrep.ts`, `execSummary.ts`, `claude.ts`
- The Reports tab, Search Console integration, PageSpeed integration
- Anything in the Pipeline or Prospect tabs (separate refactor)

---

## Frontend changes (`agency-os-dashboard/`)

### Routing

The Site Detail page already exists (or needs to be added if it doesn't — verify first). Add a sub-route or section: when a project is opened, the Brief Studio is the default view inside Site Detail.

URL pattern: `/sites/:projectId/brief-studio` (or whatever matches existing routing conventions).

### Brief Studio page

**Empty state** (when no master brief exists):

- Topbar with breadcrumb `Sites › {Project Name}` and `Brief Studio` heading
- Tier badge upper right
- 4-stat row with 3 muted stats and 1 active (`Tier 3 monthly target`)
- Yellow callout card (`brief-studio-empty-state.html` design) with the "+ Generate Master Brief" button
- Matrix skeleton card with locked overlay
- Right sidebar: Status Legend, Quick Actions (most disabled), Data Sources

**Active state** (master brief exists):

- Same topbar / stats / sidebar
- Replace empty callout with master brief card (yellow left border, "Master Brief · v{N} · Updated {timestamp}" header, TBD checklist inline if any TBDs remain — NO Edit, NO Regenerate, NO View History buttons). Card body is a 2-3 line summary. Click anywhere on the card opens it in the right-side Brief Editor panel.
- Replace matrix skeleton with populated matrix from `/api/projects/:projectId/matrix`. Each cell shows label, status color, and a click handler that either (a) opens an existing brief in the editor panel, or (b) triggers brief generation if status === 'planned'.
- Right sidebar's Quick Actions become enabled

### Right-side Brief Editor panel

Slides in from the right (~460px wide, matching `brief-studio-mockup.html`). Has two variants:

**Master brief variant:**
- Header: title "Master Brief" + close button
- Meta strip (replaces the status bar): version chip (`v3`) + last-updated timestamp + TBD count chip
- Body: rendered markdown with `[TBD: ...]` tokens shown as clickable yellow tags. Click a TBD → inline input opens at that token → save replaces the token with entered value, decrements `tbd_count`.
- Footer: Copy button only. No Mark as Pasted/Complete (those don't apply to master brief).

**Page brief variant:**
- Header: title (`Water Heater · Cleveland` or whatever the page is) + close button
- Status bar with 3 steps: Briefed → Pasted → Complete. (Original mockup had 4 — drop "Pasted" since we have 3 statuses.)
   - **Wait — re-reading: we settled on three statuses `planned → briefed → complete`. "Pasted" was dropped. Use three-step bar: Planned → Briefed → Complete.** Confirm with me if you read this differently.
- Body: rendered markdown with TBD tokens, same inline-fill behavior as master
- Footer: Save edits · Copy · Mark as Complete (sets `status='complete'` and `completed_at=now`)

### Master Brief Modal

The modal is **already built in the app**. Wire the empty-state callout's "+ Generate Master Brief" button to open it. The modal's submit action should:
1. Save form data to `projects`, `brand_attributes`, `testimonials` (via existing or new endpoints)
2. Call `POST /api/projects/:projectId/briefs/master`
3. On success, close modal, refresh the Brief Studio page → it renders the active state

### Sites tab list

The Sites tab list view (separate from Site Detail) should:
- Show MRR per project: sum of project tier monthly amounts
- Show pages-this-month progress
- Each card links to `/sites/:projectId/brief-studio`

Remove tier-gating logic if present anywhere in the Sites tab list.

### Remove

- Remove the Build tab from the dashboard nav.
- Remove any "Queue for Cowork" buttons, Cowork status indicators (e.g., the green pulsing dot in the header), and "handed off to Cowork" copy throughout the app.

---

## Build phases

Do these in order. Stop at each checkpoint.

### Phase 1 — Master brief prompt in isolation

Build `masterBrief.ts` and a one-off test script that hand-feeds Beno Plumbing test data and runs the prompt. Print output to console. Do not touch the schema, routes, or UI in this phase. Show me the output. We iterate until quality matches the Apex example.

**Checkpoint:** I review 1-2 sample briefs and confirm quality.

### Phase 2 — Schema + brief routes

Run migrations locally, build the new `briefs.ts`, `brand-attributes.ts`, `testimonials.ts`, `matrix.ts` routes. Test with curl. No frontend yet.

**Checkpoint:** I verify endpoints work with sample data.

### Phase 3 — Brief Studio page (empty state)

Build the Brief Studio page in its empty state. Wire the existing master brief modal to the callout button. On modal submit, generate the master brief and reload to active state.

**Checkpoint:** I generate a master brief for a real project (Beno or another lead from my pipeline) and confirm the active state renders.

### Phase 4 — Matrix + page brief generation

Build the populated matrix from the master brief data. Implement page brief generation on cell click. Open in right-side editor panel.

**Checkpoint:** I generate a homepage brief, then a service-area brief, and confirm both come out at the right length and tone.

### Phase 5 — Brief editor panel + TBD inline fill

Build the right-side editor panel for both master and page brief variants. Implement TBD inline-fill behavior.

**Checkpoint:** I edit a brief, fill TBDs inline, and confirm changes persist.

### Phase 6 — Cleanup

Remove the Build tab, all Cowork theater (status indicators, queue buttons, "handed off" copy). Audit the app for stale references. Deploy.

---

## Rules of the road

- **Communicate before destructive ops.** Any DB migration on remote, any file deletion, any force-push — confirm first.
- **Don't add npm dependencies without asking.**
- **Don't touch the Reports tab or any Search Console / PageSpeed code.**
- **After each phase, summarize what changed in 3-5 bullets.** Wait for confirmation before next phase.
- **Honest assessments preferred.** If something in this brief is wrong or contradicts something in the codebase, say so. Don't silently work around it.
- **If you're confident about small choices** (variable names, file structure within a phase, etc.), make the call and tell me what you decided.

Start by checking out the branch, reading both mockup files, and showing me your Phase 1 plan.
