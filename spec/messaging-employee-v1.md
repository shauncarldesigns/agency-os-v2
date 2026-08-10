# Messaging Employee + Communications Center — Implementation Plan

_Last updated: 2026-08-10_

## Branch and handoff

- Working branch: `codex/messaging-employee`
- Status: local implementation and mock-mode validation in progress; not committed,
  migrated remotely, deployed, or connected to Twilio.
- This branch was cut from `dcf4027` because the shared worktree contained
  unrelated Builder changes. `origin/main` had advanced to `04c6da9` when the
  branch was created. Before committing or opening the Messaging PR, preserve
  the Messaging changes, move the branch onto current `origin/main`, resolve
  integration changes, then rerun the verification checklist below.
- Never stage the unrelated `builder-worker/src/index.mjs` or
  `agency-os-backend/src/prompts/pipelineBrief.ts` changes as part of the
  Messaging commit unless their owner explicitly asks to combine them.

## Objective

Add one Messaging Employee that executes the existing Text Outreach workflow,
receives Twilio replies and status callbacks, stores complete SMS threads,
uses controlled approved response rules, and escalates conversations to Shaun.
The existing lead, pipeline, tracking URL, Clarity, and Email Outreach systems
remain authoritative.

The Communications page must remain usable for manual reading and replies when
automation is off or paused.

## Non-negotiable routing rule

SMS is mobile-only. If Twilio Lookup identifies a landline, fixed VoIP, or
non-fixed VoIP number—or Twilio returns a permanent invalid/bad-number delivery
failure—the lead is suppressed from SMS. If it has a valid email and built demo,
schedule the existing Email Outreach automation. Do not create a second email
cadence or duplicate lead/contact record.

Test mode must never mutate the linked lead's pipeline or SMS suppression state.
A simulated STOP closes only the test conversation. A real signed Twilio STOP
closes the conversation and suppresses the lead.

## Implemented locally

### Backend and data

- Migrations: `agency-os-backend/src/db/migrations/2026-08-10-messaging-employee.sql`
  and `2026-08-10-messaging-playbook-scripts.sql`, applied in that order.
- Canonical schema synchronized in `agency-os-backend/src/db/schema.sql`.
- Added lead suppression fields and messaging tables:
  `messaging_control`, `messaging_conversations`, `messaging_messages`,
  `messaging_ai_audit`, and `messaging_scripts`.
- Public, Twilio-signature-validated endpoints:
  - `POST /webhooks/twilio/sms/inbound`
  - `POST /webhooks/twilio/sms/status`
- Protected operator endpoints under `/api/messaging/*` for employee status,
  control, conversations, manual sends, scripts, simulator, test send, and queue
  execution.
- Mock and live Twilio transports use the same send path.
- Synchronous provider failures are persisted before the error is returned, so
  the failed attempt remains visible in Communications.
- Initial outbound messages use the existing `/r/:lead_id` tracking redirect.
- Initial-send idempotency keys are scoped by `test` versus `production` so a
  mock send can never block or satisfy a real send.
- Queue processing is sequential, rate-limited, and isolates individual failures.
- Ready counts and queue execution use the same canonical
  `services/outreachEligibility.ts` predicate as current Text Outreach, excluding
  not-interested leads, existing projects, and booked/held/rescheduled demos.
- STOP/opt-out, permanent failure routing, human takeover, manual suppression,
  delivery status, intent classification, script approval gates, and AI audit
  logging are implemented.
- Low-risk approved scripts may auto-send only when employee status is active,
  the conversation is `AUTO`, and SMS is not opted out. Unapproved, pricing,
  unknown, technical, call-request, and strong-interest replies escalate.

### Dashboard

- Main navigation page: `Communications`.
- Employee status/counters and Start, Pause, Resume, Stop controls.
- Explicit Test/Production and Mock/Live Twilio selectors.
- Conversation filters: All, Unread, Needs Shaun, AI Handling, Human Handling,
  Failed, and Opted Out.
- Thread view with direction, sender, timestamps, delivery state, and errors.
- Failed conversations retain a visible Failed badge even if a later message is
  delivered. Transient failures can be manually retried; permanent bad-number,
  landline, and VoIP failures reject retry and keep the email-routing guidance.
- Manual composer, Take Over/Return to AI, Needs Shaun controls, suppression,
  lead context, tracked demo link, setup checklist, script editor, and simulator.
- Production selection is rejected until the server reports required Twilio and
  A2P configuration complete, and Production can never be paired with Mock
  transport.

## Local test evidence

