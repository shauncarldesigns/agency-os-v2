# Call Sales Intelligence

## Purpose

Turn every saved outreach call recording into an evidence-backed transcript,
individual call report, and eventually reliable patterns across the call
library. This feature remains attached to `call_log` and `leads`; it is not a
separate CRM.

## Current rollout state

- One local two-speaker test (`Prime Plumbing Engaged`, call 52) completed and
  was manually judged accurate.
- Every new successful recording upload is automatically queued when
  `CALL_INTELLIGENCE_ENABLED=true`.
- Historical recordings are queued only through the authenticated **Analyze
  existing recordings** action. Do not bulk backfill production until the
  first live-call pilot is reviewed.
- Aggregate findings are directional until approximately 20 varied calls have
  been manually reviewed.
- No business decisions are automated from analysis output.

## Architecture

1. `POST /api/recordings` preserves audio in R2 and creates a placeholder
   `call_log` row.
2. A unique `(call_id, prompt_version)` D1 job is enqueued.
3. The request returns without waiting for transcription or analysis.
4. An immediate `executionCtx.waitUntil()` kick processes the common case.
5. The existing five-minute cron recovers queued or abandoned work. Locks older
   than four minutes are reclaimed; saved transcripts are reused on retry.
6. OpenAI `gpt-4o-transcribe-diarize` returns speaker segments and timestamps.
7. The first speaker is currently assigned to Shaun because recordings are
   operator-initiated outbound calls. This assignment must remain visible and
   correctable in a future QA iteration.
8. Claude produces versioned structured JSON. Server validation normalizes
   confidence representations and rejects unsupported output.
9. Validated JSON is stored intact; proven fields are normalized into
   `call_analysis_facts` for reporting.
10. Sales Intelligence shows processing status, individual reports,
    transcripts, aggregate outcomes, and evidence-backed findings.

## Important files

### Backend

- `agency-os-backend/src/services/callIntelligence.ts` — enqueue, transcription,
  processing, retry, normalized facts.
- `agency-os-backend/src/services/callAnalysisSchema.ts` — runtime validation.
- `agency-os-backend/src/prompts/callAnalysis.ts` — prompt/schema/model versions.
- `agency-os-backend/src/routes/callIntelligence.ts` — process, retry, report,
  backfill, insights, and operator/AI outcome reconciliation.
- `agency-os-backend/src/routes/recordings.ts` — automatic enqueue after upload.
- `agency-os-backend/src/routes/calls.ts` — automatic enqueue after orphan attach.
- `agency-os-backend/src/index.ts` — routes and five-minute recovery processing.
- `agency-os-backend/src/db/migrations/2026-08-28-call-intelligence.sql` — D1
  tables and indexes.

### Dashboard

- `agency-os-dashboard/src/components/intelligence/SalesIntelligencePage.tsx`
  — primary review and aggregate view.
- `agency-os-dashboard/src/components/pipeline/CallLogTab.tsx` — lead-level
  report, transcript, retry, and reanalysis.
- `agency-os-dashboard/src/lib/api.ts` and `src/lib/types.ts` — client contracts.

## Configuration and secrets

Non-secret Worker variables in `wrangler.toml`:

- `CALL_INTELLIGENCE_ENABLED=true`
- `CALL_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize`

Required Worker secrets:

- `OPENAI_API_KEY` — transcription only.
- `CLAUDE_API_KEY` — structured call analysis (existing app secret).

Never place either key in source, Wrangler variables, logs, screenshots, or
client-side environment files. Local values belong in gitignored `.dev.vars`.

## Database and deployment order

The migration is manual and must be applied before deploying backend code:

```bash
cd agency-os-backend
npx wrangler d1 execute agency-os-v2 --remote \
  --file=src/db/migrations/2026-08-28-call-intelligence.sql
```

If the call-approach work is part of the same release, apply first:

```bash
npx wrangler d1 execute agency-os-v2 --remote \
  --file=src/db/migrations/2026-08-27-call-approach.sql
```

Then merge the backend PR; CI deploys the Worker. The dashboard is not
git-integrated and must be deployed manually only after operator approval:

```bash
cd agency-os-dashboard
npm run deploy
```

## Outcome reconciliation

Keep these values separate:

- **Operator outcome**: the action Shaun clicked after the call.
- **Transcript outcome**: the result inferred from recorded evidence.

The insights response labels each completed call `matched`, `mismatch`, or
`unclear`. The UI displays both values. The model never overwrites the operator
outcome. Add mappings only after real workflow values appear; do not guess a
large taxonomy in advance.

## QA plan

Review approximately 20 calls spanning:

- Short rejection
- Voicemail and gatekeeper
- Successful email capture
- Multiple objections
- Longer discovery or sales call
- Interruptions
- Poor audio
- Unclear outcome

For each call verify:

- Correct Shaun/prospect assignment
- Transcript accuracy and timestamps
- Operator/transcript outcome agreement
- No invented needs, objections, reactions, or outcomes
- Evidence for important conclusions
- Purpose-aware scoring
- Specific rather than generic coaching

Track errors by category: speaker identification, transcription, invented
conclusion, missed objection, incorrect outcome, generic coaching, or UI issue.

## Known limitations and remaining work

### Before trusting aggregate conclusions

- Complete and document the 20-call QA set.
- Add an explicit Reviewed Accurate / Needs Correction control and correction
  notes so QA status is stored rather than remembered informally.
- Refine outcome mappings using real operator actions.
- Verify percentage denominators honor every active Insights filter.
- Add links from aggregate evidence to the exact call report and timestamp.

### Product improvements after QA

- Correct Shaun/prospect assignment when a recording begins late or the
  prospect speaks first.
- Add date, industry, pipeline stage, product, call type, and opener filters to
  the UI (backend support is currently partial).
- Add analysis-version history without counting reanalysis as another call.
- Add editable follow-up message and persist operator edits.
- Add explicit recording consent/disclosure state if the calling workflow
  begins tracking it.
- Choose and implement a time-based retention policy. Current behavior retains
  R2 recordings; transcript and analysis rows cascade with `call_log` deletion.
- Add focused automated tests for schema validation, idempotent enqueue,
  recovery, outcome reconciliation, and aggregate denominators.
- Add charts only after the structured fields prove useful.

## Operational notes

- A recording with no detectable speaker segments is shown as **No speech
  detected** and is not offered an endless retry loop.
- Analysis retries reuse a saved transcript; they do not retranscribe audio.
- Reanalysis remains the same call and must not inflate aggregate call counts.
- Failed jobs retain their error and attempt count. Recordings are never deleted
  because processing failed.
- The first live rollout should process new recordings only. Use production
  backfill deliberately after reviewing early live results and expected cost.
