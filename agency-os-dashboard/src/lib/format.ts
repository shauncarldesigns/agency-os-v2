// Formatting + lightweight UI helpers shared across the dashboard.

export function tierColor(tier: 1 | 2 | 3 | null | undefined): string {
  if (tier === 3) return 'var(--tier3)';
  if (tier === 2) return 'var(--tier2)';
  if (tier === 1) return 'var(--tier1)';
  return 'var(--text3)';
}

export function scoreColor(score: number | null | undefined): 'tier1' | 'tier2' | 'tier3' | 'gray' {
  if (score == null) return 'gray';
  if (score >= 75) return 'tier3';
  if (score >= 50) return 'tier2';
  return 'tier1';
}

export function stars(rating: number | null | undefined, max = 5): string {
  if (rating == null) return '';
  const filled = Math.round(rating);
  return '★'.repeat(Math.min(filled, max)) + '☆'.repeat(Math.max(0, max - filled));
}

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return '';
  const date = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', ...opts });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    + ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Outcome → badge color mapping
export function outcomeBadge(outcome: string | null | undefined): { color: 'green' | 'yellow' | 'red' | 'blue' | 'gray'; label: string } {
  if (!outcome) return { color: 'gray', label: '—' };
  const o = outcome.toLowerCase();
  if (o.includes('interested') && !o.includes('not')) return { color: 'green', label: outcome };
  if (o.includes('signed') || o.includes('qualified')) return { color: 'green', label: outcome };
  if (o.includes('callback')) return { color: 'yellow', label: outcome };
  if (o.includes('voicemail')) return { color: 'blue', label: outcome };
  if (o.includes('not interested') || o.includes('dead')) return { color: 'red', label: outcome };
  return { color: 'gray', label: outcome };
}

// Pipeline status → badge color. See Lead.status comment in lib/types.ts for
// the post-Phase-0 vocabulary. 'Qualified' is the new "demo booked" state.
export function statusBadge(status: string): { color: 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'tier3'; label: string } {
  const map: Record<string, { color: 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'tier3'; label: string }> = {
    cold:            { color: 'gray',  label: 'Cold' },
    contacted:       { color: 'blue',  label: 'Contacted' },
    qualified:       { color: 'green', label: 'Demo booked' },
    client:          { color: 'tier3', label: 'Client' },
    not_interested:  { color: 'red',   label: 'Not interested' },
    dead:            { color: 'red',   label: 'Dead' },
  };
  return map[status] ?? { color: 'gray', label: status };
}

// Safely parse JSON-string columns from D1
export function parseList<T = string>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v as T[] : [];
  } catch {
    return [];
  }
}
