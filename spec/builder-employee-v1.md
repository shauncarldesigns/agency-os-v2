# Builder Employee v1

The Builder Employee is an explicitly started bulk queue worker. When the
operator presses **Start Builder**, Agency OS snapshots every eligible lead
currently in `awaiting_build`, then converts them to `ready_to_send` one at a
time by creating LandingSite.ai demos and returning their preview URLs.

## Boundary

Agency OS owns lead data, brief generation, tracking URL creation, pipeline
transitions, and outreach. The local Node.js employee owns only browser
automation and the raw demo URL. It uses a dedicated persistent Chrome profile
and stores no LandingSite credentials.

## LandingSite workflow

1. Open `https://app.landingsite.ai` and verify the **New Website** control.
2. If absent, display the login-required message and wait for the operator.
3. Click **New Website**.
4. Fill **Business Name** from the lead's company.
5. Fill **Business Description** from `pipeline_brief`.
6. Click **Create Your Website**.
7. Wait for the preview anchor `a[target="_blank"][href$=".agcy.dev"]`.
8. Capture its `href`, click it, and check that exact preview URL.
9. While it shows **Getting your preview ready** or **Preview not found**,
   reload and recheck the same URL. Return it when the real site appears.

No fixed generation delay is used. Recoverable failures retry up to three
times. A failed lead never stops the remaining queue. A non-recoverable failure
stays failed until the operator retries it; only login, browser availability,
LandingSite availability, or a system-wide interface change pauses the run.

Pause and Stop are safe-point controls: an active website finishes before the
employee stops claiming work. The dedicated dashboard separates employee,
run, and job state and displays health checks, brief readiness, current-build
progress, detailed job results, diagnostics, live events, median/24-hour
metrics, and run history. Leads entering Awaiting Build after Start are not
added to that run.

## Email-first intake

Email-bearing leads with no existing website enter Email Outreach's Awaiting
Build lane before any call. Start Builder asks Agency OS to generate missing
`pipeline_brief` values, then snapshots the ready jobs. Builder completion
already schedules email automation when a valid email exists, so no call
outcome is required to build or begin the email sequence.

## Runtime

- Queue and audit: D1 `builder_jobs`
- Live activity: D1 `builder_events`
- Pause/login/heartbeat state: D1 `builder_control`
- Builder API: `/api/builder-worker/*`, dedicated bearer token
- Operator API: `/api/builder/*`, normal dashboard authentication
- Process: `builder-worker/`, one headed persistent Playwright context
- Failure artifacts: screenshot, trace, and Playwright video
