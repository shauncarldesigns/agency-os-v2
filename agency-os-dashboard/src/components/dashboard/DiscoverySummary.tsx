import { useMemo, useState, useEffect } from 'react';
import type { QuestionCallAnswer } from '../../lib/playbook';

// Shown inline in the Question-oriented panel at the Summary stage. It
// derives a confirmation script from explicit answer metadata only, then
// lets the operator edit before reading it back.

interface DiscoverySummaryProps {
  answers: QuestionCallAnswer[];
  onCopyToNotes: (line: string) => void;
}

export function DiscoverySummary({ answers, onCopyToNotes }: DiscoverySummaryProps) {
  const generatedSummary = useMemo(() => buildDiscoverySummary(answers), [answers]);
  const answerSignature = useMemo(() => summarizeSignature(answers), [answers]);

  const [summaryText, setSummaryText] = useState(generatedSummary);
  const [manualEdit, setManualEdit] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState(answerSignature);

  useEffect(() => {
    if (answerSignature === lastSignature) return;
    setLastSignature(answerSignature);
    if (!manualEdit) {
      setSummaryText(generatedSummary);
      setPendingText(null);
    } else if (generatedSummary !== summaryText) {
      setPendingText(generatedSummary);
    }
  }, [answerSignature, generatedSummary, lastSignature, manualEdit, summaryText]);

  const hasAnswers = answers.some((a) => a.summaryField);

  return (
    <div className="cockpit-discovery-summary">
      <div className="cockpit-discovery-header">
        <span className="cockpit-discovery-title">DISCOVERY SUMMARY</span>
        <span className="cockpit-discovery-hint">Built from selected answers</span>
      </div>

      {!hasAnswers ? (
        <div className="cockpit-discovery-empty">
          No discovery answers recorded yet.
        </div>
      ) : (
        <div className="cockpit-discovery-fields">
          {summaryRows(answers).map((row) => (
            <div className="cockpit-discovery-row" key={row.label}>
              <span className="cockpit-discovery-row-label">{row.label}</span>
              <span className="cockpit-discovery-row-value">{row.value || '-'}</span>
            </div>
          ))}
        </div>
      )}

      {pendingText && (
        <div className="cockpit-discovery-pending">
          <span>Earlier answers changed. Regenerate the summary?</span>
          <button
            type="button"
            className="cockpit-btn"
            onClick={() => {
              setSummaryText(pendingText);
              setPendingText(null);
              setManualEdit(false);
            }}
          >
            Regenerate
          </button>
        </div>
      )}

      <div className="cockpit-discovery-confirm">
        <div className="cockpit-discovery-confirm-label">Summary text</div>
        <textarea
          className="cockpit-discovery-confirm-body"
          value={summaryText}
          onChange={(e) => {
            setSummaryText(e.target.value);
            setManualEdit(true);
            setPendingText(null);
          }}
          rows={4}
          placeholder="Answer the discovery questions and this will draft itself."
        />
        <div className="cockpit-discovery-confirm-actions">
          <button
            type="button"
            className="cockpit-btn"
            onClick={() => {
              setSummaryText(generatedSummary);
              setManualEdit(false);
              setPendingText(null);
            }}
            disabled={!manualEdit && summaryText === generatedSummary}
            title="Regenerate from selected answers"
          >
            Regenerate from answers
          </button>
          <button
            type="button"
            className="cockpit-btn-primary"
            onClick={() => onCopyToNotes(`[SUMMARY] ${summaryText}`)}
            disabled={!summaryText.trim()}
          >
            Copy to notes
          </button>
        </div>
      </div>
    </div>
  );
}

type SummaryBuckets = Record<NonNullable<QuestionCallAnswer['summaryField']>, QuestionCallAnswer[]>;

function buildBuckets(answers: QuestionCallAnswer[]): SummaryBuckets {
  const buckets: SummaryBuckets = {
    lead_source: [],
    customer_next_step: [],
    customer_looks_for: [],
    missing_information: [],
    repeated_questions: [],
    current_process_assessment: [],
  };
  for (const answer of answers) {
    if (answer.summaryField) buckets[answer.summaryField].push(answer);
  }
  return buckets;
}

function latestLabel(items: QuestionCallAnswer[]): string {
  const item = items.at(-1);
  return item ? phraseFor(item) : '';
}

function joinedLabels(items: QuestionCallAnswer[]): string {
  const labels = Array.from(new Set(items.map((item) => phraseFor(item)).filter(Boolean)));
  return joinHuman(labels);
}

function summaryRows(answers: QuestionCallAnswer[]): Array<{ label: string; value: string }> {
  const buckets = buildBuckets(answers);
  return [
    { label: 'Lead source', value: latestLabel(buckets.lead_source) },
    { label: 'Customer next step', value: latestLabel(buckets.customer_next_step) },
    { label: 'Customer looks for', value: joinedLabels(buckets.customer_looks_for) },
    { label: 'Missing information', value: joinedLabels(buckets.missing_information) },
    { label: 'Repeated questions', value: joinedLabels(buckets.repeated_questions) },
    { label: 'Current process', value: latestLabel(buckets.current_process_assessment) },
  ];
}

