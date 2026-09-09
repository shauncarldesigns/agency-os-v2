# Automated Receptionist — Desktop Test Checklist

Use synthetic names, phone numbers, and emails while the integration remains in local/mock mode.

## 1. Website-call pivot

- Open an Email Outreach lead in **To Call**.
- Choose the website-decline path, then pivot to the automated receptionist script.
- Verify the script advances through interest, irony, and demo-offer decisions without repeating itself.
- For an interested caller, enter an email and finish the receptionist-interest action.
- Expected: the lead is marked `Not interested` for the website, removed from the email board, not archived/deleted, and appears under **Businesses interested in a demo**.
- Repeat with **Still not interested**. Expected: the archive confirmation appears and the lead does not enter the receptionist list.

## 2. Personalized profile and demo routing

- Open **Automated Receptionist**, choose the interested business, and click **Prepare Voice Demo**.
- Edit the business name, greeting, services, service area, hours, and business rules; save and refresh.
- Expected: all values persist and the simulator uses the edited business identity.
- Enter your own caller ID and activate the profile for 30 minutes.
- Expected: the active-until indicator appears. Use **Reset demos**, then verify it disappears.
- Use **Test fallback**. Expected: it resolves to the dedicated internal test profile—not a prospect profile.

## 3. Receptionist behavior

- Run one conversation each for: new customer, existing customer, emergency, normal after-hours lead, cold salesperson, and uncertain caller.
- Expected: questions are asked one at a time; it never invents prices, coverage, availability, records, response times, troubleshooting, shutoff steps, or safety instructions.
- Expected: cold sales/spam is screened; uncertain callers are treated as possible customers; emergencies are marked urgent without claiming a transfer.
- Run the six-case QA suite in rules mode. Expected: 6/6 and a saved history row with prompt version `voice-receptionist-v1.7`.
- Optional: explicitly enable the OpenAI preview and repeat using synthetic information only. Expected: 6/6; inspect the saved case details.

## 4. Calls, Voice Leads, and alerts

- Save a completed new-customer simulation as a call.
- Expected: it appears in **Recent demo calls**, creates a separate **Voice Lead**, and creates a simulated `new_lead` notification.
- Edit the call classification/outcome/summary and mark the review Passed or Needs work.
- Expected: review values persist and changing to sales/spam updates the linked Voice Lead accordingly.
- On the Voice Lead, edit status, estimated value, confirmed revenue, and notes.
- Expected: values persist after refresh and won revenue updates when status/revenue are saved.
- Retry a simulated notification. Expected: it stays `simulated` locally and no real email is sent.
- Click **Failed transfer** in mock mode. Expected: a failed-transfer call and simulated alert appear; retrying it remains simulated and sends no email.

## 5. Retell setup package

- Select a voice profile and click **Review Retell setup**. Expected: current edits save first and the preflight reports either ready, blockers, or missing information to review.
- Expand **Retell configuration details**, then download the JSON package.
- Open the JSON and confirm it contains the chosen company name, greeting example, prompt version, dynamic variables, analysis fields, webhook URLs, and manual setup list.
- Expected: it does **not** contain an API key or private transfer destination.

## 6. Operational recovery and retention

- Click **System preflight**. Expected: profile, fallback routing, number separation, demo-session references, and all voice storage tables pass.
- In **Webhook recovery**, click **Create retry fixture**. Expected: one synthetic failed `call_analyzed` event appears.
- Click **Retry event**. Expected: the failure disappears and a recovered call, Voice Lead, and simulated notification are created exactly once.
- In **Voice-data retention**, confirm the retained/expired/next-expiration metrics load, then click **Run cleanup now**. Expected: expired transcript and recording content is cleared while aggregate call records remain.

## Retell account and live-call setup

- Click **Inspect Retell account**. Expected: authentication succeeds and the current agent/phone inventory appears without changing Retell.
- Expected inventory before purchasing a number: **Agency OS Service Business Receptionist** and the untouched **Shaun Carl Designs Scheduler**, both drafts; zero phone numbers.
- In Retell, open the receptionist draft and use **Test LLM** with synthetic customer, existing-customer, emergency, applicant, sales, and spam conversations. Confirm the `{{greeting}}` fallback resolves to Lakeside Plumbing & Drain and questions are asked one at a time.
- Use **Test Audio** after the LLM cases pass. Check pronunciation, interruptions, pauses, keypad recognition, and whether the agent ends screened sales calls naturally.
- Confirm the API key and receptionist agent ID are present server-side. Add the shared phone number only after test-panel QA passes.
- Click **Test Retell connection**. Expected: both agent and number validate.
- Activate one business for your caller ID and call the shared number from that phone.
- Expected: the correct company greeting is used; another phone receives the internal fallback profile.
- Place customer, sales, emergency, and incomplete calls. Verify signed webhook events, transcripts/summaries, post-call fields, Voice Leads, and alert delivery.
- After transfers are deliberately enabled, force one cancelled/failed connection. Expected: Retell's `transfer_cancelled` event creates a failed-transfer alert that can be retried from Notification delivery.
- Confirm recordings and related application data follow the 30-day retention policy.
- Keep live transfers disabled until intake and routing pass consistently.

## Before emailing a shared demo number

- Do not rely on the current 30-minute caller-ID activation for an asynchronous invitation.
- Add expiring Agency OS demo invitations, a unique short access code, a Retell lookup function, and a neutral invalid/expired-code fallback.
- Verify two outstanding invitations can call in either order and each receives only its own frozen business profile.
- Verify calling from an unexpected or blocked number still works with the access code.
- Verify an expired, malformed, or reused code cannot reveal the most recently activated prospect.
