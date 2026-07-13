import type { Script, Stage, StageAnswer, LeadContext } from '../../lib/playbook';
import { interpolate } from '../../lib/playbook';

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
  onAnswerTap: (stage: Stage, answer: StageAnswer) => void;
  onBack: () => void;
  onJumpToStage: (id: string) => void;
  /** History of visited stage IDs so Back knows where to go. */
  history: string[];
}

export function QuestionOrientedPanel(props: QuestionOrientedPanelProps) {
  const { script, currentStageId, ctx, onAnswerTap, onBack, onJumpToStage, history } = props;
  const currentStage = script.stages.find((s) => s.id === currentStageId) ?? script.stages[0];
  const linearStages = script.stages.filter((s) => !s.branch);
  const linearIdx = linearStages.findIndex((s) => s.id === currentStage.id);
  const progressPos = linearIdx >= 0 ? linearIdx : lastLinearCompletedIdx(script, currentStage.id);

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

      {currentStage.answers && currentStage.answers.length > 0 && (
        <div className="cockpit-answer-grid">
          <div className="cockpit-answer-label">They said…</div>
          {currentStage.answers.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`cockpit-answer-chip${a.objection_id ? ' has-objection' : ''}`}
              onClick={() => onAnswerTap(currentStage, a)}
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
          ))}
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
