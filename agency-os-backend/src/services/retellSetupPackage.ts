import { buildAgentInstructions, VOICE_AGENT_PROMPT_VERSION } from './voiceAgent';
import { voiceDynamicVariables, type VoiceProfileRow } from './voiceDemo';

const CLASSIFICATIONS = ['new_customer', 'existing_customer', 'emergency', 'personal_vip', 'vendor', 'applicant', 'cold_sales', 'spam', 'unknown'];

export function buildRetellSetupPackage(profile: VoiceProfileRow) {
  const dynamicVariables = voiceDynamicVariables({ profile, demoSessionId: null, prospectId: profile.lead_id });
  // The variable must exist in Retell, but an exported setup file should never
  // carry the business's private destination. It is supplied only at call time.
  dynamicVariables.transfer_destination = '';
  const checks = [
    { key: 'business_name', label: 'Business name', ready: Boolean(profile.business_name.trim()), severity: 'blocker' },
    { key: 'greeting', label: 'Opening greeting', ready: Boolean(profile.greeting.trim()), severity: 'blocker' },
    { key: 'services', label: 'Services offered', ready: Boolean(profile.services_text.trim()), severity: 'warning' },
    { key: 'service_area', label: 'Service area', ready: Boolean(profile.service_area_text.trim()), severity: 'warning' },
    { key: 'hours', label: 'Business hours', ready: Boolean(profile.hours_text.trim()), severity: 'warning' },
    { key: 'transfers', label: 'Transfers disabled for initial test', ready: profile.transfer_enabled !== 1 && profile.emergency_transfer_enabled !== 1, severity: 'blocker' },
  ] as const;
  return {
    generatedAt: new Date().toISOString(),
    promptVersion: VOICE_AGENT_PROMPT_VERSION,
    profile: {
      id: profile.id,
      kind: profile.profile_kind,
      businessName: profile.business_name,
      timezone: profile.timezone,
      greeting: profile.greeting,
    },
    preflight: {
      ready: checks.every((check) => check.severity !== 'blocker' || check.ready),
      blockers: checks.filter((check) => check.severity === 'blocker' && !check.ready).map((check) => check.label),
      warnings: checks.filter((check) => check.severity === 'warning' && !check.ready).map((check) => check.label),
      checks,
    },
    retellAgent: {
      agentName: 'Agency OS Automated Receptionist',
      openingMessage: '{{greeting}}',
      generalPrompt: buildAgentInstructions({
        businessName: '{{business_name}}',
        services: '{{services}}',
        serviceArea: '{{service_area}}',
        hours: '{{business_hours}}',
        businessRules: '{{business_rules}}',
      }, { dynamicPolicy: true }),
      dynamicVariables: Object.entries(dynamicVariables).map(([name, exampleValue]) => ({ name, exampleValue })),
      recommendedSettings: {
        language: 'en-US',
        voice: 'Choose any natural US English voice during the Retell meeting',
        transferCalls: false,
        beginMessageDelayMs: 300,
        reminder: 'Keep transfer tools disabled for the first internal test.',
      },
    },
    postCallAnalysis: [
      { name: 'caller_classification', type: 'enum', values: CLASSIFICATIONS, description: 'Best classification for the caller.' },
      { name: 'caller_name', type: 'text', description: 'Caller name, or blank if not provided.' },
      { name: 'callback_number', type: 'text', description: 'Best callback number, or blank if not provided.' },
      { name: 'caller_email', type: 'text', description: 'Caller email, or blank if not provided.' },
      { name: 'service_requested', type: 'text', description: 'The service or reason for calling.' },
      { name: 'location', type: 'text', description: 'Service city, address, or ZIP as supplied.' },
      { name: 'urgency', type: 'text', description: 'Emergency, urgent, normal, or unknown.' },
      { name: 'preferred_timing', type: 'text', description: 'When the caller wants contact or service.' },
      { name: 'final_outcome', type: 'enum', values: ['callback_requested', 'screened', 'message_taken', 'incomplete'], description: 'How the call concluded.' },
    ],
    webhooks: {
      inboundCall: 'https://agency-os-v2-api.lively-morning-d9de.workers.dev/webhooks/retell/inbound',
      callEvents: 'https://agency-os-v2-api.lively-morning-d9de.workers.dev/webhooks/retell/events',
      subscribedEvents: ['call_started', 'call_ended', 'call_analyzed', 'transfer_started', 'transfer_bridged', 'transfer_cancelled', 'transfer_ended'],
      verification: 'Agency OS verifies X-Retell-Signature with the server-side RETELL_API_KEY, following Retell webhook documentation.',
    },
    manualSetupChecklist: [
      'Use the dedicated Agency OS Service Business Receptionist; never repurpose the Shaun Carl Designs Scheduler.',
      'Synchronize the prompt, {{greeting}} opening message, and listed dynamic variables with npm run retell:provision:receptionist.',
      'Add the listed post-call analysis fields with the exact names shown.',
      'After test-panel QA passes, connect a Retell-managed shared demo number to the receptionist agent for inbound calls.',
      'Configure both webhook URLs and subscribe to every listed event, including transfer_cancelled.',
      'Copy the agent ID, phone number, and API key into the Worker secrets/configuration.',
      'Run the Agency OS connection test, then the desktop and live-call checklists.',
    ],
    privacy: {
      applicationRetentionDays: 30,
      note: 'This export contains configuration examples only. It never includes the Retell API key or private transfer number.',
    },
  };
}
