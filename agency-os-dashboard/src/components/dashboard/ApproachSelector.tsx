import type { CallApproach } from '../../lib/callApproachStorage';

// Chip switcher between the cold-call approaches. Sits in the script panel
// header row. Kept tiny — just chips, no dropdown or menu.
// Behavior about persistence + mid-call confirmation lives in the caller.

interface ApproachSelectorProps {
  value: CallApproach;
  onChange: (next: CallApproach) => void;
  disabled?: boolean;
  unavailable?: Partial<Record<CallApproach, string | undefined>>;
}

const OPTIONS: Array<{ value: CallApproach; label: string; title: string }> = [
  { value: 'no_oriented',       label: 'No-oriented',       title: 'Pitch-first Chris Voss script (default)' },
  { value: 'question_oriented', label: 'Question-oriented', title: 'Discovery-first — solution stays hidden until reveal stage' },
  { value: 'quick_oriented',    label: 'Quick-oriented',    title: 'Fast reputation-gap reveal with a narrow objection tray' },
];

export function ApproachSelector({ value, onChange, disabled, unavailable }: ApproachSelectorProps) {
  return (
    <div className="cockpit-approach-switcher" role="tablist" aria-label="Call approach">
      <span className="cockpit-approach-label">APPROACH</span>
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        const unavailableReason = unavailable?.[opt.value];
        const isDisabled = disabled || Boolean(unavailableReason);
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-pressed={active}
            title={unavailableReason ?? opt.title}
            disabled={isDisabled}
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
