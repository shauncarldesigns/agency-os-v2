import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Phone,
  MapPin,
  Clock,
  Sparkles,
  Search,
  ChevronRight,
  CheckCircle2,
  Link2,
  X,
  Copy,
  Check,
  Send,
  LayoutGrid,
  Columns3,
  Eye,
  MousePointerClick,
  PhoneCall,
  RotateCcw,
  Loader2,
  RefreshCw,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import type { Lead, Project, ShowToast } from '../../lib/types';
import { api, TRACKING_BASE, ApiError } from '../../lib/api';
import { LeadDetailModal as SharedLeadDetailModal } from '../shared/LeadDetailModal';
import { StarRating } from '../shared/StarRating';
import { QualifyLeadModal } from '../pipeline/QualifyLeadModal';

// ---------------------------------------------------------------------------
// Automated Pipeline — text + site outreach queue.
//
// Fetches leads from `/api/pipeline/leads`. Server filters to the useful
// subset (no website, enriched, in cold/contacted); this component just
// renders + filters by pipeline_status client-side and wires mutations
// back to the API.
//
// Visual spec: mockups/LeadPipelinePage.jsx (canonical). Do NOT restyle.
// ---------------------------------------------------------------------------

export type PipelineStatus =
  | 'awaiting_build'
  | 'ready_to_send'
  | 'sent_no_reply'
  | 'engaged'
  | 'booked'
  | 'archived';

interface StatusConfig {
  label: string;
  chipBg: string;
  chipText: string;
  chipBorder: string;
  icon: LucideIcon;
  iconBg: string;
  action: string;
}

const STATUS_CONFIG: Record<PipelineStatus, StatusConfig> = {
  awaiting_build: {
    label: 'No website — brief ready',
    chipBg: 'bg-blue-50',
    chipText: 'text-blue-700',
    chipBorder: 'border-blue-100',
    icon: Sparkles,
    iconBg: 'bg-gradient-to-br from-blue-500 to-indigo-600',
    action: 'Copy brief',
  },
  ready_to_send: {
    label: 'Site is live — ready to send',
    chipBg: 'bg-emerald-50',
    chipText: 'text-emerald-700',
    chipBorder: 'border-emerald-100',
    icon: CheckCircle2,
    iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    action: 'Send text',
  },
  sent_no_reply: {
    label: 'Sent — no reply yet',
    chipBg: 'bg-slate-50',
    chipText: 'text-slate-600',
    chipBorder: 'border-slate-200',
    icon: Clock,
    iconBg: 'bg-gradient-to-br from-slate-400 to-slate-500',
    action: 'Follow up',
  },
  engaged: {
    label: 'Engaged — visited the site',
    chipBg: 'bg-amber-50',
    chipText: 'text-amber-700',
    chipBorder: 'border-amber-100',
    icon: Sparkles,
    iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500',
    action: 'Call now',
  },
  // Not surfaced in the current UI (no filter pill, no card action), but
  // included so the type + STATUS_CONFIG map stays exhaustive if the server
  // returns them. Phase 3+ will add explicit UI for booked/archived.
  booked: {
    label: 'Demo booked',
    chipBg: 'bg-emerald-50',
    chipText: 'text-emerald-700',
    chipBorder: 'border-emerald-100',
    icon: CheckCircle2,
    iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    action: 'View',
  },
  archived: {
    label: 'Archived',
    chipBg: 'bg-slate-50',
    chipText: 'text-slate-500',
    chipBorder: 'border-slate-200',
    icon: Clock,
    iconBg: 'bg-gradient-to-br from-slate-400 to-slate-500',
    action: 'View',
  },
};

const AVATAR_COLORS = [
  'from-teal-400 to-emerald-500',
  'from-rose-400 to-red-500',
  'from-blue-400 to-indigo-500',
  'from-violet-400 to-purple-500',
];

// Local presentation shape. Kept decoupled from the D1 Lead type so the
// visual layer stays stable across future schema changes. The mapper
// (`mapLeadRow` below) does all the field-level derivation.
export interface PipelineLead {
  id: number;
  name: string;
  category: string;
  rating: number;
  reviews: number;
  phone: string;
  address: string;
  hours: string;
  status: PipelineStatus;
  sessions: number;
  ownerFirst: string;
  lastAction: string;                 // pre-formatted display string
  initials: string;
  url: string | null;                 // tagged live URL (for preview + View live site)
  trackerUrl: string;                 // /r/:id link — this is what gets texted
  brief: string | null;
}