The local migration was applied and the dev stack was run at:

- Dashboard: `http://127.0.0.1:5174`
- Worker: `http://127.0.0.1:8788`

Validated through the actual dashboard UI:

- Communications page loads and reads the authenticated local API.
- Simulated price question becomes Needs Shaun.
- Manual mock reply is stored and displayed as delivered.
- Mock queue sends the canonical initial text with `/r/:lead_id`.
- Repeating the queue reports the action as skipped and does not duplicate it.
- Test and production idempotency keys are isolated.
- Simulated STOP appears under Opted Out, does not enter Needs Shaun, does not
  auto-reply, and does not suppress the linked lead.
- Simulated not-interest closes the thread without a rebuttal, AI reply, or
  Needs Shaun task, matching the existing Text Outreach archive path.
- Production mode remains locked when Twilio/A2P setup is incomplete.
- Setup UI shows HTTPS webhook URLs and all missing configuration.
- Canonical scripts show their Text Outreach or Call Center source; intentional
  terminal paths are visibly marked `NO AUTO-REPLY`.
- Simulator scenarios cover inbound, opt-out, duplicate webhook, delivered,
  bad-number/landline failure, and provider network error.
- Duplicate webhook simulation confirms the second delivery is ignored.
- Duplicate delivery-status simulation confirms the second callback is ignored;
  status claiming uses an atomic conditional D1 update so concurrent duplicate
  callbacks cannot both append Email Outreach routing activity.
- Transient failure retry creates a delivered mock message; permanent failure
  retry returns 400 with Email Outreach guidance.
- `npm run test:messaging` passes six deterministic rule groups covering phone
  normalization, required intent classification, STOP, permanent failure
  recognition, tracked-link personalization, and valid-versus-tampered Twilio
  webhook signatures. The same command runs a disposable routing fixture through
  the production service functions and proves a landline/permanent failure
  suppresses SMS, changes the phone route to Call, logs the routing activity,
  and creates the existing active Email Outreach automation without persisting
  fixture data. It also proves a permanent delivery failure on a test
  conversation cannot mutate its linked lead.
- `npm run test:messaging:integration` passes against the local Worker using an
  isolated test phone. It verifies duplicate inbound idempotency, transient
  retry, permanent retry blocking, opt-out closure, blocked sends after opt-out,
  reset-confirmation protection, Active/AUTO approved replies, Human Takeover,
  Paused behavior, singular conversation reset, rejection of unsigned public
  webhooks, and restoration of the temporarily approved test script.
- The complete Messaging patch was reconstructed on a clean detached worktree
  at current `origin/main` (`04c6da9`). Backend typecheck, rule/routing tests,
  dashboard build, and the full API integration runner all pass on that base.
  Current main's newer Builder-aware `outreachEligibility.ts` was retained.
- The conversation-panel reset deletes only the selected `is_test=1` thread and
  its messages/audits, and only while mode is Test and transport is Mock. The
  backend's global test-data cleanup remains guarded and is not exposed from the
  conversation panel.
- Backend `npx tsc --noEmit`, dashboard `npm run build`, and `git diff --check`
  pass. Vite reports only the existing large-chunk warning.

The Messaging Employee was returned to `off` after testing.

## Remaining implementation work

### 1. Rebase and regression check

- Move this branch onto current `origin/main` before committing.
- A clean integration rehearsal on `04c6da9` passed without code conflicts; the
  final branch move is deliberately deferred to commit preparation because the
  shared worktree still contains unrelated uncommitted Builder changes.
- Messaging uses the shared `services/outreachEligibility.ts` Text predicate.
  During the final branch move retain current main's newer Builder-aware version
  rather than the older working-tree copy or a Messaging-specific duplicate.
- Confirm the current Builder and Email build-first behavior still schedules the
  correct channel after the rebase.

### 2. Follow-up eligibility

The existing app does not currently expose a server-side “follow-up due now”
marker. The employee therefore executes only `ready_to_send` initial messages.
Do not invent a timer. Add automated follow-up execution only after the existing
pipeline exposes canonical due/action data; then reuse `followed_up` and the
approved `follow_up` script with a separate idempotency key per touch.

### 3. Canonical script sources

Messaging does not introduce a separate copywriting system. Script rows reuse
the existing Text Outreach composers, Call Center playbook, and follow-up
sequence, with `source_reference` shown in Communications. Initial, follow-up,
identity, explanation, existing-website, later-follow-up, and missing-link copy
can auto-send only where the intent rules already permit it. Pricing, positive
interest, and call requests still escalate to Shaun even though the existing
playbook response is available as context. A clear not-interested response
closes the thread and archives the production lead without a rebuttal; STOP also
suppresses SMS. Human escalation has no invented automatic acknowledgment.

