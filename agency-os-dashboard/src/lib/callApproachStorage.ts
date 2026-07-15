// Call approach preference — persisted in localStorage so the operator's
// choice sticks across sessions and page loads. The default is
// No-oriented (the pitch-first script that predates the newer approaches).

export type CallApproach = 'no_oriented' | 'question_oriented' | 'quick_oriented';

const STORAGE_KEY = 'agency-os-call-approach';
const DEFAULT: CallApproach = 'no_oriented';

export function getStoredCallApproach(): CallApproach {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'no_oriented' || raw === 'question_oriented' || raw === 'quick_oriented') return raw;
  } catch {
    // localStorage can throw in privacy modes / sandboxed frames — fall
    // through to the default.
  }
  return DEFAULT;
}

export function setStoredCallApproach(value: CallApproach): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Silent — worst case the operator has to re-pick next session.
  }
}
