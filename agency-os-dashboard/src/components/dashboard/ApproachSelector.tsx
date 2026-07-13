import type { CallApproach } from '../../lib/callApproachStorage';

// Two-chip switcher between the two cold-call approaches. Sits in the
// script panel header row. Kept tiny — just chips, no dropdown or menu.
// Behavior about persistence + mid-call confirmation lives in the caller.

interface ApproachSelectorProps {
  value: CallApproach;
  onChange: (next: CallApproach) => void;
  disabled?: boolean;
}

const OPTIONS: Array<{ value: CallApproach; label: string; title: string }> = [
  { value: 'no_oriented',       label: 'No-oriented',       title: 'Pitch-first Chris Voss script (default)' },
  { value: 'question_oriented', label: 'Question-oriented', title: 'Discovery-first — solution stays hidden until reveal stage' },
];

export function ApproachSelector({ value, onChange, disabled }: ApproachSelectorProps) {
  return (
    <div className="cockpit-approach-switcher" role="tablist" aria-label="Call approach">
      <span className="cockpit-approach-label">APPROACH</span>
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-pressed={active}
            title={opt.title}
            disabled={disabled}
            className={`cockpit-approach-chip${active ? ' active' : ''}`}
            onClick={() => { if (!active) onChange(opt.value); }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
