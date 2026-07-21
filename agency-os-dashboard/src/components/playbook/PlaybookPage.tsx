import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  MessageSquareText,
  BarChart3,
  Mail,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import {
  api,
  ApiError,
  type ObjectionOverviewItem,
} from '../../lib/api';
import type {
  Script,
  ScriptSummary,
  Objection,
  ObjectionsByCategory,
  FollowUpSequence,
} from '../../lib/playbook';
import type { ShowToast } from '../../lib/types';

// ---------------------------------------------------------------------------
// Playbook — read-only browser over the markdown playbook content that
// otherwise only surfaces mid-call in the cockpit. Four tabs:
//   Scripts     — cold-call + demo scripts, stage by stage
//   Objections  — the full rebuttal library incl. operator notes
//   Follow-ups  — the email sequence
//   Analytics   — objection frequency + handled rate (existing endpoint)
// Editing stays in the markdown files (backend src/playbook/) by design.
// ---------------------------------------------------------------------------

type PlaybookTab = 'scripts' | 'objections' | 'followups' | 'analytics';

const TABS: Array<{ key: PlaybookTab; label: string; icon: typeof BookOpen }> = [
  { key: 'scripts', label: 'Scripts', icon: BookOpen },
  { key: 'objections', label: 'Objections', icon: MessageSquareText },
  { key: 'followups', label: 'Follow-ups', icon: Mail },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
];

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60">
      {children}
    </div>
  );
}

