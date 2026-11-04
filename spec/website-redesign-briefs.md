# Website redesign briefs

Website Briefs lives under Work, between Clients & Sites and Design Library. It prepares prospect-level LandingSite briefs without creating projects or enrolling leads in outreach.

## Entry points

- Add Lead → Google Business Profile retains the Places search/import flow, including the website supplied by Google. Search results distinguish businesses with and without a listed website.
- Add Lead → Website URL imports a published HTTP(S) URL with an optional company name. The hostname is used until a company name is supplied. Imports start outside outreach. Matching website hosts (ignoring www, scheme, and path) return the existing lead; trashed matches must be restored first.
- Pipeline → Create redesign brief appears only for a lead with a nonempty website URL. The server independently validates the URL before creating a brief.
- Website Briefs can also import a URL or select an existing lead with a website. Each lead has one saved redesign workspace.

## Workflow

1. Scan website content using the existing project website scraper: homepage and up to three linked internal pages. Review the extracted brand facts and captured source text. Failed rescans preserve previous usable evidence.
2. Capture colors & fonts using the Design Library's desktop/mobile capture queue. The worker records computed colors, accent candidates, font families, heading scales, layout, and header/nav logo references. Capture-only design records are hidden from Design Library and never trigger its reusable recipe generation.
3. Review measured candidates. Edit the colors/fonts to retain and supply redesign direction or factual corrections. CSS frequency is evidence, not proof of an approved brand identity.
4. Save, generate, edit, and copy a LandingSite redesign brief. Generation requires a successful content scan. Reviewed values and operator direction take precedence over measured candidates. Website content is treated as source evidence, never instructions.

The existing source URL stays separate from any demo URL. This feature does not change existing-website exclusions in the email/text build-first outreach flows.

## Release and verification

Apply `agency-os-backend/src/db/migrations/2026-11-04-website-briefs.sql` to an existing database before deploying the backend/dashboard. The full schema includes the equivalent structure for fresh databases. This migration adds a purpose column to design references and a website_briefs table.

Brand captures require the connected Builder Employee worker with browser control enabled. Restart/update the worker to include accent and logo measurements. Content scans and brief generation use the existing Claude integration and do not depend on the browser worker. The scraper uses HTML fetching, so a JavaScript-only or blocked website can fail and reports that failure.

Checks: backend type-check, dashboard production build, worker syntax check, and `npm run test:website-briefs` in agency-os-backend (Node 22 with experimental SQLite). Route tests use in-memory SQLite and mocked website/model responses; browser QA uses local fixtures. Live scraping/model output and production deployment are separate verification steps.
