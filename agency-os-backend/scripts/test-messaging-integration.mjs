import assert from 'node:assert/strict';

const base=(process.env.MESSAGING_API_URL||'http://127.0.0.1:8788').replace(/\/$/,'');
const apiKey=process.env.MESSAGING_API_KEY||'';
if(!apiKey)throw new Error('Set MESSAGING_API_KEY to the local dashboard API key.');

async function request(path,{method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{'X-API-Key':apiKey,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const payload=await response.json().catch(()=>({}));
  return {response,payload};
}

const testPhone=`+1555${String(Date.now()).slice(-7)}`;

const status=await request('/api/messaging/status');
assert.equal(status.response.status,200);
assert.equal(status.payload.control.mode,'test');
assert.equal(status.payload.control.transport,'mock');

const duplicate=await request('/api/messaging/simulate',{
  method:'POST',body:{scenario:'duplicate',body:'Who is this?',testPhone},
});
assert.equal(duplicate.response.status,200);
assert.equal(duplicate.payload.duplicatePrevented,true);

const duplicateStatus=await request('/api/messaging/simulate',{
  method:'POST',body:{scenario:'status_duplicate',testPhone},
});
assert.equal(duplicateStatus.response.status,200);
assert.equal(duplicateStatus.payload.first.duplicate,false);
assert.equal(duplicateStatus.payload.second.duplicate,true);

const network=await request('/api/messaging/simulate',{
  method:'POST',body:{scenario:'network_error',testPhone},
});
assert.equal(network.response.status,200);
const transientRetry=await request(`/api/messaging/messages/${network.payload.messageId}/retry`,{method:'POST',body:{}});
assert.equal(transientRetry.response.status,200);
assert.equal(transientRetry.payload.message.twilio_status,'delivered');

const permanent=await request('/api/messaging/simulate',{
  method:'POST',body:{scenario:'failed',testPhone},
});
assert.equal(permanent.response.status,200);
const permanentRetry=await request(`/api/messaging/messages/${permanent.payload.messageId}/retry`,{method:'POST',body:{}});
assert.equal(permanentRetry.response.status,400);
assert.match(permanentRetry.payload.error,/permanent SMS failure/i);

const optout=await request('/api/messaging/simulate',{
  method:'POST',body:{scenario:'optout',testPhone},
});
assert.equal(optout.response.status,200);
const detail=await request(`/api/messaging/conversations/${optout.payload.conversationId}`);
assert.equal(detail.response.status,200);
assert.equal(detail.payload.conversation.status,'closed');
assert.equal(detail.payload.conversation.needs_human,0);

const blockedSend=await request(`/api/messaging/conversations/${optout.payload.conversationId}/send`,{
  method:'POST',body:{body:'This must remain blocked.'},
});
assert.equal(blockedSend.response.ok,false);
assert.equal(blockedSend.response.status,400);
assert.match(blockedSend.payload.error,/opted out/i);

const notInterestedPhone=`+1555${String(Date.now()+4).slice(-7)}`;
const notInterested=await request('/api/messaging/simulate',{
  method:'POST',body:{scenario:'inbound',body:'Not interested.',testPhone:notInterestedPhone},
});
assert.equal(notInterested.response.status,200);
const notInterestedDetail=await request(`/api/messaging/conversations/${notInterested.payload.conversationId}`);
assert.equal(notInterestedDetail.payload.conversation.status,'closed');
assert.equal(notInterestedDetail.payload.conversation.needs_human,0);
assert.equal(notInterestedDetail.payload.messages.filter(message=>message.sent_by==='ai').length,0);

const unsafeReset=await request('/api/messaging/test-data',{
  method:'DELETE',body:{confirm:'wrong'},
});
assert.equal(unsafeReset.response.status,400);

const resetKeep=await request('/api/messaging/simulate',{
  method:'POST',body:{scenario:'inbound',body:'Keep this conversation',testPhone:`+1555${String(Date.now()+2).slice(-7)}`},
});
const resetTarget=await request('/api/messaging/simulate',{
  method:'POST',body:{scenario:'inbound',body:'Reset this conversation',testPhone:`+1555${String(Date.now()+3).slice(-7)}`},
});
const resetOne=await request(`/api/messaging/conversations/${resetTarget.payload.conversationId}/test-data`,{
  method:'DELETE',body:{confirm:'RESET_TEST_CONVERSATION'},
});
assert.equal(resetOne.response.status,200);
assert.equal(resetOne.payload.deletedConversationId,resetTarget.payload.conversationId);
const deletedDetail=await request(`/api/messaging/conversations/${resetTarget.payload.conversationId}`);
assert.equal(deletedDetail.response.status,404);
const keptDetail=await request(`/api/messaging/conversations/${resetKeep.payload.conversationId}`);
assert.equal(keptDetail.response.status,200,'Resetting one test conversation must preserve other test conversations');

const unsignedInbound=await fetch(`${base}/webhooks/twilio/sms/inbound`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'From=%2B15555550100&To=%2B15555550101&Body=Hello&MessageSid=SM-unsigned'});
assert.equal(unsignedInbound.status,403);
const unsignedStatus=await fetch(`${base}/webhooks/twilio/sms/status`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'MessageSid=SM-unsigned&MessageStatus=delivered'});
assert.equal(unsignedStatus.status,403);