const PRICING_URL = 'https://shauncarldesigns.com/pricing';

// `sms:` deep link — `?&body=` is the variant most broadly honored across
// iOS and Android. A Copy fallback ships alongside every composer because
// body prefill is inconsistent across versions.
function smsLink(phone: string, body: string): string {
  const num = phone.replace(/[^\d+]/g, '');
  return `sms:${num}?&body=${encodeURIComponent(body)}`;
}

// Initials from a business name — first letter of the first two words.
// Falls back to first two characters if there's only one word, or '??'
// if the name is empty.
function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// First given name from owner_names. The column usually holds a JSON array
// string (e.g. `["Chad", "Matt", "Bill"]` from enrichment) but may be a
// plain comma-separated string on hand-entered leads — parse JSON first,
// fall back to splitting. A naive split previously leaked `["Chad` into
// the SMS composer. Falls back to 'there' (friendly, non-personalized).
function deriveOwnerFirst(ownerNames: string | null): string {
  if (!ownerNames) return 'there';
  let first: string | undefined;
  try {
    const arr = JSON.parse(ownerNames);
    if (Array.isArray(arr) && arr.length > 0) first = String(arr[0]).trim();
  } catch {
    // not JSON — treat as a delimited plain string
  }
  if (!first) first = ownerNames.split(/[,;/]/)[0]?.trim();
  // Belt and braces: strip any stray JSON punctuation that survived.
  first = first?.replace(/["'[\]]/g, '').trim();
  if (!first) return 'there';
  return first.split(/\s+/)[0] || 'there';
}

// Human-readable relative time. Server sends ISO; UI shows "Sent 3 days ago".
// The action prefix comes from the most recent activity type; if we don't
// know it, we just say "Updated <when>".
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const seconds = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} mo${months === 1 ? '' : 's'} ago`;
}

// Human-readable label for the most recent action. Used to build the
// footer string on each card (e.g. "Sent 3 days ago").
function actionLabel(action: string | null, status: PipelineStatus): string {
  switch (action) {
    case 'url_saved':
      return 'Built';
    case 'intro_sent':
      return 'Sent';
    case 'followed_up':
      return 'Followed up';
    case 'called':
      return 'Called';
    case 'click_tracked':
      return 'Visited';
    default:
      // No activity yet — fall back to something status-appropriate.
      if (status === 'awaiting_build') return 'Enriched';
      return 'Updated';
  }
}

// Full mapper: D1 row → PipelineLead. Called on every list fetch AND
// every mutation response so the two paths stay consistent.
function mapLeadRow(l: Lead, lastActionAction: string | null = null): PipelineLead {
  const category =
    l.industry ??
    (l.gbp_categories?.split(/[,;]/)[0]?.trim() ?? 'Business');
  const phone = l.phone ?? '';
  const addressParts = [l.address, l.city, l.state].filter(Boolean);
  const address = addressParts.join(', ');
  const rawStatus = l.pipeline_status as PipelineStatus;
  const status: PipelineStatus =
    (STATUS_CONFIG[rawStatus] ? rawStatus : 'awaiting_build');
  const when = l.pipeline_last_action_at ?? l.updated_at ?? l.created_at;
  const lastAction = when ? `${actionLabel(lastActionAction, status)} ${relativeTime(when)}` : '—';

  return {
    id: l.id,
    name: l.company ?? '(unnamed)',
    category,
    rating: l.google_rating ?? 0,
    reviews: l.google_review_count ?? 0,
    phone,
    address,
    hours: l.gbp_hours ?? '',
    status,
    sessions: l.pipeline_sessions ?? 0,
    ownerFirst: deriveOwnerFirst(l.owner_names),
    lastAction,
    initials: deriveInitials(l.company ?? ''),
    url: l.site_url,
    trackerUrl: `${TRACKING_BASE}/r/${l.id}`,
    brief: l.pipeline_brief,
  };
}

// ---------- Shared bits ----------

function EngagementDot({ sessions }: { sessions: number }) {
  if (sessions === 0) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        No visits
      </span>
    );
  }
  const color = sessions >= 3 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {sessions} session{sessions === 1 ? '' : 's'}
    </span>
  );
}

interface ModalShellProps {
  title: string;
  subtitle?: string;
  /** When set, a small copy button renders next to the subtitle that copies
   *  this string — used by the brief modal so the business name can be
   *  pasted into landingsite's separate name field without hand-selecting. */
  subtitleCopy?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

function ModalShell({ title, subtitle, subtitleCopy, onClose, children, footer }: ModalShellProps) {
  const [subtitleCopied, setSubtitleCopied] = useState(false);

  const handleSubtitleCopy = async () => {
    if (!subtitleCopy) return;
    try {
      await navigator.clipboard.writeText(subtitleCopy);
      setSubtitleCopied(true);
      setTimeout(() => setSubtitleCopied(false), 1500);
    } catch {
      setSubtitleCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[90vh] rounded-t-2xl sm:rounded-2xl bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
            {subtitle && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                {subtitle}
                {subtitleCopy && (
                  <button
                    onClick={handleSubtitleCopy}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="Copy business name"
                    aria-label="Copy business name"
                  >
                    {subtitleCopied ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
        {footer && <div className="border-t border-slate-100 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Card ----------

function StatusChip({ lead, onAction }: { lead: PipelineLead; onAction: (l: PipelineLead) => void }) {
  const cfg = STATUS_CONFIG[lead.status];
  const Icon = cfg.icon;
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border ${cfg.chipBorder} ${cfg.chipBg} px-3 py-2.5`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${cfg.iconBg}`}
        >
          <Icon className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
        </span>
        <span className={`text-sm font-medium truncate ${cfg.chipText}`}>{cfg.label}</span>
      </div>
      <button
        onClick={() => onAction(lead)}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20 transition hover:shadow-md hover:shadow-blue-600/30 active:scale-[0.98]"
      >
        {cfg.action}
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

interface LeadCardProps {
  lead: PipelineLead;
  index: number;
  onAction: (l: PipelineLead) => void;
  onViewLead: (l: PipelineLead) => void;
}

function LeadCard({ lead, index, onAction, onViewLead }: LeadCardProps) {
  const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return (
    // flex-col + mt-auto on the footer: grid rows stretch cards to equal
    // height, so the footer pins to the bottom instead of floating.
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60 transition hover:shadow-md hover:shadow-slate-200/80">
      <div className="p-4 pb-3">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${avatarColor} text-sm font-semibold text-white shadow-sm`}
          >
            {lead.initials}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold text-slate-900">{lead.name}</h3>
            {/* flex-wrap + nowrap children: on tight cards the rating drops
                to its own line as a unit instead of splitting "★" from the
                number mid-span. */}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500">
              <span className="truncate">{lead.category}</span>
              <span className="text-slate-300">·</span>
              <span className="flex items-center gap-1 whitespace-nowrap">
                <StarRating rating={lead.rating} size={3.5} />
                <span className="font-medium text-amber-500">{lead.rating.toFixed(1)}</span>
                <span className="text-slate-400">({lead.reviews})</span>
              </span>
            </div>
          </div>
          <EngagementDot sessions={lead.sessions} />
        </div>
      </div>

      <div className="px-4 pb-3">
        <StatusChip lead={lead} onAction={onAction} />
      </div>

      <div className="space-y-2 px-4 pb-3 text-sm text-slate-600">
        <div className="flex items-center gap-2">
          <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>{lead.phone || '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="truncate">{lead.address || '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>{lead.hours || '—'}</span>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
        <span className="text-xs text-slate-400">{lead.lastAction}</span>
        <button
          onClick={() => onViewLead(lead)}
          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          View lead
          <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

// ---------- Brief modal (awaiting_build) ----------

function BriefModal({
  lead,
  onClose,
  onSaveUrl,
  onBriefGenerated,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onSaveUrl: (leadId: number, url: string) => Promise<void>;
  // Called after every successful (re)generation so the panel can keep
  // leads[] in sync — the next time this lead is opened the modal reads
  // the fresh brief without re-billing Claude.
  onBriefGenerated: (leadId: number, brief: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Brief state is owned by the modal so it can drive its own auto-generation
  // + regeneration flow. `null` means "not yet fetched"; the effect below
  // fires the initial generate when the modal opens and there's no cached
  // brief on the lead.
  const [briefText, setBriefText] = useState<string | null>(lead.brief);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const runGenerate = useCallback(
    async (regenerate: boolean) => {
      setBriefLoading(true);
      setBriefError(null);
      try {
        const { lead: updated } = await api.pipeline.generateBrief(lead.id, { regenerate });
        const nextBrief = updated.pipeline_brief ?? '';
        setBriefText(nextBrief);
        onBriefGenerated(lead.id, nextBrief);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'Brief generation failed';
        setBriefError(msg);
      } finally {
        setBriefLoading(false);
      }
    },
    [lead.id, onBriefGenerated],
  );

  // Auto-generate on open when there's no cached brief. StrictMode double-
  // invocation of effects is harmless here — the second call short-circuits
  // on `briefLoading` and, at worst, the server returns the cached row.
  useEffect(() => {
    if (briefText === null && !briefLoading && !briefError) {
      void runGenerate(false);
    }
    // Only meant to fire on mount — deps intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = async () => {
    if (!briefText) return;
    try {
      await navigator.clipboard.writeText(briefText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleSave = async () => {
    const url = urlInput.trim();
    if (!url || saving) return;
    setSaving(true);
    setErr(null);
    try {
      await onSaveUrl(lead.id, url);
      setSaved(true);
      setTimeout(() => onClose(), 700);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Save failed';
      setErr(msg);
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Site brief"
      subtitle={lead.name}
      subtitleCopy={lead.name}
      onClose={onClose}
      footer={
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Live site URL</label>
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://yourbusiness.landingsite.ai"
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <button
              onClick={handleSave}
              disabled={!urlInput.trim() || saving}
              className="shrink-0 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20 disabled:opacity-40 disabled:shadow-none"
            >
              {saved ? <Check className="h-4 w-4" /> : saving ? '…' : 'Save'}
            </button>
          </div>
          {err && <p className="mt-2 text-[11px] text-rose-500">{err}</p>}
          <p className="mt-2 text-[11px] text-slate-400">
            Saving auto-tags the link with UTM + Clarity tracking and moves this lead to "Ready to
            send."
          </p>
        </div>
      }
    >
      <div className="px-5 py-4">
        {briefLoading && briefText === null ? (
          // Initial generation state — no cached content to show, so the
          // whole brief area becomes a spinner + status line.
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-slate-50 border border-slate-100 py-10 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <div>
              <p className="text-sm font-medium text-slate-700">Generating brief…</p>
              <p className="mt-0.5 text-xs text-slate-400">
                Claude is drafting from the enrichment data. Usually ~10 seconds.
              </p>
            </div>
          </div>
        ) : briefError ? (
          // Fetch failed — inline retry rather than closing the modal.
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-rose-800">Couldn't generate the brief.</p>
                <p className="mt-0.5 text-xs text-rose-600">{briefError}</p>
                <button
                  onClick={() => void runGenerate(true)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/70 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try again
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 border border-slate-100 p-4 text-[13px] leading-relaxed text-slate-700 font-sans">
              {briefText}
            </pre>
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleCopy}
                disabled={!briefText}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-100 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-40"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-500" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy brief to clipboard
                  </>
                )}
              </button>
              <button
                onClick={() => void runGenerate(true)}
                disabled={briefLoading}
                className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                title="Generate a fresh brief"
              >
                {briefLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Paste this into landingsite.ai to build the site. Once it's live, drop the URL below —
              this tags it for tracking and unlocks the text to send.
            </p>
          </>
        )}
      </div>
    </ModalShell>
  );
}

// ---------- Text composer (ready_to_send) ----------

function TextComposerModal({
  lead,
  onClose,
  onSent,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onSent: (leadId: number, messageBody: string) => Promise<void>;
}) {
  // The message body texts the /r/:lead_id tracker URL, NOT the raw site
  // URL — so every recipient click hits our redirect and logs an
  // engagement signal before landing on the site. The preview panel
  // below shows the tagged destination for operator context.
  const defaultMsg =
    `Hey ${lead.ownerFirst}, this is Shaun — I put together a homepage for ` +
    `${lead.name}, no charge, just wanted you to see it: ${lead.trackerUrl}\n\n` +
    `Take a look when you get a sec, curious what you think.`;

  const [msg, setMsg] = useState(defaultMsg);

  return (
    <ModalShell
      title="Send intro text"
      subtitle={`${lead.name} · ${lead.phone}`}
      onClose={onClose}
      footer={
        // Single send path: "Open in Messages" is the only way out, so every
        // send gets recorded (the old Copy fallback bypassed tracking and
        // left the funnel blind).
        <a
          href={smsLink(lead.phone, msg)}
          onClick={() => {
            // Fire the optimistic action + close. The undo toast handles
            // the "wait, I didn't actually send" case.
            void onSent(lead.id, msg);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20"
        >
          <Send className="h-4 w-4" />
          Open in Messages
        </a>
      }
    >
      <div className="px-5 py-4">
        <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
          <span className="font-semibold">Text 1 — the reveal.</span> No pricing, no ask. It should
          feel like a gift so they click. Pricing goes in the follow-up.
        </div>

        <label className="mb-1.5 block text-xs font-medium text-slate-500">Message</label>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={7}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500">Tracked link — resolves to</p>
            <p className="truncate text-[11px] text-slate-400">{lead.url}</p>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-slate-400">
          "Open in Messages" launches your texting app with this message and number prefilled — you
          review and hit send from your own phone.
        </p>
      </div>
    </ModalShell>
  );
}

// ---------- Follow-up composer (sent_no_reply / engaged) ----------

function FollowUpModal({
  lead,
  onClose,
  onSent,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onSent: (leadId: number, messageBody: string) => Promise<void>;
}) {
  const engaged = lead.sessions > 0;

  const variantWarm =
    `Hey ${lead.ownerFirst}, saw you had a chance to check out the site — ` +
    `if you like the direction, here's what it'd cost to make it live and ` +
    `keep it maintained: ${PRICING_URL}\n\nNo pressure either way.`;
  const variantCold =
    `Hey ${lead.ownerFirst}, following up on that homepage I sent for ` +
    `${lead.name}. If you like it, here's what it'd cost to make it live: ` +
    `${PRICING_URL}\n\nAnd if it's not the right time, no worries at all — ` +
    `just let me know.`;

  const [msg, setMsg] = useState(engaged ? variantWarm : variantCold);

  return (
    <ModalShell
      title="Follow-up text"
      subtitle={`${lead.name} · ${lead.phone}`}
      onClose={onClose}
      footer={
        // Single tracked send path — see TextComposerModal.
        <a
          href={smsLink(lead.phone, msg)}
          onClick={() => {
            void onSent(lead.id, msg);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20"
        >
          <Send className="h-4 w-4" />
          Open in Messages
        </a>
      }
    >
      <div className="px-5 py-4">
        <div
          className={`mb-3 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs ${
            engaged
              ? 'border-amber-100 bg-amber-50 text-amber-700'
              : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          {engaged ? (
            <>
              <Eye className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-semibold">
                  {lead.sessions} site visit{lead.sessions === 1 ? '' : 's'}
                </span>{' '}
                — this is a warm lead. Lead with the pricing, they've already seen the work.
              </span>
            </>
          ) : (
            <>
              <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-semibold">No visits yet.</span> Softer re-touch — remind them
                the site exists before pushing price.
              </span>
            </>
          )}
        </div>

        <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
          <span className="font-semibold">Text 2 — the pricing.</span> This is where the pricing
          link goes. Keep the "not-right-now" door open.
        </div>

        <label className="mb-1.5 block text-xs font-medium text-slate-500">Message</label>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={7}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500">Pricing link</p>
            <p className="truncate text-[11px] text-slate-400">{PRICING_URL}</p>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------- Call prep (engaged) ----------

function CallPrepModal({
  lead,
  onClose,
  onBookDemo,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onBookDemo: (lead: PipelineLead) => void;
}) {
  return (
    <ModalShell
      title="Call prep"
      subtitle={lead.name}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <a
            href={`tel:${lead.phone}`}
            className="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20"
          >
            <PhoneCall className="h-4 w-4" />
            Call {lead.phone}
          </a>
          <button
            onClick={() => onBookDemo(lead)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-white shadow-sm shadow-slate-900/10 hover:bg-slate-800"
          >
            Book demo
          </button>
        </div>
      }
    >
      <div className="px-5 py-4">
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
          <Eye className="h-3.5 w-3.5 shrink-0" />
          <span>
            Warm lead — visited the site{' '}
            <span className="font-semibold">
              {lead.sessions} time{lead.sessions === 1 ? '' : 's'}
            </span>
            . Open on that.
          </span>
        </div>

        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Suggested opener
        </h4>
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 text-sm leading-relaxed text-slate-700">
          "Hey, is this the owner of {lead.name}? This is Shaun — I actually built you a homepage
          and texted it over, and I saw you took a look at it. Wanted to see what you thought?"
        </div>

        <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
          On the call
        </h4>
        <ul className="space-y-1.5 text-sm text-slate-600">
          <li className="flex gap-2">
            <span className="text-slate-300">·</span>They've seen it — skip the pitch, ask what
            they'd change
          </li>
          <li className="flex gap-2">
            <span className="text-slate-300">·</span>Walk them to pricing: build vs. build +
            maintain
          </li>
          <li className="flex gap-2">
            <span className="text-slate-300">·</span>Assumed close — "want me to make it live?"
          </li>
        </ul>
      </div>
    </ModalShell>
  );
}


// ---------- Undo toast ----------

// Floating pill anchored to the bottom of the pipeline scope. Visible for
// ~6 seconds after each optimistic transition. z-[210] beats the modal
// backdrop (z-[200]) so it stays visible even mid-close animation.
function UndoBanner({
  message,
  onUndo,
  onDismiss,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-6 z-[210] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-white px-4 py-2.5 text-sm shadow-lg shadow-slate-900/10">
        <span className="text-slate-700">{message}</span>
        <button
          onClick={onUndo}
          className="flex items-center gap-1 text-blue-600 font-medium hover:text-blue-700"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Undo
        </button>
        <button
          onClick={onDismiss}
          className="text-slate-400 hover:text-slate-600"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------- Page ----------

type FilterKey = 'all' | 'awaiting_build' | 'ready_to_send' | 'sent_no_reply' | 'engaged';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'awaiting_build', label: 'Awaiting build' },
  { key: 'ready_to_send', label: 'Ready to send' },
  { key: 'sent_no_reply', label: 'Sent — no reply' },
  { key: 'engaged', label: 'Engaged' },
];

type ModalType = 'brief' | 'text' | 'followup' | 'call' | 'detail';
type ModalState = { type: ModalType; lead: PipelineLead } | null;

type ViewMode = 'grid' | 'board';
const VIEW_KEY = 'agency-os-pipeline-view';

// Kanban columns — the four active stages, in flow order. booked/archived
// stay off the board until they get real UI.
const BOARD_COLUMNS: Array<{ status: PipelineStatus; label: string }> = [
  { status: 'awaiting_build', label: 'Awaiting build' },
  { status: 'ready_to_send', label: 'Ready to send' },
  { status: 'sent_no_reply', label: 'Sent — no reply' },
  { status: 'engaged', label: 'Engaged' },
];

// Compact card for the board view. Draggable; the stage action + View lead
// stay one tap away so the board is workable, not just a status readout.
function BoardCard({
  lead,
  onAction,
  onViewLead,
}: {
  lead: PipelineLead;
  onAction: (l: PipelineLead) => void;
  onViewLead: (l: PipelineLead) => void;
}) {
  const cfg = STATUS_CONFIG[lead.status];
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(lead.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="cursor-grab rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60 transition hover:shadow-md active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 truncate text-sm font-semibold text-slate-900">{lead.name}</h4>
        <EngagementDot sessions={lead.sessions} />
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-slate-500">
        <span className="truncate">{lead.category}</span>
        <span className="text-slate-300">·</span>
        <span className="flex items-center gap-1 whitespace-nowrap">
          <StarRating rating={lead.rating} />
          <span className="font-medium text-amber-500">{lead.rating.toFixed(1)}</span>
          <span>({lead.reviews})</span>
        </span>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button
          onClick={() => onAction(lead)}
          className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm shadow-blue-600/20"
        >
          {cfg.action}
          <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
        </button>
        <button
          onClick={() => onViewLead(lead)}
          className="text-[11px] font-medium text-blue-600 hover:text-blue-700"
        >
          View lead
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-slate-400">{lead.lastAction}</p>
    </div>
  );
}

const STATUS_TO_MODAL: Record<PipelineStatus, ModalType> = {
  awaiting_build: 'brief',
  ready_to_send: 'text',
  sent_no_reply: 'followup',
  engaged: 'call',
  booked: 'detail',
  archived: 'detail',
};

interface Props {
  showToast: ShowToast;
  onQualified?: (project: Project, tier: 1 | 2 | 3) => void;
}

export default function AutomatedPipelinePanel({ showToast, onQualified }: Props) {
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [qualifyLead, setQualifyLead] = useState<Lead | null>(null);
  const [undo, setUndo] = useState<{ leadId: number; message: string; key: string } | null>(null);
  // Grid (default) vs Kanban board. Persisted like the sidebar collapse.
  const [view, setView] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'grid',
  );
  const setViewPersist = (v: ViewMode) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { leads: rows } = await api.pipeline.list();
      setLeads(rows.map((l) => mapLeadRow(l)));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load leads';
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  // Auto-dismiss the undo pill after ~6s. Re-keyed on every new toast so
  // rapid consecutive actions reset the timer instead of stacking.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  const openFor = (lead: PipelineLead) => {
    setModal({ type: STATUS_TO_MODAL[lead.status], lead });
  };

  // Opens the shared LeadDetailModal (components/shared/) — it fetches the
  // full lead + calls + pipeline activity itself.
  const openDetail = (lead: PipelineLead) => setModal({ type: 'detail', lead });

  const applyMutation = (updated: Lead, lastAction: string | null): PipelineLead => {
    const mapped = mapLeadRow(updated, lastAction);
    setLeads((prev) => prev.map((l) => (l.id === mapped.id ? mapped : l)));
    return mapped;
  };

  const handleSaveUrl = async (leadId: number, url: string) => {
    const { lead } = await api.pipeline.saveSiteUrl(leadId, url);
    applyMutation(lead, 'url_saved');
    setUndo({ leadId, message: 'URL saved', key: `save-${leadId}-${Date.now()}` });
  };

  const runAction = async (
    leadId: number,
    action: 'intro_sent' | 'followed_up' | 'called',
    toastMessage: string,
    meta?: unknown,
  ) => {
    try {
      const { lead } = await api.pipeline.action(leadId, { action, meta });
      applyMutation(lead, action);
      setModal(null);
      setUndo({ leadId, message: toastMessage, key: `${action}-${leadId}-${Date.now()}` });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Action failed';
      showToast(msg, 'error');
    }
  };

  const markSent = (leadId: number, messageBody: string) =>
    runAction(leadId, 'intro_sent', 'Marked sent', { body: messageBody });

  const markFollowedUp = (leadId: number, messageBody: string) =>
    runAction(leadId, 'followed_up', 'Follow-up marked', { body: messageBody });

  const openBookDemo = async (lead: PipelineLead) => {
    try {
      const res = await api.leads.get(lead.id);
      setQualifyLead(res.lead);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not open booking flow';
      showToast(msg, 'error');
    }
  };

  const undoLast = async () => {
    if (!undo) return;
    const target = undo;
    setUndo(null);
    try {
      const result = await api.pipeline.undo(target.leadId);
      if (result?.lead) applyMutation(result.lead, null);
      showToast('Undone', 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Undo failed';
      showToast(msg, 'error');
    }
  };

  // Board drops are REAL status changes routed through the same guarded
  // transitions as the buttons — see the drop rules below. Invalid moves
  // explain themselves instead of silently repainting a column.
  const handleBoardDrop = (leadId: number, to: PipelineStatus) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === to) return;
    if (lead.status === 'awaiting_build' && to === 'ready_to_send') {
      // The move requires a live URL — the brief modal's Save completes it.
      setModal({ type: 'brief', lead });
      showToast('Paste the live site URL to finish moving this lead to Ready to send');
    } else if (lead.status === 'ready_to_send' && to === 'sent_no_reply') {
      // "I already texted them" — mark sent optimistically, undo pill covers
      // mis-drags.
      void runAction(lead.id, 'intro_sent', 'Marked sent');
    } else if (to === 'engaged') {
      showToast('Engaged flips automatically when the prospect clicks your tracked link');
    } else {
      showToast("That move isn't part of the flow — use Undo to step a lead back", 'error');
    }
  };

  const filtered = useMemo(
    () =>
      leads.filter((l) => {
        const matchesFilter = filter === 'all' || l.status === filter;
        const matchesQuery = l.name.toLowerCase().includes(query.toLowerCase());
        return matchesFilter && matchesQuery;
      }),
    [leads, filter, query],
  );

  const counts = useMemo(
    () =>
      leads.reduce<Record<string, number>>((acc, l) => {
        acc[l.status] = (acc[l.status] || 0) + 1;
        return acc;
      }, {}),
    [leads],
  );

  return (
    <div className="min-h-full bg-slate-50">
      {/* Page title/subtitle live in the AppShell top bar since Phase 3. */}
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leads..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {/* Grid / Board view toggle */}
          <div className="flex shrink-0 gap-0.5 rounded-xl bg-slate-100 p-0.5">
            <button
              onClick={() => setViewPersist('grid')}
              title="Grid view"
              className={`rounded-[10px] p-2 transition ${
                view === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewPersist('board')}
              title="Board view"
              className={`rounded-[10px] p-2 transition ${
                view === 'board' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Columns3 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Status filter pills only apply to the grid — the board's columns
            ARE the statuses. */}
        {view === 'grid' && (
          <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  filter === f.key
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f.label}
                {f.key !== 'all' && counts[f.key] ? (
                  <span
                    className={`ml-1.5 ${filter === f.key ? 'text-slate-300' : 'text-slate-400'}`}
                  >
                    {counts[f.key]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-10 text-center text-sm text-slate-400">
            Loading leads…
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 py-6 px-5 text-sm text-rose-700">
            <p className="font-medium">Couldn't load leads.</p>
            <p className="mt-1 text-xs text-rose-600">{loadError}</p>
            <button
              onClick={() => void loadLeads()}
              className="mt-3 rounded-lg bg-white/70 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-white"
            >
              Try again
            </button>
          </div>
        ) : view === 'board' ? (
          /* Kanban board — one column per active stage, in flow order.
             Columns scroll horizontally on narrow screens. Cards are
             draggable; drops route through handleBoardDrop's guarded
             transitions. */
          <div className="flex items-start gap-3 overflow-x-auto pb-4">
            {BOARD_COLUMNS.map((col) => {
              const cfg = STATUS_CONFIG[col.status];
              const ColIcon = cfg.icon;
              const items = leads.filter(
                (l) =>
                  l.status === col.status &&
                  l.name.toLowerCase().includes(query.toLowerCase()),
              );
              return (
                <div
                  key={col.status}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
                    if (!isNaN(id)) handleBoardDrop(id, col.status);
                  }}
                  className="w-72 shrink-0 rounded-2xl bg-slate-100/80 p-2.5"
                >
                  <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full ${cfg.iconBg}`}
                      >
                        <ColIcon className="h-3 w-3 text-white" strokeWidth={2.5} />
                      </span>
                      {col.label}
                    </span>
                    <span className="text-xs font-medium text-slate-400">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((l) => (
                      <BoardCard
                        key={l.id}
                        lead={l}
                        onAction={openFor}
                        onViewLead={openDetail}
                      />
                    ))}
                    {items.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
                        No leads
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Card grid — 1 col on mobile, 2 on tablet, 3 on desktop. The
           * explicit grid-cols-1 matters: Tailwind's cols classes use
           * minmax(0,1fr), which stops the implicit track from inheriting the
           * widest card's min-content and overflowing small screens. */
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((lead, i) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                index={i}
                onAction={openFor}
                onViewLead={openDetail}
              />
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-white/50 py-10 text-center text-sm text-slate-400">
                No leads match this filter.
              </div>
            )}
          </div>
        )}
      </div>

      {modal?.type === 'brief' && (
        <BriefModal
          lead={modal.lead}
          onClose={() => setModal(null)}
          onSaveUrl={handleSaveUrl}
          onBriefGenerated={(leadId, brief) => {
            // Keep the parent list in sync with the freshly-generated brief so
            // the next Copy Brief tap opens against the cached row.
            setLeads((prev) =>
              prev.map((l) => (l.id === leadId ? { ...l, brief } : l)),
            );
          }}
        />
      )}
      {modal?.type === 'text' && (
        <TextComposerModal lead={modal.lead} onClose={() => setModal(null)} onSent={markSent} />
      )}
      {modal?.type === 'followup' && (
        <FollowUpModal
          lead={modal.lead}
          onClose={() => setModal(null)}
          onSent={markFollowedUp}
        />
      )}
      {modal?.type === 'call' && (
        <CallPrepModal
          lead={modal.lead}
          onClose={() => setModal(null)}
          onBookDemo={(lead) => {
            setModal(null);
            void openBookDemo(lead);
          }}
        />
      )}
      {modal?.type === 'detail' && (
        <SharedLeadDetailModal
          leadId={modal.lead.id}
          onClose={() => setModal(null)}
          showToast={showToast}
          onLeadUpdated={() => void loadLeads()}
          onQualify={(lead) => {
            setModal(null);
            setQualifyLead(lead);
          }}
          pipelineContext
        />
      )}

      <QualifyLeadModal
        open={qualifyLead !== null}
        lead={qualifyLead}
        onClose={() => setQualifyLead(null)}
        showToast={showToast}
        onQualified={(project, tier) => {
          setQualifyLead(null);
          setLeads((prev) => prev.filter((l) => l.id !== project.lead_id));
          void loadLeads();
          onQualified?.(project, tier);
        }}
      />

      {undo && (
        <UndoBanner
          key={undo.key}
          message={undo.message}
          onUndo={() => void undoLast()}
          onDismiss={() => setUndo(null)}
        />
      )}
    </div>
  );
}
