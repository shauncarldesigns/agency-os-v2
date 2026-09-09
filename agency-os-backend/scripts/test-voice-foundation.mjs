import assert from 'node:assert/strict';
import { verifyRetellSignature } from '../src/services/retellSignature.ts';
import { normalizePhone, voiceDynamicVariables } from '../src/services/voiceDemo.ts';
import { buildAgentInstructions, simulateReceptionistTurn, voicePolicyFromConfiguration } from '../src/services/voiceAgent.ts';

const key = 'retell_test_key';
const raw = '{"event":"call_ended","call":{"call_id":"call_test"}}';
const timestamp = Date.now();
const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const digest = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(raw + timestamp)));
const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');

assert.equal(await verifyRetellSignature(raw, `v=${timestamp},d=${hex}`, key, timestamp), true);
assert.equal(await verifyRetellSignature(`${raw} `, `v=${timestamp},d=${hex}`, key, timestamp), false);
assert.equal(await verifyRetellSignature(raw, `v=${timestamp - 360_000},d=${hex}`, key, timestamp), false);
assert.equal(normalizePhone('(920) 555-0199'), '+19205550199');

const variables = voiceDynamicVariables({
  demoSessionId: 22,
  prospectId: 31,
  profile: {
    id: 4, lead_id: 31, business_name: 'Acme Plumbing', business_phone: '+19205550100',
    timezone: 'America/Chicago', greeting: 'Thanks for calling Acme Plumbing.',
    services_text: 'Plumbing', service_area_text: 'Green Bay', hours_text: '8–5',
    default_mode: 'intake_only', transfer_enabled: 0, emergency_transfer_enabled: 0,
    private_transfer_destination: null, public_phone_number: null,
    retell_agent_id: null, retell_agent_version: null,
  },
});
assert.equal(variables.business_name, 'Acme Plumbing');
assert.equal(variables.demo_session_id, '22');
assert.equal(variables.transfer_enabled, 'false');
assert.ok(Object.values(variables).every((value) => typeof value === 'string'));

const defaultPolicy = voicePolicyFromConfiguration('{invalid');
assert.equal(defaultPolicy.solicitationMessages, false);
assert.deepEqual(defaultPolicy.requiredIntakeFields, ['callerName', 'callbackNumber', 'requestedService', 'location', 'urgency', 'preferredTiming']);
const customPolicy = voicePolicyFromConfiguration(JSON.stringify({ requiredIntakeFields: ['callerName', 'callerEmail', 'notAField'], solicitationMessages: true }));
assert.deepEqual(customPolicy.requiredIntakeFields, ['callerName', 'callerEmail']);
assert.equal(customPolicy.solicitationMessages, true);

const liveInstructions = buildAgentInstructions({ businessName: 'Acme Plumbing', services: 'Plumbing', serviceArea: 'Green Bay', hours: '8–5' });
assert.match(liveInstructions, /Ask exactly one question at a time/);
assert.match(liveInstructions, /Never combine name, callback number, location, urgency, timing/);
assert.match(liveInstructions, /Do not ask hypothetical questions/);
assert.match(liveInstructions, /existing customer only when they explicitly say so/);
assert.match(liveInstructions, /A confirmation is a question and must occupy its own turn/);
assert.match(liveInstructions, /Did I get that right/);
assert.match(liveInstructions, /without a pause between the number and A\.M\. or P\.M\./);
assert.match(liveInstructions, /Always deliver the complete opening greeting/);
assert.match(liveInstructions, /After three consecutive failed attempts/);
assert.match(liveInstructions, /Never classify, reject, screen, or end a call merely because speech was unclear/);
assert.match(liveInstructions, /Speak at a normal conversational pace/);
assert.match(liveInstructions, /name no more than three broad, relevant services/);
assert.match(liveInstructions, /Pronounce every service clearly/);

const sales = simulateReceptionistTurn({
  businessName: 'Acme Plumbing', services: 'Plumbing', history: [],
  message: 'I am calling to sell you an SEO package.', classification: 'unknown', intake: {},
});
assert.equal(sales.classification, 'cold_sales');
assert.equal(sales.outcome, 'screened');
assert.equal(sales.complete, true);
assert.equal(sales.intake.callerName, undefined);

const salesMessage = simulateReceptionistTurn({
  businessName: 'Acme Plumbing', services: 'Plumbing', history: [],
  message: 'I am calling to sell you an SEO package.', classification: 'unknown', intake: {},
  businessRules: JSON.stringify({ solicitationMessages: true }),
});
assert.equal(salesMessage.classification, 'cold_sales');
assert.equal(salesMessage.outcome, 'message_taken');
assert.equal(salesMessage.complete, false);

const emailRequired = simulateReceptionistTurn({
  businessName: 'Acme Plumbing', services: 'Plumbing', history: [], message: 'I need plumbing help.',
  classification: 'new_customer', intake: { callerName: 'Pat' },
  businessRules: JSON.stringify({ requiredIntakeFields: ['callerName', 'callerEmail'] }),
});
assert.match(emailRequired.reply, /email address/i);

const existing = simulateReceptionistTurn({ businessName: 'Acme Plumbing', services: 'Plumbing', history: [], message: 'I am an existing customer calling about last week.', classification: 'unknown', intake: {} });
assert.equal(existing.classification, 'existing_customer');
const unprovenExisting = simulateReceptionistTurn({ businessName: 'Acme Plumbing', services: 'Plumbing', history: [], message: 'My water heater is leaking and I need someone Friday.', classification: 'unknown', intake: {} });
assert.equal(unprovenExisting.classification, 'new_customer');
assert.equal(existing.intake.callerName, undefined);
const emergency = simulateReceptionistTurn({ businessName: 'Acme Plumbing', services: 'Plumbing', history: [], message: 'This is an emergency. A pipe burst.', classification: 'unknown', intake: {} });
assert.equal(emergency.classification, 'emergency');
assert.equal(emergency.intake.callerName, undefined);

const customer = simulateReceptionistTurn({
  businessName: 'Acme Plumbing', services: 'Plumbing', history: [],
  message: 'My name is Pat and I need an estimate for a repair. Call me at 920-555-0198.',
  classification: 'unknown', intake: {},
});
assert.equal(customer.classification, 'new_customer');
assert.equal(customer.intake.callerName, 'Pat');
assert.equal(customer.intake.callbackNumber, '920-555-0198');
assert.match(customer.reply, /city or ZIP/i);

console.log('Voice foundation tests passed');