function buildDiscoverySummary(answers: QuestionCallAnswer[]): string {
  const buckets = buildBuckets(answers);
  const leadSourceValue = buckets.lead_source.at(-1)?.summaryValue;
  const nextStepValue = buckets.customer_next_step.at(-1)?.summaryValue;
  const leadSource = latestLabel(buckets.lead_source);
  const nextStep = latestLabel(buckets.customer_next_step);
  const looksFor = joinedLabels(buckets.customer_looks_for);
  const missing = joinedLabels(buckets.missing_information);
  const repeated = joinedLabels(buckets.repeated_questions);
  const assessment = latestActionPhrase(buckets.current_process_assessment);

  if (leadSourceValue === 'referrals' && (nextStepValue === 'google_business' || nextStepValue === 'some_look_up')) {
    return 'So it sounds like most business comes from referrals, and people check you out online before calling. Is that accurate?';
  }

  const sentences: string[] = [];
  if (leadSource) sentences.push(`most of your new customers come through ${leadSource}`);
  if (nextStep && looksFor) {
    sentences.push(`after someone gets your name, ${nextStep}, and they are usually looking for ${looksFor}`);
  } else if (nextStep) {
    sentences.push(`after someone gets your name, ${nextStep}`);
  } else if (looksFor) {
    sentences.push(`when people look you up, they are usually looking for ${looksFor}`);
  }
  if (missing) sentences.push(`the main things you would want them to find are ${missing}`);
  else if (repeated) sentences.push(`customers sometimes still ask about ${repeated}`);
  if (assessment) sentences.push(assessment);

  if (sentences.length === 0) return '';
  return `So it sounds like ${joinHuman(sentences)}. Is that accurate?`;
}

function latestActionPhrase(items: QuestionCallAnswer[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const phrase = actionPhraseFor(items[i]);
    if (phrase) return phrase;
  }
  return '';
}

function phraseFor(answer: QuestionCallAnswer): string {
  const value = answer.summaryValue ?? '';
  const maps: Record<string, Record<string, string>> = {
    lead_source: {
      referrals: 'referrals',
      google: 'Google',
      social: 'Facebook or social media',
      repeat_customers: 'repeat customers',
      paid_leads: 'paid lead services',
      mixed: 'a mix of sources',
      not_sure: 'an unclear mix of sources',
    },
    customer_next_step: {
      call_immediately: 'they call right away',
      most_call_immediately: 'most people call right away',
      some_look_up: 'some people probably look you up before calling',
      google_business: 'they look the business up on Google',
      check_reviews: 'they check reviews',
      look_on_facebook: 'they look on Facebook',
      ask_referrer: 'they ask the person who referred them',
      contact_directly: 'they contact you directly',
      google_after_social: 'they Google you afterward',
      browse_posts_photos: 'they browse posts and photos',
      not_sure: 'you are not totally sure what they do next',
    },
    customer_looks_for: {
      reviews: 'reviews',
      services: 'services',
      photos: 'photos',
      contact_information: 'contact information',
      service_area: 'service area',
      proof_legitimate: 'proof the business is legitimate',
      price: 'price',
      availability: 'availability',
      photos_examples: 'photos or examples',
      not_sure: 'the basics',
    },
    missing_information: {
      services: 'services offered',
      reviews: 'reviews',
      photos: 'photos of your work',
      service_area: 'service area',
      contact_information: 'contact information',
      credentials: 'licensing or credentials',
      faq: 'frequently asked questions',
      something_else: 'one other detail',
    },
    repeated_questions: {
      services: 'what services you offer',
      service_area: 'whether you serve their area',
      cost: 'cost',
      pricing: 'pricing',
      licensing_insurance: 'licensing or insurance',
      examples: 'examples of your work',
      availability: 'availability',
      photos: 'photos',
      hours: 'hours',
      reviews: 'reviews',
      something_else: 'one other detail',
    },
    current_process_assessment: {
      seeing_everything: 'they are mostly seeing what you want them to see',
      mostly: 'they are mostly seeing what you want them to see',
      clear_picture: 'they are getting a pretty clear picture',
      missing_some_things: 'there may be a few useful things missing',
      not_really: 'they are not really seeing everything you would want them to see',
      never_thought_about_it: 'not something you have thought much about',
      not_sure: 'not totally clear yet',
      current_process_working: 'the current process is working pretty well',
      probably_not_help: 'a single clear place probably would not make much difference',
    },
  };
  if (answer.summaryField === 'lead_source' && answer.answerId === 'other') {
    return stripFreeTextLabel(answer.answerLabel, 'OTHER');
  }
  return maps[answer.summaryField ?? '']?.[value] ?? cleanFallback(answer.answerLabel);
}

function actionPhraseFor(answer: QuestionCallAnswer): string {
  switch (answer.summaryValue) {
    case 'clear_place_would_help':
      return 'having that information in one clear place would make those conversations easier';
    case 'maybe_help':
      return 'having that information in one clear place might make those conversations easier';
    default:
      return '';
  }
}

function cleanFallback(label: string): string {
  return stripFreeTextLabel(label, label.split(':')[0] || '').toLowerCase();
}

function stripFreeTextLabel(label: string, prefix: string): string {
  const marker = `${prefix}: `;
  return label.startsWith(marker) ? label.slice(marker.length) : label;
}

function joinHuman(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function summarizeSignature(answers: QuestionCallAnswer[]): string {
  return answers
    .map((a) => `${a.stageId}:${a.answerId}:${a.summaryField ?? ''}:${a.summaryValue ?? ''}`)
    .join('|');
}
