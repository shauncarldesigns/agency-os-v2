import { useEffect, useState } from 'react';
import type { Script, Stage, StageAnswer, LeadContext, QuestionCallAnswer } from '../../lib/playbook';
import { interpolate } from '../../lib/playbook';
import { DiscoverySummary } from './DiscoverySummary';

// Discovery-first cockpit panel. Replaces the linear ScriptPanel when the
// operator has picked Question-oriented mode.
//
// Rendering: header + linear breadcrumb + active stage card + answer chips
// + Back button. Answer chips route to the next stage (or open an
// objection) via handlers wired in ExecutionView. Everything is data-driven
// — the stages and answers all come from the parsed Question-oriented
// script markdown; nothing about the discovery flow is hard-coded here.

interface QuestionOrientedPanelProps {
  script: Script;
  currentStageId: string;
  ctx: LeadContext;
  answers: QuestionCallAnswer[];
  onAnswerTap: (stage: Stage, answer: StageAnswer) => void;
  onMultiAnswerContinue: (stage: Stage, answers: StageAnswer[]) => void;
  onBack: () => void;
  onJumpToStage: (id: string) => void;
  onCopyToNotes: (line: string) => void;
  /** History of visited stage IDs so Back knows where to go. */
  history: string[];
}

export function QuestionOrientedPanel(props: QuestionOrientedPanelProps) {
  const {
    script, currentStageId, ctx, answers, onAnswerTap, onMultiAnswerContinue,
    onBack, onJumpToStage, onCopyToNotes, history,
  } = props;
  const currentStage = script.stages.find((s) => s.id === currentStageId) ?? script.stages[0];
  const linearStages = script.stages.filter((s) => !s.branch);
  const linearIdx = linearStages.findIndex((s) => s.id === currentStage.id);
  const progressPos = linearIdx >= 0 ? linearIdx : lastLinearCompletedIdx(script, currentStage.id);
  const isMulti = currentStage.selection_mode === 'multiple';
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [freeTextAnswer, setFreeTextAnswer] = useState<StageAnswer | null>(null);
  const [freeTextValue, setFreeTextValue] = useState('');

  useEffect(() => {
    const answersForStage = answers.filter((answer) => answer.stageId === currentStage.id);
    setSelectedIds(new Set(answersForStage.map((answer) => answer.answerId)));
    const recordedFreeText = answersForStage.find((answer) =>
      currentStage.answers?.some((stageAnswer) => stageAnswer.id === answer.answerId && stageAnswer.free_text)
    );
    const freeTextStageAnswer = recordedFreeText
      ? currentStage.answers?.find((answer) => answer.id === recordedFreeText.answerId && answer.free_text) ?? null
      : null;
    setFreeTextAnswer(freeTextStageAnswer);
    setFreeTextValue(freeTextStageAnswer ? stripFreeTextLabel(recordedFreeText?.answerLabel ?? '', freeTextStageAnswer.label) : '');
  }, [answers, currentStage.id]);

  return (
    <div className="cockpit-panel">
      <div className="cockpit-panel-header">
        <span className="cockpit-panel-title blue">📖 {script.label.toUpperCase()}</span>
        <span className="cockpit-panel-meta">
          Stage {Math.max(progressPos + 1, 1)} of {linearStages.length}
        </span>
      </div>

      <div className="cockpit-stage-crumbs">
        {script.stages.map((s) => {
          const isActive = s.id === currentStage.id;
          const isDone = !s.branch
            && linearStages.findIndex((ls) => ls.id === s.id) < progressPos;
          return (
            <button
              key={s.id}
              type="button"
              className={`cockpit-stage-chip${isActive ? ' active' : isDone ? ' done' : ''}${s.branch ? ' branch' : ''}`}
              onClick={() => onJumpToStage(s.id)}
              title={s.branch ? 'Branch — routed to by an earlier answer' : undefined}
            >
              {isDone ? '✓ ' : isActive ? '● ' : ''}{s.short_label}{s.branch ? ' ↗' : ''}
            </button>
          );
        })}
      </div>

      <div className="cockpit-stage-active">
        <div className="cockpit-stage-heading">Say this · {currentStage.label}</div>
        <div className="cockpit-stage-body">{interpolate(currentStage.body, ctx)}</div>
        {currentStage.note && (
          <div className="cockpit-stage-note">↳ {interpolate(currentStage.note, ctx)}</div>
        )}
      </div>

      {currentStage.id === 'summary' && (
        <DiscoverySummary
          answers={answers}
          onCopyToNotes={onCopyToNotes}
        />
      )}

      {currentStage.answers && currentStage.answers.length > 0 && (
        <div className="cockpit-answer-grid">
          <div className="cockpit-answer-label">Operator chips · choose what they said</div>
          {currentStage.answers.map((a) => {
            const selected = selectedIds.has(a.id) || freeTextAnswer?.id === a.id;
            return (
            <button
              key={a.id}
              type="button"
              className={`cockpit-answer-chip${a.objection_id ? ' has-objection' : ''}${selected ? ' selected' : ''}`}
              aria-pressed={isMulti ? selected : undefined}
              onClick={() => {
                if (isMulti) {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(a.id)) next.delete(a.id);
                    else next.add(a.id);
                    return next;
                  });
                } else if (a.free_text) {
                  setFreeTextAnswer(a);
                  setFreeTextValue('');
                } else {
                  onAnswerTap(currentStage, a);
                }
              }}
              title={
                a.objection_id
                  ? `Opens objection: ${a.objection_id}`
                  : a.next_stage_id
                    ? `Advances to: ${a.next_stage_id}`
                    : 'No follow-up wired'
              }
            >
              {a.label}
              {a.objection_id && <span className="cockpit-answer-chip-hint"> · objection</span>}
            </button>
          );
          })}
          {freeTextAnswer && !isMulti && (
            <div className="cockpit-answer-free-text">
              <label>
                <span>{freeTextAnswer.free_text_label ?? 'Details'}</span>
                <input
                  type="text"
                  value={freeTextValue}
                  onChange={(e) => setFreeTextValue(e.target.value)}
                  placeholder="Type what they said"
                  autoFocus
                />
              </label>
              <button
                type="button"
                className="cockpit-answer-continue"
                disabled={!freeTextValue.trim()}
                onClick={() => {
                  onAnswerTap(currentStage, withFreeTextAnswer(freeTextAnswer, freeTextValue));
                }}
              >
                Continue
              </button>
            </div>
          )}
          {isMulti && (
            <button
              type="button"
              className="cockpit-answer-continue"
              disabled={selectedIds.size === 0}
              onClick={() => {
                const selectedAnswers = (currentStage.answers ?? []).filter((answer) => selectedIds.has(answer.id));
                onMultiAnswerContinue(currentStage, selectedAnswers);
              }}
            >
              Continue
            </button>
          )}
        </div>
      )}

      <div className="cockpit-stage-controls">
        <button
          type="button"
          className="cockpit-btn"
          onClick={onBack}
          disabled={history.length === 0}
          title={history.length === 0 ? 'Nothing to go back to' : 'Return to previous stage'}
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

function withFreeTextAnswer(answer: StageAnswer, value: string): StageAnswer {
  const trimmed = value.trim();
  return {
    ...answer,
    label: `${answer.label}: ${trimmed}`,
    summary_value: trimmed || answer.summary_value,
  };
}

function stripFreeTextLabel(label: string, prefix: string): string {
  const marker = `${prefix}: `;
  return label.startsWith(marker) ? label.slice(marker.length) : '';
}

// If the operator is currently on a branch (or an unrouted stage),
// approximate "last linear stage completed" by walking script.stages
// forward and counting linear stages that came before this position.
function lastLinearCompletedIdx(script: Script, currentId: string): number {
  const idx = script.stages.findIndex((s) => s.id === currentId);
  if (idx < 0) return -1;
  let count = 0;
  for (let i = 0; i < idx; i++) {
    if (!script.stages[i].branch) count++;
  }
  return count - 1;
}