function OperatorNote({ note }: { note: string }) {
  return (
    <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
      <span className="font-semibold">Operator note (don't say aloud): </span>
      {note}
    </div>
  );
}

// ---------- Scripts tab ----------

function ScriptsTab({ showToast }: { showToast: ShowToast }) {
  const [summaries, setSummaries] = useState<ScriptSummary[]>([]);
  const [openScript, setOpenScript] = useState<Script | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingScript, setLoadingScript] = useState(false);

  useEffect(() => {
    api.playbook
      .scripts()
      .then((r) => setSummaries(r.scripts))
      .catch((e) =>
        showToast(e instanceof ApiError ? e.message : 'Failed to load scripts', 'error'),
      )
      .finally(() => setLoading(false));
  }, [showToast]);

  const toggle = useCallback(
    async (id: string) => {
      if (openId === id) {
        setOpenId(null);
        setOpenScript(null);
        return;
      }
      setOpenId(id);
      setOpenScript(null);
      setLoadingScript(true);
      try {
        const { script } = await api.playbook.script(id);
        setOpenScript(script);
      } catch (e) {
        showToast(e instanceof ApiError ? e.message : 'Failed to load script', 'error');
        setOpenId(null);
      } finally {
        setLoadingScript(false);
      }
    },
    [openId, showToast],
  );

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-400">Loading scripts…</p>;
  }

  return (
    <div className="space-y-3">
      {summaries.map((s) => (
        <SectionCard key={s.id}>
          <button
            onClick={() => void toggle(s.id)}
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{s.label}</span>
                {s.default && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                    Default
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {s.stage_count} stage{s.stage_count === 1 ? '' : 's'}
                {s.method ? ` · ${s.method}` : ''}
              </p>
            </div>
            {openId === s.id ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
            )}
          </button>

          {openId === s.id && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              {loadingScript && (
                <p className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </p>
              )}
              {openScript?.stages.map((stage, i) => (
                <div key={stage.id} className="rounded-xl bg-slate-50 p-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-[10px] font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {stage.label}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {stage.body}
                  </p>
                  {stage.note && <OperatorNote note={stage.note} />}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      ))}
    </div>
  );
}

// ---------- Objections tab ----------

const CATEGORY_LABELS: Record<string, string> = {
  standard: 'Standard',
  'deep-dive': 'Deep dive',
  closing: 'Closing',
};

function ObjectionCard({ objection }: { objection: Objection }) {
  const [open, setOpen] = useState(false);
  return (
    <SectionCard>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{objection.label}</span>
          {objection.type === 'branching' && (
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
              Branching
            </span>
          )}
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          {objection.type === 'simple' ? (
            <>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {objection.rebuttal}
              </p>
              {objection.note && <OperatorNote note={objection.note} />}
              {objection.variants?.map((v) => (
                <div key={v.label} className="rounded-xl bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-semibold text-slate-500">{v.label}</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{v.rebuttal}</p>
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                <span className="font-semibold">Diagnostic: </span>
                {objection.diagnostic.prompt}
              </div>
              {objection.paths.map((p) => (
                <div key={p.id} className="rounded-xl bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-semibold text-slate-500">{p.label}</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{p.rebuttal}</p>
                  {p.note && <OperatorNote note={p.note} />}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function ObjectionsTab({ showToast }: { showToast: ShowToast }) {
  const [byCategory, setByCategory] = useState<ObjectionsByCategory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.playbook
      .objections()
      .then((r) => setByCategory(r.by_category))
      .catch((e) =>
        showToast(e instanceof ApiError ? e.message : 'Failed to load objections', 'error'),
      )
      .finally(() => setLoading(false));
  }, [showToast]);

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-400">Loading objections…</p>;
  }
  if (!byCategory) return null;

  return (
    <div className="space-y-6">
      {(Object.keys(byCategory) as Array<keyof ObjectionsByCategory>).map((cat) => (
        <div key={cat}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {CATEGORY_LABELS[cat] ?? cat}
          </h3>
          <div className="space-y-3">
            {byCategory[cat].map((o) => (
              <ObjectionCard key={o.id} objection={o} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Follow-ups tab ----------

function FollowUpsTab({ showToast }: { showToast: ShowToast }) {
  const [sequence, setSequence] = useState<FollowUpSequence | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.playbook
      .followUp('email-sequence')
      .then((r) => setSequence(r.sequence))
      .catch((e) =>
        showToast(e instanceof ApiError ? e.message : 'Failed to load follow-ups', 'error'),
      )
      .finally(() => setLoading(false));
  }, [showToast]);

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-400">Loading follow-ups…</p>;
  }
  if (!sequence) return null;

  return (
    <div className="space-y-3">
      {sequence.description && (
        <p className="text-sm text-slate-500">{sequence.description}</p>
      )}
      {sequence.touches.map((t) => (
        <SectionCard key={t.id}>
          <div className="mb-2 flex items-center gap-2">
            <Mail className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-900">{t.label}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{t.body}</p>
          {t.note && <OperatorNote note={t.note} />}
        </SectionCard>
      ))}
    </div>
  );
}

// ---------- Analytics tab ----------

function AnalyticsTab({ showToast }: { showToast: ShowToast }) {
  const [items, setItems] = useState<ObjectionOverviewItem[]>([]);
  const [totalCalls, setTotalCalls] = useState(0);
  const [range, setRange] = useState<'30d' | 'all'>('30d');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.dashboard
      .objectionsOverview(range)
      .then((r) => {
        setItems(r.objections);
        setTotalCalls(r.total_calls);
      })
      .catch((e) =>
        showToast(e instanceof ApiError ? e.message : 'Failed to load analytics', 'error'),
      )
      .finally(() => setLoading(false));
  }, [range, showToast]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Objection frequency across <span className="font-semibold text-slate-700">{totalCalls}</span>{' '}
          calls
        </p>
        <div className="flex gap-1 rounded-full bg-slate-100 p-0.5">
          {(['30d', 'all'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                range === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              {r === '30d' ? 'Last 30 days' : 'All time'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">Loading analytics…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-10 text-center text-sm text-slate-400">
          No objection data yet — hits log automatically from the cockpit chips.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((o) => (
            <SectionCard key={o.objection_id}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">{o.label}</span>
                <span className="shrink-0 text-xs text-slate-400">{o.total_hits} hits</span>
              </div>
              <div className="mt-3 space-y-2">
                <div>
                  <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                    <span>Frequency</span>
                    <span>{o.frequency_pct}% of calls</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-600"
                      style={{ width: `${Math.min(100, o.frequency_pct)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                    <span>Handled</span>
                    <span>{o.handled_rate_pct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.min(100, o.handled_rate_pct)}%` }}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Page ----------

export function PlaybookPage({ showToast }: { showToast: ShowToast }) {
  const [tab, setTab] = useState<PlaybookTab>('scripts');

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                tab === t.key
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'scripts' && <ScriptsTab showToast={showToast} />}
      {tab === 'objections' && <ObjectionsTab showToast={showToast} />}
      {tab === 'followups' && <FollowUpsTab showToast={showToast} />}
      {tab === 'analytics' && <AnalyticsTab showToast={showToast} />}
    </div>
  );
}