### 4. Twilio external setup

Configure server-side only:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID`
- `TWILIO_PHONE_NUMBER`
- `TEST_SMS_NUMBER_1` (Shaun's mobile; optionally `TEST_SMS_NUMBER_2`)
- `TWILIO_A2P_REGISTERED=true` only after Twilio confirms registration

In Twilio, add the dedicated sender to the Messaging Service and configure:

- Incoming messages:
  `https://try.shauncarldesigns.com/webhooks/twilio/sms/inbound`
- Status callback:
  `https://try.shauncarldesigns.com/webhooks/twilio/sms/status`

Do not enable Production merely because credentials exist. Complete the live
test-number round trip first: test send, delivery callback, inbound reply,
threading, human takeover, approved auto-reply, and STOP.

### 5. Commit, migration, deployment, and verification

1. Stage only the Messaging allowlist below plus intentional docs.
2. Commit on `codex/messaging-employee`, push, and open one PR.
3. Merge the PR to `main`; Worker deploys automatically.
4. Apply both D1 migrations manually, in order, only after the merged backend is ready:
   `cd agency-os-backend && npx wrangler d1 execute agency-os-v2 --remote --file=src/db/migrations/2026-08-10-messaging-employee.sql`
   then
   `npx wrangler d1 execute agency-os-v2 --remote --file=src/db/migrations/2026-08-10-messaging-playbook-scripts.sql`
5. Confirm Worker deploy success and call `/api/messaging/status`.
6. Manually deploy the dashboard:
   `cd agency-os-dashboard && npm run deploy`
7. Verify the production apex with a cache-busted HTML/assets request.
8. Keep mode Test until the live Twilio test-number checklist passes.
9. Only then consider switching to Production; begin with one controlled lead,
   confirm the callback/thread/pipeline transition, then expand gradually.

## Messaging commit allowlist

- `AGENTS.md`
- `CHANGELOG.md`
- `HANDOFF.md`
- `spec/messaging-employee-v1.md`
- `agency-os-backend/src/db/schema.sql`
- `agency-os-backend/src/db/migrations/2026-08-10-messaging-employee.sql`
- `agency-os-backend/src/db/migrations/2026-08-10-messaging-playbook-scripts.sql`
- `agency-os-backend/src/index.ts`
- `agency-os-backend/package.json`
- `agency-os-backend/scripts/test-messaging-integration.mjs`
- `agency-os-backend/src/routes/leads.ts`
- `agency-os-backend/src/routes/messaging.ts`
- `agency-os-backend/src/services/messaging.ts`
- `agency-os-backend/src/services/messagingRules.ts`
- `agency-os-backend/src/services/outreachEligibility.ts`
- `agency-os-backend/src/services/twilioLookup.ts`
- `agency-os-backend/src/types.ts`
- `agency-os-backend/tests/messagingRules.test.ts`
- `agency-os-backend/tests/messagingRouting.fixture.mjs`
- `agency-os-backend/wrangler.toml`
- `agency-os-dashboard/src/App.tsx`
- `agency-os-dashboard/src/components/communications/CommunicationsPage.tsx`
- `agency-os-dashboard/src/components/layout/AppShell.tsx`
- `agency-os-dashboard/src/lib/api.ts`
- `agency-os-dashboard/src/lib/types.ts`

Before staging, inspect every allowlisted diff because `HANDOFF.md`, `api.ts`,
and other shared files may also contain newer unrelated work after rebasing.
Update `CHANGELOG.md` only as part of the shipping PR, following repository
conventions.

## Final production acceptance checklist

- Initial text sends once and contains the tracked URL.
- Follow-up sends once only after canonical existing eligibility exists.
- Twilio SID and delivery state persist; failures are visible.
- Invalid/landline/VoIP failures suppress SMS and hand eligible leads to Email
  Outreach without stopping the queue.
- Duplicate inbound and status callbacks are idempotent.
- Unknown numbers are stored safely without creating duplicate leads.
- STOP immediately suppresses real SMS and never receives an AI response.
- Manual reply works while employee is off/paused, except opted-out threads.
- Human takeover prevents AI sends until explicit Return to AI.
- Unknown/unapproved/low-confidence behavior routes to Needs Shaun.
- Test mode never contacts or mutates real prospects.
- Production remains locked until configuration and live test readiness pass.
