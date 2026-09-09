# Automated Receptionist — Phase 1 Integration Note

## Purpose

This first slice proves the Agency OS-to-Retell boundary with a dedicated shared demo number. The API key, draft receptionist, and Retell-managed number are configured; production remains gated on deployed signed webhooks and a real inbound smoke test.

## Ownership

- Agency OS sales prospects remain in `leads`.
- Signed and internal businesses remain in `projects`.
- A voice profile may link to either record, while the dedicated internal test profile links to neither.
- Calls made by a customer's callers are stored in `voice_calls`; they are never inserted into the Agency OS sales pipeline.

## Personalized demo resolution

`Prepare Voice Demo` creates a lead-linked profile populated from the company's existing enrichment data. Shaun can edit the business name, greeting, services, service area, and hours before activation.

For the immediate, operator-controlled MVP, activation snapshots that profile for 30 minutes and associates it with Shaun's caller ID. The Retell inbound webhook resolves the active caller-ID session and returns the snapshot as string-only dynamic variables. If no active session matches, it uses the internal test profile. If no safe fallback or agent ID exists, it returns no override rather than exposing another prospect's data.

### Pinned architecture decision: asynchronous emailed demos

Caller-ID activation is a temporary testing mechanism, not the final emailed-demo architecture. A prospect may call hours or days after receiving the demo number, and another prospect may have been prepared in the meantime. A single globally active profile would therefore risk presenting the wrong business identity.

Before emailed demos are enabled, Agency OS must own an immutable demo invitation:

- One shared Retell demo number may serve many prospects.
- Each invitation receives a short, unique access code and a 30-day expiration.
- Retell collects spoken or keypad input and calls an Agency OS lookup function.
- Agency OS resolves the code to a frozen profile snapshot and returns only that snapshot as dynamic variables.
- Caller-ID recognition may skip the code when it matches unambiguously, but the code remains the fallback.
- Invalid, expired, ambiguous, or malformed lookups must fall back to a neutral demo or end safely; they must never expose the most recently activated prospect.
- Each lookup and call records the invitation/profile relationship for attribution and debugging.
- Paying customers use a dedicated number or their connected telephony and never enter a demo code.

The access-code directory is an Agency OS capability built on Retell custom functions and dynamic variables; it is not assumed to be a native Retell demo-code product.

### Pinned architecture decision: reusable agent and industry presets

Maintain one service-business receptionist behavior core. Plumbing, HVAC, construction, landscaping, and similar variants are Agency OS profile presets containing business facts and industry-specific intake defaults, not independent Retell agents. Create a separate Retell agent only when behavior, compliance, isolation, or routing requirements materially differ.

## Security and retention

- Both Retell webhook endpoints verify `X-Retell-Signature` against the exact raw body using the server-side API key.
- Retell uses the public `workers.dev` hostname for these two endpoints because Cloudflare Access protects the custom API domain before requests reach the Worker.
- Lifecycle events use unique deduplication keys before updating a call.
- Dashboard Voice APIs remain behind the existing `/api/*` authentication.
- Full transcripts and recording references are removed after the profile's retention window (30 days by default). Aggregate call fields remain for reporting.
- Transfers are disabled until a private destination distinct from the public Retell number is configured.

## Retell production setup

1. Keep the separate Agency OS receptionist agent assigned to the shared number; do not repurpose the Shaun Carl Designs Scheduler.
2. Keep outbound calling and transfers disabled for the initial inbound pilot.
3. Deploy `RETELL_DEFAULT_AGENT_ID`, `RETELL_SHARED_PHONE_NUMBER`, and live mode with the Worker; keep `RETELL_API_KEY` secret.
4. Register `/webhooks/retell/inbound` and `/webhooks/retell/events`.
5. Verify the signed webhook path and complete a real inbound smoke test before sending the number to prospects.

## Retell account status (verified September 7, 2026)

- `RETELL_API_KEY` is present locally and in Cloudflare Worker secrets; a read-only authentication check succeeds.
- The account exposes one draft voice agent, **Shaun Carl Designs Scheduler** (`retell-Cimo`). It has not been repurposed, published, or selected as the receptionist agent.
- Retell-managed number **+1 (920) 764-8610** is assigned inbound to the Agency OS receptionist; outbound calling remains disabled.
- Agency OS includes read-only account discovery so this inventory can be refreshed without exposing the API key.

## MVP Retell resource (created September 8, 2026)

- Draft voice agent: **Agency OS Service Business Receptionist** (`agent_2bff6d65c5e1fd0f36c1f33e57`, V0).
- Response engine: `llm_fc4fbf18daa259b0269a7ba868c2` using the Agency OS `voice-receptionist-v1.6` prompt contract.
- Default test persona: **Lakeside Plumbing & Drain**. These are fallback test values, not a separate plumber-specific behavior fork.
- Business identity, services, service area, hours, operating mode, transfer policy, and attribution identifiers are dynamic variables.
- Voice: `retell-Cimo`; language: US English; transfers disabled; unpublished.
- The existing **Shaun Carl Designs Scheduler** remains untouched.

## Current local capabilities

- Customer and emergency calls create separate Voice Leads with lifecycle status, estimated value, confirmed revenue, and notes.
- Completed simulations can be saved, reviewed, and corrected; classification corrections synchronize the linked Voice Lead.
- Prompt-versioned QA runs, alert-delivery records, webhook health, demo reset, and fallback checks are visible in the Receptionist workspace.
- Failed webhook events retain their original payload and can be replayed from the dashboard with a five-attempt safety limit.
- Voice-data retention has daily cleanup plus operator-visible counts and a manual cleanup action.
- Each profile can generate a secret-free Retell setup package with a preflight, prompt, dynamic variables, analysis fields, webhook URLs, and manual configuration steps.

## Deliberately deferred

Knowledge-base synchronization, warm transfers, booking, production customer routing, and asynchronous access-code invitations are later slices. The database and service boundary are designed to add them without mixing customer callers into the sales CRM.
