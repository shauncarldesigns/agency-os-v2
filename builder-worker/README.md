# Builder Employee

Single-process, headed Playwright employee for LandingSite.ai. It uses its own
persistent Chrome profile, never the operator's normal browser profile.

## Setup

1. Apply `2026-08-10-builder-employee.sql` to D1.
2. Generate a random token and set the same value as the Worker secret
   `BUILDER_API_TOKEN` and in this directory's `.env.local`.
3. Run `npm install` and `npm run install-browser`.
4. Run `npm start`. The dedicated Chrome window opens. Sign in to
   LandingSite.ai once; credentials are not stored by Agency OS.

The worker fills the two creation fields exactly as LandingSite presents them:

- **Business Name** ← lead company
- **Business Description** ← Agency OS pipeline brief

It waits on visible LandingSite state, captures failure screenshots and traces
under `artifacts/`, and retries recoverable failures up to three attempts.