const aiTestPhone=`+1555${String(Date.now()+1).slice(-7)}`;
const scripts=await request('/api/messaging/scripts');
assert.equal(scripts.response.status,200);
const whoScript=scripts.payload.scripts.find(script=>script.script_key==='who_is_this');
assert.ok(whoScript,'who_is_this script must exist');
let aiConversationId;
try{
  const approve=await request('/api/messaging/scripts/who_is_this',{
    method:'PUT',body:{body:'This is Shaun with Shaun Carl Designs.',approved:true},
  });
  assert.equal(approve.response.status,200);
  const start=await request('/api/messaging/control',{method:'POST',body:{action:'start'}});
  assert.equal(start.response.status,200);

  const activeReply=await request('/api/messaging/simulate',{
    method:'POST',body:{scenario:'inbound',body:'Who is this?',testPhone:aiTestPhone},
  });
  aiConversationId=activeReply.payload.conversationId;
  let aiDetail=await request(`/api/messaging/conversations/${aiConversationId}`);
  const activeAiCount=aiDetail.payload.messages.filter(message=>message.sent_by==='ai').length;
  assert.equal(activeAiCount,1,'Active AUTO conversation should send one approved AI reply');

  const takeOver=await request(`/api/messaging/conversations/${aiConversationId}/action`,{
    method:'POST',body:{action:'take_over'},
  });
  assert.equal(takeOver.response.status,200);
  await request('/api/messaging/simulate',{
    method:'POST',body:{scenario:'inbound',body:'Who is this?',testPhone:aiTestPhone},
  });
  aiDetail=await request(`/api/messaging/conversations/${aiConversationId}`);
  assert.equal(aiDetail.payload.messages.filter(message=>message.sent_by==='ai').length,activeAiCount,'Human takeover must block AI replies');

  await request(`/api/messaging/conversations/${aiConversationId}/action`,{
    method:'POST',body:{action:'return_to_ai'},
  });
  const pause=await request('/api/messaging/control',{method:'POST',body:{action:'pause'}});
  assert.equal(pause.response.status,200);
  await request('/api/messaging/simulate',{
    method:'POST',body:{scenario:'inbound',body:'Who is this?',testPhone:aiTestPhone},
  });
  aiDetail=await request(`/api/messaging/conversations/${aiConversationId}`);
  assert.equal(aiDetail.payload.messages.filter(message=>message.sent_by==='ai').length,activeAiCount,'Paused employee must block AI replies');
}finally{
  await request('/api/messaging/scripts/who_is_this',{
    method:'PUT',body:{body:whoScript.body||'',approved:whoScript.approved===1},
  });
  await request('/api/messaging/control',{method:'POST',body:{action:'stop'}});
}

console.log(JSON.stringify({
  ok:true,
  testPhone,
  duplicatePrevented:true,
  duplicateStatusPrevented:true,
  transientRetry:'delivered',
  permanentRetry:'blocked',
  optedOutConversation:'closed',
  optedOutSend:'blocked',
  notInterestedConversation:'closed-without-rebuttal',
  unsafeReset:'blocked',
  singularReset:'preserved-other-conversations',
  unsignedWebhooks:'blocked',
  activeAutoReply:'sent',
  humanTakeoverReply:'blocked',
  pausedReply:'blocked',
  scriptRestored:true,
},null,2));
