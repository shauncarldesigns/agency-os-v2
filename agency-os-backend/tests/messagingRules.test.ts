import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyInbound,
  isPermanentSmsFailure,
  normalizePhone,
  personalize,
  twilioSignatureValid,
} from '../src/services/messagingRules.ts';

test('normalizes common US phone formats', () => {
  assert.equal(normalizePhone('(920) 555-1212'), '+19205551212');
  assert.equal(normalizePhone('1-920-555-1212'), '+19205551212');
});

test('classifies the required controlled intents', () => {
  const cases: Array<[string,string]> = [
    ['Looks good. How much?', 'PRICE_QUESTION'],
    ['Can you call me?', 'WANTS_CALL'],
    ['Who is this?', 'WHO_IS_THIS'],
    ['What is this?', 'WHAT_IS_THIS'],
    ['I already have a website.', 'ALREADY_HAS_WEBSITE'],
    ['Not interested.', 'NOT_INTERESTED'],
    ['Maybe next month.', 'FOLLOW_UP_LATER'],
    ['I never got the link.', 'DID_NOT_RECEIVE_LINK'],
    ['Looks good, I want it.', 'POSITIVE_INTEREST'],
    ['random unrecognized response', 'UNKNOWN'],
    ['STOP', 'STOP_OR_OPTOUT'],
  ];
  for (const [message,intent] of cases) assert.equal(classifyInbound(message).intent,intent,message);
});

test('STOP bypasses conversational scripts and escalation', () => {
  const result=classifyInbound('STOP');
  assert.equal(result.scriptKey,null);
  assert.equal(result.escalate,false);
  assert.equal(result.confidence,1);
});

test('recognizes permanent bad-number, landline, and VoIP failures', () => {
  assert.equal(isPermanentSmsFailure('21211',null),true);
  assert.equal(isPermanentSmsFailure('30006','Landline destination'),true);
  assert.equal(isPermanentSmsFailure(null,'Fixed VoIP cannot receive SMS'),true);
  assert.equal(isPermanentSmsFailure(null,'Temporary provider timeout'),false);
});

test('personalizes approved tokens with the tracked redirect', () => {
  const lead={company:'Uptown HVAC',contact:'Dana Smith',site_url:'https://raw.example'} as Parameters<typeof personalize>[1];
  assert.equal(
    personalize('Hi [Name] at [Company]: [demo link]',lead,'https://try.shauncarldesigns.com/r/4'),
    'Hi Dana at Uptown HVAC: https://try.shauncarldesigns.com/r/4',
  );
});

test('validates Twilio webhook signatures and rejects tampering', async () => {
  const token='local-test-auth-token';
  const url='https://try.shauncarldesigns.com/webhooks/twilio/sms/inbound';
  const params=new URLSearchParams({From:'+19205550100',To:'+19205550101',Body:'Who is this?',MessageSid:'SM-test'});
  const sorted=[...params.entries()].sort(([a],[b])=>a.localeCompare(b));
  let data=url;
  for(const [key,value] of sorted)data+=key+value;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data));
  const signature=btoa(String.fromCharCode(...new Uint8Array(signed)));
  const request=new Request(url,{method:'POST',headers:{'X-Twilio-Signature':signature}});
  assert.equal(await twilioSignatureValid(request,token,params),true);
  params.set('Body','tampered');
  assert.equal(await twilioSignatureValid(request,token,params),false);
});
