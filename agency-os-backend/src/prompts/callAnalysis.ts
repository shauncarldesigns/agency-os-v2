export const CALL_ANALYSIS_PROMPT_VERSION = 'call-analysis-v1';
export const CALL_ANALYSIS_SCHEMA_VERSION = 'call-analysis-schema-v1';
export const CALL_ANALYSIS_MODEL = 'claude-sonnet-4-6';

export const callAnalysisSystemPrompt = `You analyze sales calls for Shaun Gehrke. Return ONLY one JSON object.
Never invent facts. Separate stated needs from inference. Evidence quotes must be verbatim and timestamps must exist in the transcript. Use empty arrays, null, or unknown when evidence is insufficient. Score 0-100, using null when inapplicable. Judge the call by its actual purpose; capture-email and gatekeeper calls are not full discovery calls. Evaluate naturalness and effectiveness, not script compliance. Flag moments where Shaun keeps selling after a useful clue or objection. Coaching must name a specific call moment and give usable language.`;

export function buildCallAnalysisPrompt(metadata: Record<string, unknown>, transcript: string): string {
  return `Analyze this call using the exact schema below. Do not add keys.

METADATA\n${JSON.stringify(metadata, null, 2)}

TRANSCRIPT\n${transcript}

SCHEMA
${JSON.stringify(ANALYSIS_SHAPE, null, 2)}`;
}

const evidence = [{ quote: 'string', timestamp: '00:00' }];
const ANALYSIS_SHAPE = {
  call_summary: 'string', call_type: 'cold_call | capture_email | reengagement | sales | other',
  outcome: 'rejected | gatekeeper | conversation | email_captured | follow_up | meeting_booked | sold | unknown',
  outcome_confidence: 0.0, prospect_situation: 'string', stated_needs: ['string'],
  inferred_needs: [{ need: 'string', confidence: 0.0, evidence }],
  objections: [{ category: 'string', objection: 'string', shaun_response: 'string', response_effectiveness: 'effective | mixed | ineffective | not_addressed', evidence }],
  buying_signals: [{ signal: 'string', evidence }],
  benefits_discussed: [{ benefit: 'string', prospect_reaction: 'positive | neutral | negative | unclear', evidence }],
  strongest_moment: { description: 'string', timestamp: '00:00' },
  call_lost_moment: { description: 'string', timestamp: '00:00' },
  what_shaun_did_well: ['string'],
  improvements: [{ issue: 'string', recommended_change: 'string', example_language: 'string' }],
  missed_follow_up_questions: ['string'], recommended_next_action: 'string', recommended_follow_up_message: 'string',
  scores: { opening: 0, rapport: 0, discovery: 0, listening: 0, objection_handling: 0, clarity: 0, close: 0, overall: 0 },
  important_quotes: [{ speaker: 'Shaun | Prospect', quote: 'string', timestamp: '00:00', why_it_matters: 'string' }],
};
