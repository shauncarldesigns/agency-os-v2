// Day-of-week + calling-week helpers, all in America/Chicago time zone.
//
// The Worker runs in UTC. Any "what day is it for the operator" question must
// route through this module — naive Date.getDay() in UTC will flip a day
// boundary 6 hours ahead of Chicago local time.
//
// Operator timezone hardcoded per Phase 2 design decision; single-operator
// tool. If a second operator in a different tz comes onboard, switch to
// per-request tz (header or query param) and update this module's callers.

const CHICAGO_TZ = 'America/Chicago';

export type DayOfWeek =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday'
  | 'friday' | 'saturday' | 'sunday';

const DAY_INDEX: Record<DayOfWeek, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
  friday: 4, saturday: 5, sunday: 6,
};

// ISO date (YYYY-MM-DD) for "today" in Chicago.
export function chicagoToday(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const dd = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${dd}`;
}

export function chicagoDayOfWeek(d: Date = new Date()): DayOfWeek {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ, weekday: 'long',
  }).format(d);
  return weekday.toLowerCase() as DayOfWeek;
}

// What kind of day is this in the calling-week model?
// - 'monday'  → prep day, no sessions
// - 'tue/wed/thu' → calling day, 2 sessions
// - 'friday'  → review day, no sessions
// - 'sat/sun' → quiet
export function chicagoCallingMode(d: Date = new Date()): 'prep' | 'calling' | 'review' | 'quiet' {
  const day = chicagoDayOfWeek(d);
  if (day === 'monday') return 'prep';
  if (day === 'friday') return 'review';
  if (day === 'tuesday' || day === 'wednesday' || day === 'thursday') return 'calling';
  return 'quiet';
}

// Returns the Mon-Fri dates of the calling week that contains the given date.
// Operator-facing weeks always run Mon → Fri; Sat/Sun snap forward to "next
// week" so the operator sees what's coming up.
export function chicagoCallingWeek(d: Date = new Date()): {
  monday: string; tuesday: string; wednesday: string; thursday: string; friday: string;
} {
  const today = chicagoToday(d);
  const dayName = chicagoDayOfWeek(d);
  // Sat/Sun → snap forward to next Monday's week.
  const snapForward = dayName === 'saturday' || dayName === 'sunday';
  const dayIdx = DAY_INDEX[dayName];

  // Parse YYYY-MM-DD as a Date at UTC midnight, then arithmetic by day-ms.
  const t0 = new Date(`${today}T00:00:00Z`);
  let mondayMs = t0.getTime() - dayIdx * 86_400_000;
  if (snapForward) mondayMs += 7 * 86_400_000;
  const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    monday: toIso(mondayMs),
    tuesday: toIso(mondayMs + 1 * 86_400_000),
    wednesday: toIso(mondayMs + 2 * 86_400_000),
    thursday: toIso(mondayMs + 3 * 86_400_000),
    friday: toIso(mondayMs + 4 * 86_400_000),
  };
}
