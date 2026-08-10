import assert from 'node:assert/strict';
import { applySmsDeliveryStatus, routeSmsFailureToEmail } from '../src/services/messaging.ts';

const fixtureLead={
  id:991001,
  company:'Disposable Messaging Fixture',
  email:'fixture@shauncarldesigns.com',
  site_url:'https://fixture.example.com',
  deleted_at:null,
  pipeline_status:'ready_to_send',
  phone_line_type:'landline',
  sms_suppressed:0,
  phone_route:'text',
};
const state={lead:{...fixtureLead},activities:[],automation:null};

class FixtureStatement{
  constructor(sql){this.sql=sql.replace(/\s+/g,' ').trim();this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){
    if(this.sql.includes('SELECT * FROM leads'))return this.args[0]===state.lead.id?{...state.lead}:null;
    if(this.sql.includes('SELECT id, sent_at FROM email_sends'))return null;
    throw new Error(`Unhandled fixture first(): ${this.sql}`);
  }
  async run(){
    if(this.sql.startsWith('UPDATE leads SET sms_suppressed=1')){
      assert.equal(this.args[1],state.lead.id);
      state.lead.sms_suppressed=1;
      state.lead.sms_suppression_reason=this.args[0];
      state.lead.phone_route='call';
      return {meta:{changes:1}};
    }
    if(this.sql.startsWith('INSERT INTO lead_activity')){
      state.activities.push({leadId:this.args[0],action:'sms_routed_to_email',meta:JSON.parse(this.args[3])});
      return {meta:{changes:1}};
    }
    if(this.sql.startsWith('INSERT INTO email_automations')){
      state.automation={leadId:this.args[0],status:'active',currentStep:this.args[1],nextRunModifier:this.args[3]};
      return {meta:{changes:1}};
    }
    throw new Error(`Unhandled fixture run(): ${this.sql}`);
  }
}

const env={DB:{prepare(sql){return new FixtureStatement(sql);}}};
const reason='30006: Landline destination';
const routed=await routeSmsFailureToEmail(env,state.lead.id,reason);

assert.equal(routed,true);
assert.equal(state.lead.sms_suppressed,1);
assert.equal(state.lead.phone_route,'call');
assert.equal(state.lead.sms_suppression_reason,reason);
assert.deepEqual(state.activities,[{leadId:state.lead.id,action:'sms_routed_to_email',meta:{reason}}]);
assert.deepEqual(state.automation,{leadId:state.lead.id,status:'active',currentStep:'review_wait',nextRunModifier:'+10 minutes'});

const testMessageEnv={DB:{prepare(sql){
  const normalized=sql.replace(/\s+/g,' ').trim();
  return {
    bind(){return this;},
    async first(){
      if(normalized.includes('FROM messaging_messages message'))return {id:77,twilio_status:'sent',twilio_error_code:null,twilio_error_description:null,lead_id:fixtureLead.id,is_test:1};
      throw new Error(`Unexpected test-message query: ${normalized}`);
    },
    async run(){
      if(normalized.startsWith('UPDATE messaging_messages'))return {meta:{changes:1}};
      throw new Error(`Test delivery status attempted to mutate a lead: ${normalized}`);
    },
  };
}}};
const testDelivery=await applySmsDeliveryStatus(testMessageEnv,'SM-test','failed','30006','Landline destination');
assert.deepEqual(testDelivery,{matched:true,duplicate:false,routedToEmail:false});

console.log(JSON.stringify({ok:true,fixtureLeadId:state.lead.id,smsSuppressed:true,phoneRoute:'call',emailAutomation:'active',testFailureLeadMutation:'blocked',fixturePersisted:false},null,2));
