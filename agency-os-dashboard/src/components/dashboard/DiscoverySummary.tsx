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
  return items.at(-1)?.answerLabel ?? '';
}

function joinedLabels(items: QuestionCallAnswer[]): string {
  const labels = Array.from(new Set(items.map((item) => item.answerLabel)));
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
  const leadSource = latestLabel(buckets.lead_source);
  const nextStep = latestLabel(buckets.customer_next_step);
  const looksFor = joinedLabels(buckets.customer_looks_for);
  const missing = joinedLabels(buckets.missing_information);
  const repeated = joinedLabels(buckets.repeated_questions);
  const assessment = latestLabel(buckets.current_process_assessment);

  const parts: string[] = [];
  if (leadSource) parts.push(`most of your business comes through ${leadSource.toLowerCase()}`);
  if (nextStep) parts.push(`after someone gets your name, they usually ${nextStep.toLowerCase()}`);
  if (looksFor) parts.push(`they look for ${looksFor.toLowerCase()}`);
  if (missing) parts.push(`you would want them to see ${missing.toLowerCase()}`);
  if (repeated) parts.push(`customers sometimes ask about ${repeated.toLowerCase()}`);
  if (assessment) parts.push(`your current process is: ${assessment.toLowerCase()}`);

  if (parts.length === 0) return '';
  return `So it sounds like ${joinHuman(parts)}. Is that accurate?`;
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
