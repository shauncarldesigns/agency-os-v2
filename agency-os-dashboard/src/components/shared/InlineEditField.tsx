import { useState, useEffect, useRef } from 'react';

/**
 * InlineEditField — small click-to-edit field used for capturing/correcting
 * mid-call data (owner name, email) on the cockpit and inside BookingPane.
 *
 * Renders as text in display mode; click → input. Commits on blur or Enter,
 * cancels on Escape. Empty trimmed value saves as null. Parent decides what
 * to do with the new value via onSave (typically a PUT to /api/leads/:id).
 *
 * Visual variants:
 *   - `compact` (default) — small label above a single line of text/input
 *   - `boxed`             — bordered card matching the cockpit phone-hero
 *                           style; used in the lead-header cluster
 */

interface InlineEditFieldProps {
  label: string;
  value: string | null | undefined;
  /** Pre-fill text shown in faded italic when `value` is empty (e.g. owner
   *  name mined from reviews). Operator can accept by hitting Enter (saves
   *  the suggestion to the underlying field) or type over it. */
  suggested?: string | null;
  placeholder: string;
  onSave: (next: string | null) => Promise<void> | void;
  variant?: 'compact' | 'boxed';
  type?: 'text' | 'email';
  disabled?: boolean;
}

export function InlineEditField({
  label, value, suggested, placeholder, onSave, variant = 'compact', type = 'text', disabled,
}: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false);
  const initialDraft = value ?? suggested ?? '';
  const [draft, setDraft] = useState(initialDraft);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? suggested ?? '');
  }, [value, suggested, editing]);

  async function commit() {
    const trimmed = draft.trim();
    const next = trimmed.length > 0 ? trimmed : null;
    const current = value ?? null;
    if (next === current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  function cancel() {
    setDraft(value ?? '');
    setEditing(false);
  }

  const labelEl = <span className="iefield-label">{label}</span>;

  if (editing && !disabled) {
    return (
      <div className={`iefield iefield-${variant} iefield-editing`}>
        {labelEl}
        <input
          ref={inputRef}
          autoFocus
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          disabled={saving}
          placeholder={placeholder}
          className="iefield-input"
        />
      </div>
    );
  }

  const hasValue = Boolean(value);
  const hasSuggested = !hasValue && Boolean(suggested);
  const displayText = value || suggested || placeholder;
  const stateClass = hasValue
    ? ''
    : hasSuggested ? ' iefield-suggested' : ' iefield-empty';

  return (
    <button
      type="button"
      className={`iefield iefield-${variant}${stateClass}`}
      onClick={() => !disabled && setEditing(true)}
      disabled={disabled}
      title={disabled ? undefined : hasSuggested ? 'From reviews — click to confirm or edit' : 'Click to edit'}
    >
      {labelEl}
      <span className="iefield-value">{displayText}</span>
    </button>
  );
}
