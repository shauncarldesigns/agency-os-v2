import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Phone,
  MapPin,
  Clock,
  Sparkles,
  Search,
  Filter,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Link2,
  X,
  Copy,
  Check,
  Send,
  LayoutGrid,
  Columns3,
  MousePointerClick,
  PhoneCall,
  RotateCcw,
  Loader2,
  RefreshCw,
  AlertCircle,
  Archive,
  Eye,
  MessageCircleReply,
  CalendarDays,
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
  city: string;
  address: string;
  hours: string;
  status: PipelineStatus;
  sessions: number;
  engagementScore: number;
  engagementGrade: string;
  pipelineLastActionAt: string | null;
  followupStep: number;
  noReplyStep: number;
  replied: boolean;
  calendarSent: boolean;
  calendarClicked: boolean;
  schedulingFollowupSent: boolean;
  ownerFirst: string;
  lastAction: string;                 // pre-formatted display string
  initials: string;
  url: string | null;                 // tagged live URL (for preview + View live site)
  rawUrl: string | null;              // clean destination for operator preview links
  clarityTag: string | null;
  trackerUrl: string;                 // /r/:id link — this is what gets texted
  calendarUrl: string;                // /book/:id tracked HoneyBook redirect
  brief: string | null;
}

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
// The action prefix comes from the most recent activity type; older rows
// without one fall back to a specific label derived from workflow state.
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
    case 'email_captured':
      return 'Email captured';
    case 'email_sent':
      return 'Email sent';
    case 'email_followed_up':
      return 'Email followed up';
    case 'email_final_touch':
      return 'Final email sent';
    case 'url_saved':
      return 'Site URL saved';
    case 'brief_generated':
      return 'Brief generated';
    case 'intro_sent':
      return 'Intro text sent';
    case 'followed_up':
      return 'Follow-up text sent';
    case 'called':
      return 'Called';
    case 'call_outcome':
      return 'Call logged';
    case 'calendar_sent':
      return 'Calendar sent';
    case 'scheduling_followup':
      return 'Scheduling follow-up sent';
    case 'click_tracked':
      return 'Visited';
    case 'calendar_clicked':
      return 'Calendar opened';
    case 'reply_received':
      return 'Reply received';
    case 'archived':
      return 'Archived';
    case 'clarity_synced':
      return 'Engagement synced';
    case 'engagement_reset':
      return 'Engagement reset';
    case 'status_changed':
      return 'Status changed';
    default:
      // Old/imported rows can have a last-action timestamp without an
      // activity row. Use the workflow state instead of the useless
      // catch-all "Updated" label.
      if (status === 'awaiting_build') return 'Lead enriched';
      if (status === 'ready_to_send') return 'Brief ready';
      if (status === 'sent_no_reply') return 'Intro text sent';
      if (status === 'engaged') return 'Engagement recorded';
      if (status === 'booked') return 'Demo booked';
      return 'Archived';
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
    city: l.city ?? '',
    address,
    hours: l.gbp_hours ?? '',
    status,
    sessions: l.pipeline_sessions ?? 0,
    engagementScore: l.engagement_score ?? 0,
    engagementGrade: l.engagement_grade ?? 'nurture',
    pipelineLastActionAt: l.pipeline_last_action_at,
    followupStep: l.pipeline_followup_step ?? 0,
    noReplyStep: l.pipeline_no_reply_step ?? 0,
    replied: (l.pipeline_replied ?? 0) === 1,
    calendarSent: (l.pipeline_calendar_sent ?? 0) === 1,
    calendarClicked: (l.pipeline_calendar_clicked ?? 0) === 1,
    schedulingFollowupSent: (l.pipeline_scheduling_followup_sent ?? 0) === 1,
    ownerFirst: deriveOwnerFirst(l.owner_names),
    lastAction,
    initials: deriveInitials(l.company ?? ''),
    url: l.site_url,
    rawUrl: l.site_url_raw,
    clarityTag: l.clarity_tag,
    trackerUrl: `${TRACKING_BASE}/r/${l.id}`,
    calendarUrl: `${TRACKING_BASE}/book/${l.id}`,
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
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      {sessions} session{sessions === 1 ? '' : 's'}
    </span>
  );
}

type TouchDecay = {
  label: string;
  detail: string;
  activeSegments: number;
  pillClass: string;
  dotClass: string;
  segmentClass: string;
};

function getTouchDecay(lead: PipelineLead): TouchDecay {
  if (!lead.pipelineLastActionAt) {
    return {
      label: 'No outreach yet',
      detail: 'Start sequence',
      activeSegments: 0,
      pillClass: 'border-slate-200 bg-slate-50 text-slate-600',
      dotClass: 'bg-slate-300',
      segmentClass: 'bg-slate-300',
    };
  }

  const ageMs = Math.max(0, Date.now() - new Date(lead.pipelineLastActionAt).getTime());
  const ageHours = ageMs / (60 * 60 * 1000);
  const action = lead.lastAction.replace(
    /\s+(just now|\d+\s+(?:min|hrs?|days?|mos?)\s+ago)$/,
    '',
  );
  const elapsed = relativeTime(lead.pipelineLastActionAt);

  if (ageHours < 24) {
    return {
      label: action,
      detail: elapsed,
      activeSegments: 1,
      pillClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      dotClass: 'bg-emerald-500',
      segmentClass: 'bg-emerald-400',
    };
  }
  if (ageHours < 72) {
    return {
      label: action,
      detail: elapsed,
      activeSegments: 2,
      pillClass: 'border-blue-200 bg-blue-50 text-blue-700',
      dotClass: 'bg-blue-500',
      segmentClass: 'bg-blue-400',
    };
  }
  if (ageHours < 168) {
    return {
      label: action,
      detail: elapsed,
      activeSegments: 3,
      pillClass: 'border-amber-200 bg-amber-50 text-amber-800',
      dotClass: 'bg-amber-500',
      segmentClass: 'bg-amber-400',
    };
  }
  return {
    label: action,
    detail: elapsed,
    activeSegments: 4,
    pillClass: 'border-rose-200 bg-rose-50 text-rose-700',
    dotClass: 'bg-rose-500',
    segmentClass: 'bg-rose-400',
  };
}

function LastTouchIndicator({
  lead,
  compact = false,
}: {
  lead: PipelineLead;
  compact?: boolean;
}) {
  const decay = getTouchDecay(lead);
  const followupCount = Math.max(lead.followupStep, lead.noReplyStep);
  const isLatestFollowup = lead.lastAction.startsWith('Follow-up text sent');
  const displayLabel = isLatestFollowup && followupCount > 0
    ? `Follow-up #${followupCount} sent`
    : decay.label;
  return (
    <div
      className={`rounded-lg border ${decay.pillClass} ${compact ? 'px-2 py-1.5' : 'px-2.5 py-2'}`}
      title={`Last outreach activity: ${lead.lastAction}`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${decay.dotClass}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`${compact ? 'text-[10px]' : 'text-xs'} truncate font-semibold`}>
              {displayLabel}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {followupCount > 0 && !isLatestFollowup && (
                <span className={`${compact ? 'text-[8px]' : 'text-[9px]'} rounded-full bg-white/80 px-1.5 py-0.5 font-semibold`}>
                  {followupCount} follow-up{followupCount === 1 ? '' : 's'}
                </span>
              )}
              <span className={`${compact ? 'text-[9px]' : 'text-[11px]'} font-medium opacity-80`}>
                {decay.detail}
              </span>
            </div>
          </div>
          <div className="mt-1 flex gap-0.5" aria-label={`Touch decay: ${decay.activeSegments} of 4`}>
            {[1, 2, 3, 4].map((segment) => (
              <span
                key={segment}
                className={`h-1 flex-1 rounded-full ${
                  segment <= decay.activeSegments ? decay.segmentClass : 'bg-white/80'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EngagementScoreBadge({ score, grade }: { score: number; grade: string }) {
  const tone =
    score >= 90 ? 'bg-rose-50 text-rose-700 border-rose-100'
    : score >= 70 ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : score >= 40 ? 'bg-amber-50 text-amber-700 border-amber-100'
    : 'bg-slate-50 text-slate-500 border-slate-200';
  const label =
    grade === 'hot' ? 'Call'
    : grade === 'walkthrough' ? 'Walkthrough'
    : grade === 'follow_up' ? 'Follow up'
    : 'Nurture';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone}`}>
      {score}
      <span className="font-semibold">{label}</span>
    </span>
  );
}

function cleanSiteUrl(rawUrl: string | null, taggedUrl: string | null): string | null {
  if (rawUrl) return rawUrl;
  if (!taggedUrl) return null;
  try {
    const url = new URL(taggedUrl);
    url.searchParams.delete('utm_source');
    url.searchParams.delete('utm_medium');
    url.searchParams.delete('utm_campaign');
    return url.toString();
  } catch {
    return taggedUrl.split('?')[0] || taggedUrl;
  }
}

function SiteSignalBadges({ url, rawUrl }: { url: string | null; rawUrl: string | null }) {
  if (!url) return null;
  const cleanUrl = cleanSiteUrl(rawUrl, url);
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pb-3">
      <a
        href={cleanUrl ?? undefined}
        target="_blank"
        rel="noreferrer"
        title="Open the site without outreach tracking"
        className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
      >
        Site built
      </a>
    </div>
  );
}

type RecommendationAction = 'call' | 'text';

interface OutreachRecommendation {
  action: RecommendationAction;
  label: string;
  detail: string;
  tone: string;
  textVariant: 'nurture' | 'reply_link' | 'follow_up' | 'walkthrough' | 'none';
}

function getOutreachRecommendation(input: {
  status: PipelineStatus;
  sessions: number;
  engagementScore: number;
  lastVisitAt?: string | null;
}): OutreachRecommendation | null {
  if (input.status !== 'engaged') return null;
  if (input.sessions === 0) {
    return {
      action: 'text',
      label: 'Send homepage link',
      detail: 'They replied, but have not opened the homepage yet. Keep the tracked link in this message.',
      tone: 'bg-blue-50 text-blue-700 border-blue-100',
      textVariant: 'reply_link',
    };
  }
  const score = Math.max(40, input.engagementScore);
  if (score >= 90) {
    return {
      action: 'call',
      label: 'Call Now',
      detail: 'Hot intent. Call instead of sending another text.',
      tone: 'bg-rose-50 text-rose-700 border-rose-100',
      textVariant: 'none',
    };
  }
  if (score >= 70) {
    return {
      action: 'text',
      label: 'Offer a walkthrough',
      detail: 'They invested meaningful time. Move from texting to a 10–15 minute conversation.',
      tone: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      textVariant: 'walkthrough',
    };
  }
  return {
    action: 'text',
    label: 'Ask for feedback',
    detail: 'They looked at the site. Ask for a response without asking for a meeting.',
    tone: 'bg-amber-50 text-amber-700 border-amber-100',
    textVariant: 'follow_up',
  };
}

function getEngagedProgress(lead: PipelineLead): {
  stateLabel: string;
  detail: string;
  actionLabel: string;
  action: 'text' | 'call';
  tone: string;
} | null {
  if (lead.status !== 'engaged' || lead.followupStep === 0) return null;
  if (lead.followupStep >= 2) {
    return {
      stateLabel: 'Final follow-up sent',
      detail: 'The text sequence is complete. A quick call is the final chance to confirm whether they are interested.',
      actionLabel: 'Call — last chance',
      action: 'call',
      tone: 'border-rose-200 bg-rose-50 text-rose-700',
    };
  }
  return {
    stateLabel: 'Waiting for reply',
    detail: 'The first follow-up was sent. You can wait for them or close the loop whenever it feels right.',
    actionLabel: 'Send final follow-up',
    action: 'text',
    tone: 'border-amber-200 bg-amber-50 text-amber-700',
  };
}

function getNoReplyProgress(lead: PipelineLead): {
  stateLabel: string;
  detail: string;
  actionLabel: string;
  action: 'text' | 'call';
  tone: string;
} | null {
  if (lead.status !== 'sent_no_reply') return null;
  if (lead.noReplyStep >= 2) {
    return {
      stateLabel: 'Final nudge sent',
      detail: 'The no-reply text sequence is complete. One call is the final attempt.',
      actionLabel: 'Call — last chance',
      action: 'call',
      tone: 'border-rose-200 bg-rose-50 text-rose-700',
    };
  }
  if (lead.noReplyStep === 1) {
    return {
      stateLabel: 'Reminder sent',
      detail: 'They still have not visited or replied. Send one final, easy-to-answer nudge.',
      actionLabel: 'Send final nudge',
      action: 'text',
      tone: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }
  return {
    stateLabel: 'Waiting for first look',
    detail: 'The intro was sent, but the tracked homepage has not been opened yet.',
    actionLabel: 'Send reminder',
    action: 'text',
    tone: 'border-blue-200 bg-blue-50 text-blue-700',
  };
}

function NoReplyProgressPanel({ lead, compact = false }: { lead: PipelineLead; compact?: boolean }) {
  const progress = getNoReplyProgress(lead);
  if (!progress) return null;
  return (
    <div className={`rounded-xl border ${progress.tone} ${compact ? 'mt-2 px-2 py-1.5' : 'px-3 py-2.5'}`}>
      <div className={compact ? 'text-[10px]' : 'text-[11px]'}>
        <strong>{progress.stateLabel}</strong>
        {!compact && <p className="mt-1 font-normal opacity-80">{progress.detail}</p>}
      </div>
    </div>
  );
}

function getSchedulingProgress(lead: PipelineLead): {
  stateLabel: string;
  detail: string;
  actionLabel: string;
  action: 'call' | 'book';
  tone: string;
} | null {
  if (lead.calendarClicked) {
    if (lead.schedulingFollowupSent) {
      return {
        stateLabel: 'Scheduling follow-up sent',
        detail: 'They opened the calendar but have not booked. Call to close the loop or record the booking.',
        actionLabel: 'Call about scheduling',
        action: 'call',
        tone: 'border-amber-200 bg-amber-50 text-amber-700',
      };
    }
    return {
      stateLabel: 'Calendar opened — awaiting booking',
      detail: 'They showed scheduling intent, but the app does not assume they booked.',
      actionLabel: 'Follow up on scheduling',
      action: 'book',
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }
  if (lead.calendarSent) {
    return {
      stateLabel: 'Calendar link sent',
      detail: 'Waiting for them to choose a convenient time.',
      actionLabel: 'Call / follow up',
      action: 'call',
      tone: 'border-blue-200 bg-blue-50 text-blue-700',
    };
  }
  return null;
}

function SchedulingProgressPanel({ lead, compact = false }: { lead: PipelineLead; compact?: boolean }) {
  const progress = getSchedulingProgress(lead);
  if (!progress) return null;
  return (
    <div className={`rounded-xl border ${progress.tone} ${compact ? 'mt-2 px-2 py-1.5' : 'px-3 py-2.5'}`}>
      <div className={compact ? 'text-[10px]' : 'text-[11px]'}>
        <strong>{progress.stateLabel}</strong>
        {!compact && <p className="mt-1 font-normal opacity-80">{progress.detail}</p>}
      </div>
    </div>
  );
}

function EngagedRecommendationPanel({ lead, compact = false }: { lead: PipelineLead; compact?: boolean }) {
  if (getSchedulingProgress(lead)) return <SchedulingProgressPanel lead={lead} compact={compact} />;
  const progress = getEngagedProgress(lead);
  const rec = getOutreachRecommendation({
    status: lead.status,
    sessions: lead.sessions,
    engagementScore: lead.engagementScore,
    lastVisitAt: lead.pipelineLastActionAt,
  });
  if (!rec) return null;
  if (progress) {
    return (
      <div className={`rounded-xl border ${progress.tone} ${compact ? 'mt-2 px-2 py-1.5' : 'px-3 py-2.5'}`}>
        <div className={compact ? 'text-[10px]' : 'text-[11px]'}>
          <strong>{progress.stateLabel}</strong>
          {!compact && <p className="mt-1 font-normal opacity-80">{progress.detail}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className={`rounded-xl border ${rec.tone} ${compact ? 'mt-2 px-2 py-1.5' : 'px-3 py-2.5'}`}>
      <div className={compact ? 'text-[10px]' : 'text-[11px]'}>
        <span className="inline-flex items-center gap-1">
          Recommended:
          {rec.action === 'call' && <PhoneCall className="h-3 w-3" strokeWidth={2.25} />}
          <strong>{rec.label}</strong>
        </span>
      </div>
    </div>
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

function isStaleLead(lead: PipelineLead): boolean {
  if (!lead.pipelineLastActionAt) return false;
  const age = Date.now() - new Date(lead.pipelineLastActionAt).getTime();
  if (lead.status === 'engaged') return age >= 30 * 24 * 60 * 60 * 1000;
  return lead.status === 'sent_no_reply'
    && lead.noReplyStep >= 2
    && age >= 14 * 24 * 60 * 60 * 1000;
}

function StatusChip({
  lead,
  onAction,
  onArchive,
}: {
  lead: PipelineLead;
  onAction: (l: PipelineLead) => void;
  onArchive: (l: PipelineLead) => void;
}) {
  const cfg = STATUS_CONFIG[lead.status];
  const rec = getOutreachRecommendation({
    status: lead.status,
    sessions: lead.sessions,
    engagementScore: lead.engagementScore,
    lastVisitAt: lead.pipelineLastActionAt,
  });
  const progress = getEngagedProgress(lead);
  const noReplyProgress = getNoReplyProgress(lead);
  const schedulingProgress = getSchedulingProgress(lead);
  const actionLabel =
    schedulingProgress?.actionLabel
    ?? noReplyProgress?.actionLabel
    ?? progress?.actionLabel
    ?? rec?.label
    ?? cfg.action;
  const isCallAction =
    schedulingProgress?.action === 'call'
    || noReplyProgress?.action === 'call'
    || progress?.action === 'call'
    || (!progress && !noReplyProgress && rec?.action === 'call');
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
        {isCallAction && <PhoneCall className="h-3.5 w-3.5" strokeWidth={2.25} />}
        {actionLabel}
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
      {isStaleLead(lead) && (
        <button
          onClick={() => onArchive(lead)}
          title="Archive stale lead"
          aria-label={`Archive ${lead.name}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-700 hover:bg-amber-50"
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

interface LeadCardProps {
  lead: PipelineLead;
  index: number;
  onAction: (l: PipelineLead) => void;
  onViewLead: (l: PipelineLead) => void;
  onArchive: (l: PipelineLead) => void;
  onReply: (l: PipelineLead) => void;
}

function LeadCard({ lead, index, onAction, onViewLead, onArchive, onReply }: LeadCardProps) {
  const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const recommendation = getOutreachRecommendation({
    status: lead.status,
    sessions: lead.sessions,
    engagementScore: lead.engagementScore,
    lastVisitAt: lead.pipelineLastActionAt,
  });
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
          <div className="flex shrink-0 flex-col items-end gap-1">
            <EngagementScoreBadge score={lead.engagementScore} grade={lead.engagementGrade} />
            <EngagementDot sessions={lead.sessions} />
          </div>
        </div>
      </div>

      <div className="px-4 pb-3">
        <StatusChip lead={lead} onAction={onAction} onArchive={onArchive} />
      </div>

      {isStaleLead(lead) && (
        <div className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>
            Stale lead — {lead.status === 'sent_no_reply' ? '14+ days after the final nudge.' : '30+ days.'}
          </strong>{' '}
          Make one last call, then archive it if there is still no response.
        </div>
      )}

      <SiteSignalBadges url={lead.url} rawUrl={lead.rawUrl} />
      {recommendation && (
        <div className="px-4 pb-3">
          <EngagedRecommendationPanel lead={lead} />
        </div>
      )}
      {lead.status === 'sent_no_reply' && (
        <div className="px-4 pb-3">
          {getSchedulingProgress(lead)
            ? <SchedulingProgressPanel lead={lead} />
            : <NoReplyProgressPanel lead={lead} />}
        </div>
      )}

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

      <div className="mt-auto flex items-center gap-2 border-t border-slate-100 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <LastTouchIndicator lead={lead} />
        </div>
        <div className="flex shrink-0 items-center">
          {(lead.status === 'sent_no_reply' || lead.status === 'engaged') && !lead.replied && (
            <button
              onClick={() => onReply(lead)}
              title="They replied"
              aria-label={`Mark ${lead.name} as replied`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
            >
              <MessageCircleReply className="h-4 w-4" strokeWidth={2.25} />
            </button>
          )}
          <button
            onClick={() => onViewLead(lead)}
            title="View lead"
            aria-label={`View ${lead.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50 hover:text-blue-700"
          >
            <Eye className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
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
                Claude is drafting from the enrichment data. Usually ~10 seconds — up to a
                minute or two if we're also pulling the full review set.
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
            {/* Actions live ABOVE the brief so the operator doesn't have to
                scroll a long brief to reach Copy / Regenerate. */}
            <div className="mb-3 flex gap-2">
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
            <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 border border-slate-100 p-4 text-[13px] leading-relaxed text-slate-700 font-sans">
              {briefText}
            </pre>
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
    `Hey ${lead.ownerFirst}, this is Shaun — I put together a homepage for ${lead.name}, no charge, just wanted you to see it:\n\n` +
    `${lead.trackerUrl}\n\n` +
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
  const rec = getOutreachRecommendation({
    status: lead.status,
    sessions: lead.sessions,
    engagementScore: lead.engagementScore,
    lastVisitAt: lead.pipelineLastActionAt,
  });

  const nurtureText =
    `Hey ${lead.ownerFirst}, just wanted to bump this back up in case it got buried.\n` +
    `I put together that homepage specifically for ${lead.name}:\n` +
    `${lead.trackerUrl}\n\n` +
    `Curious what you think whenever you get a chance.`;
  const replyLinkText =
    `Hey ${lead.ownerFirst}, thanks for getting back to me. Here's the homepage I put together for ${lead.name}:\n` +
    `${lead.trackerUrl}\n\n` +
    `Curious what you think when you get a chance.`;
  const followUpText =
    `Hey ${lead.ownerFirst}, thanks for taking a look at the homepage I put together for ${lead.name}.\n` +
    `I'd genuinely love to hear your thoughts. Was there anything you liked or would change?`;
  const walkthroughText =
    `Hey ${lead.ownerFirst}, thanks for taking the time to look through the homepage. I'd love to walk through it with you and hear what you'd want to change if it became your actual website.\n\n` +
    `Is there a day this week when you have 10–15 minutes?`;
  const finalFollowUpText =
    `Hey ${lead.ownerFirst}, quick follow-up on the homepage I made for ${lead.name}. ` +
    `Worth a quick conversation, or should I close this out?`;
  const finalNoReplyText =
    `Hey ${lead.ownerFirst}, quick question—did you get a chance to look at the homepage I made for ${lead.name}?\n` +
    `${lead.trackerUrl}\n\n` +
    `Even a quick yes or no would be helpful.`;
  const isFinalFollowUp = lead.status === 'engaged' && lead.followupStep >= 1;
  const isFinalNoReply = lead.status === 'sent_no_reply' && lead.noReplyStep >= 1;
  const isUnvisitedEngagedFinal =
    lead.status === 'engaged' && lead.sessions === 0 && lead.followupStep >= 1;

  const [msg, setMsg] = useState(
    isFinalNoReply || isUnvisitedEngagedFinal
      ? finalNoReplyText
      : !engaged
        ? lead.status === 'engaged' && rec?.textVariant === 'reply_link'
          ? replyLinkText
          : nurtureText
      : isFinalFollowUp
        ? finalFollowUpText
      : rec?.textVariant === 'walkthrough'
        ? walkthroughText
        : rec?.textVariant === 'follow_up'
          ? followUpText
          : nurtureText,
  );
  const includesDemoLink = msg.includes(lead.trackerUrl);

  return (
    <ModalShell
      title={isFinalFollowUp || isFinalNoReply || isUnvisitedEngagedFinal ? 'Final follow-up text' : 'Follow-up text'}
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
        <div className={`mb-3 rounded-xl border px-3 py-2.5 text-xs ${
          lead.status === 'engaged'
            ? rec?.tone ?? 'border-amber-100 bg-amber-50 text-amber-700'
            : 'border-slate-200 bg-slate-50 text-slate-600'
        }`}>
          {lead.status === 'engaged' ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">Recommended: {rec?.label ?? 'Send follow-up text'}</span>
                <span>{lead.sessions} session{lead.sessions === 1 ? '' : 's'} · score {lead.engagementScore}</span>
              </div>
              <p className="mt-1 opacity-80">
                {rec?.detail ?? 'They interacted with the demo. Keep the follow-up focused on feedback.'}
              </p>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-semibold">No visits yet.</span> Softer re-touch — remind them
                the site exists before pushing price.
              </span>
            </div>
          )}
        </div>

        <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
          <span className="font-semibold">
            {isFinalFollowUp || isFinalNoReply || isUnvisitedEngagedFinal ? 'Final follow-up.' : 'Follow-up text.'}
          </span>{' '}
          {isFinalNoReply || isUnvisitedEngagedFinal
            ? 'This is the final text in the no-reply sequence. It keeps the tracked homepage link and asks for an easy yes-or-no response.'
            : isFinalFollowUp
            ? 'This closes the text sequence without pressure. After sending it, the next action becomes a last-chance call.'
            : 'Use this when the recommendation says to text instead of call.'}
        </div>

        <label className="mb-1.5 block text-xs font-medium text-slate-500">Message</label>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={7}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />

        {includesDemoLink ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500">Tracked demo link included</p>
              <p className="truncate text-[11px] text-slate-400">{lead.trackerUrl}</p>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-slate-400">
            The demo link is intentionally omitted—they already clicked it, so this message moves the conversation forward.
          </p>
        )}
      </div>
    </ModalShell>
  );
}

// ---------- Call prep (engaged) ----------

type CallOutcome =
  | 'no_answer'
  | 'voicemail'
  | 'busy'
  | 'talk_later'
  | 'interested';

function CallPrepModal({
  lead,
  onClose,
  onBookDemo,
  onCallOutcome,
  onCalendarSent,
  onNotInterested,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onBookDemo: (lead: PipelineLead) => void;
  onCallOutcome: (lead: PipelineLead, outcome: CallOutcome) => Promise<boolean>;
  onCalendarSent: (
    lead: PipelineLead,
    outcome: CallOutcome,
    message: string,
  ) => Promise<void>;
  onNotInterested: (lead: PipelineLead) => void;
}) {
  const [selectedOutcome, setSelectedOutcome] = useState<CallOutcome | null>(null);
  const [loggingOutcome, setLoggingOutcome] = useState<CallOutcome | null>(null);
  const [calendarMessage, setCalendarMessage] = useState('');
  const progress = getEngagedProgress(lead);
  const noReplyProgress = getNoReplyProgress(lead);
  const isLastChanceCall = progress?.action === 'call' || noReplyProgress?.action === 'call';
  const rec = getOutreachRecommendation({
    status: lead.status,
    sessions: lead.sessions,
    engagementScore: lead.engagementScore,
    lastVisitAt: lead.pipelineLastActionAt,
  });

  const calendarMessages: Record<CallOutcome, string> = {
    no_answer:
      `Hey ${lead.ownerFirst}, I just tried giving you a quick call about the homepage I made for ${lead.name}. ` +
      `If it's easier, you can grab a time that works here:\n${lead.calendarUrl}`,
    voicemail:
      `Hey ${lead.ownerFirst}, I just left you a voicemail about the homepage I made for ${lead.name}. ` +
      `If you'd rather pick a convenient time, here's my calendar:\n${lead.calendarUrl}`,
    busy:
      `No problem, ${lead.ownerFirst}—here's my calendar if you'd like to pick a time that works better:\n${lead.calendarUrl}`,
    talk_later:
      `Hey ${lead.ownerFirst}, here's my calendar so you can grab a convenient time for us to talk through the homepage for ${lead.name}:\n${lead.calendarUrl}`,
    interested:
      `Great talking with you, ${lead.ownerFirst}. Here's my calendar so you can choose a time to walk through the homepage for ${lead.name}:\n${lead.calendarUrl}`,
  };
  const outcomeLabels: Record<CallOutcome, string> = {
    no_answer: 'No answer',
    voicemail: 'Left voicemail',
    busy: 'They were busy',
    talk_later: 'Asked to talk later',
    interested: 'Interested — send calendar',
  };

  if (selectedOutcome) {
    return (
      <ModalShell
        title="Send calendar link"
        subtitle={`${lead.name} · ${outcomeLabels[selectedOutcome]}`}
        onClose={onClose}
        footer={
          <a
            href={smsLink(lead.phone, calendarMessage)}
            onClick={() => void onCalendarSent(lead, selectedOutcome, calendarMessage)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20"
          >
            <Send className="h-4 w-4" />
            Open in Messages
          </a>
        }
      >
        <div className="px-5 py-4">
          <button
            onClick={() => setSelectedOutcome(null)}
            className="mb-3 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            ← Change call outcome
          </button>
          <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
            <strong>Tracked calendar link included.</strong> The lead will reach HoneyBook normally;
            the app records the click as scheduling intent.
          </div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Message</label>
          <textarea
            value={calendarMessage}
            onChange={(event) => setCalendarMessage(event.target.value)}
            rows={6}
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700"
          />
        </div>
      </ModalShell>
    );
  }

  const chooseOutcome = async (outcome: CallOutcome) => {
    setLoggingOutcome(outcome);
    const recorded = await onCallOutcome(lead, outcome);
    setLoggingOutcome(null);
    if (recorded) {
      setCalendarMessage(calendarMessages[outcome]);
      setSelectedOutcome(outcome);
    }
  };

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
        <div className="mb-4 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">
              Recommended: {isLastChanceCall ? 'Call — last chance' : rec?.label ?? 'Call Now'}
            </span>
            <span>{lead.sessions} session{lead.sessions === 1 ? '' : 's'} · score {lead.engagementScore}</span>
          </div>
          <p className="mt-1 opacity-80">
            {isLastChanceCall
              ? 'The text sequence is complete. Call once to confirm whether they are interested before letting the lead age into archive.'
              : rec?.detail ?? 'They interacted with the demo. Call while the site is fresh.'}
          </p>
        </div>

        <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
            <PhoneCall className="h-3.5 w-3.5" />
            After the call, what happened?
          </div>
          <p className="mt-1 text-[11px] text-blue-600">
            Pick the outcome and the app will prepare the appropriate text with your tracked calendar link.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(Object.keys(outcomeLabels) as CallOutcome[]).map((outcome) => (
              <button
                key={outcome}
                onClick={() => void chooseOutcome(outcome)}
                disabled={loggingOutcome !== null}
                className={`rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition disabled:opacity-50 ${
                  outcome === 'interested'
                    ? 'col-span-2 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-blue-200 bg-white text-blue-700 hover:bg-blue-100'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  {outcome === 'interested' && <CalendarDays className="h-3.5 w-3.5" />}
                  {loggingOutcome === outcome ? 'Recording…' : outcomeLabels[outcome]}
                </span>
              </button>
            ))}
            <button
              onClick={() => onNotInterested(lead)}
              className="col-span-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Not interested — archive
            </button>
          </div>
        </div>

        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Suggested opener
        </h4>
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 text-sm leading-relaxed text-slate-700">
          Hey {lead.ownerFirst}, it's Shaun. I wanted to follow up on the homepage I put together
          for {lead.name} and hear what you thought. Did I catch you at a bad time?
        </div>

        <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
          On the call
        </h4>
        <ul className="space-y-1.5 text-sm text-slate-600">
          <li className="flex gap-2">
            <span className="text-slate-300">·</span>
            If they're busy: “No problem at all. When would be a better time for me to give you a quick call?”
          </li>
          <li className="flex gap-2">
            <span className="text-slate-300">·</span>
            If they're free: “What stood out to you?”
          </li>
        </ul>
      </div>
    </ModalShell>
  );
}

// ---------- Scheduling follow-up ----------

function SchedulingFollowupModal({
  lead,
  onClose,
  onSent,
  onBookDemo,
  onNotInterested,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onSent: (lead: PipelineLead, message: string) => void;
  onBookDemo: (lead: PipelineLead) => void;
  onNotInterested: (lead: PipelineLead) => void;
}) {
  const [message, setMessage] = useState(
    `Hey ${lead.ownerFirst}, just wanted to make sure the calendar worked for you. ` +
    `If none of those times fit, let me know what works better and I'll make it happen.`,
  );

  return (
    <ModalShell
      title="Follow up on scheduling"
      subtitle={lead.name}
      onClose={onClose}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <a
            href={smsLink(lead.phone, message)}
            onClick={() => onSent(lead, message)}
            className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20"
          >
            <Send className="h-4 w-4" />
            Open in Messages
          </a>
          <a
            href={`tel:${lead.phone}`}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <PhoneCall className="h-4 w-4" />
            Call instead
          </a>
          <button
            onClick={() => onBookDemo(lead)}
            className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            <CalendarDays className="h-4 w-4" />
            They booked
          </button>
        </div>
      }
    >
      <div className="px-5 py-4">
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
          <strong>Calendar opened — awaiting booking.</strong>
          <p className="mt-1 opacity-80">
            They showed intent, but a calendar click is not treated as a confirmed appointment.
          </p>
        </div>

        <label className="mb-1.5 block text-xs font-medium text-slate-500">
          Scheduling follow-up
        </label>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />

        <button
          onClick={() => onNotInterested(lead)}
          className="mt-4 text-xs font-medium text-slate-500 hover:text-rose-600"
        >
          Not interested — archive lead
        </button>
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

type ModalType = 'brief' | 'text' | 'followup' | 'call' | 'scheduling' | 'detail';
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
  onArchive,
  onReply,
}: {
  lead: PipelineLead;
  onAction: (l: PipelineLead) => void;
  onViewLead: (l: PipelineLead) => void;
  onArchive: (l: PipelineLead) => void;
  onReply: (l: PipelineLead) => void;
}) {
  const cfg = STATUS_CONFIG[lead.status];
  const rec = getOutreachRecommendation({
    status: lead.status,
    sessions: lead.sessions,
    engagementScore: lead.engagementScore,
    lastVisitAt: lead.pipelineLastActionAt,
  });
  const progress = getEngagedProgress(lead);
  const noReplyProgress = getNoReplyProgress(lead);
  const schedulingProgress = getSchedulingProgress(lead);
  const actionLabel =
    schedulingProgress?.actionLabel
    ?? noReplyProgress?.actionLabel
    ?? progress?.actionLabel
    ?? rec?.label
    ?? cfg.action;
  const isCallAction =
    schedulingProgress?.action === 'call'
    || noReplyProgress?.action === 'call'
    || progress?.action === 'call'
    || (!progress && !noReplyProgress && rec?.action === 'call');
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
      {lead.url && (
        <div className="mt-2 flex flex-wrap gap-1">
          <a
            href={cleanSiteUrl(lead.rawUrl, lead.url) ?? undefined}
            target="_blank"
            rel="noreferrer"
            title="Open the site without outreach tracking"
            className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
          >
            Site built
          </a>
        </div>
      )}
      {rec && <EngagedRecommendationPanel lead={lead} compact />}
      {lead.status === 'sent_no_reply' && (
        getSchedulingProgress(lead)
          ? <SchedulingProgressPanel lead={lead} compact />
          : <NoReplyProgressPanel lead={lead} compact />
      )}
      {isStaleLead(lead) && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-800">
          <strong>Stale {lead.status === 'sent_no_reply' ? '14+' : '30+'} days.</strong> Make one last attempt or archive.
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button
          onClick={() => onAction(lead)}
          className="flex w-fit min-w-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-2 py-1 text-xs font-medium text-white shadow-sm shadow-blue-600/20"
        >
          {isCallAction && <PhoneCall className="h-3 w-3 shrink-0" strokeWidth={2.25} />}
          <span className="truncate">{actionLabel}</span>
          <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2.5} />
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isStaleLead(lead) && (
            <button
              onClick={() => onArchive(lead)}
              title="Archive stale lead"
              aria-label={`Archive ${lead.name}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-amber-700 hover:bg-amber-50 hover:text-amber-800"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
          {(lead.status === 'sent_no_reply' || lead.status === 'engaged') && !lead.replied && (
            <button
              onClick={() => onReply(lead)}
              title="They replied"
              aria-label={`Mark ${lead.name} as replied`}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
            >
              <MessageCircleReply className="h-3.5 w-3.5" strokeWidth={2.25} />
            </button>
          )}
          <button
            onClick={() => onViewLead(lead)}
            title="View lead"
            aria-label={`View ${lead.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50 hover:text-blue-700"
          >
            <Eye className="h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
        </div>
      </div>
      <div className="mt-2">
        <LastTouchIndicator lead={lead} compact />
      </div>
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
  const [industryFilter, setIndustryFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
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
      setLeads(rows.map((l) => mapLeadRow(l, l.pipeline_last_action ?? null)));
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
    const scheduling = getSchedulingProgress(lead);
    if (scheduling) {
      if (lead.calendarClicked && !lead.schedulingFollowupSent) {
        setModal({ type: 'scheduling', lead });
      } else {
        setModal({ type: 'call', lead });
      }
      return;
    }
    if (lead.status === 'sent_no_reply') {
      const progress = getNoReplyProgress(lead);
      setModal({ type: progress?.action === 'call' ? 'call' : 'followup', lead });
      return;
    }
    if (lead.status === 'engaged') {
      const progress = getEngagedProgress(lead);
      if (progress) {
        setModal({ type: progress.action === 'call' ? 'call' : 'followup', lead });
        return;
      }
      const rec = getOutreachRecommendation({
        status: lead.status,
        sessions: lead.sessions,
        engagementScore: lead.engagementScore,
        lastVisitAt: lead.pipelineLastActionAt,
      });
      setModal({ type: rec?.action === 'text' ? 'followup' : 'call', lead });
      return;
    }
    setModal({ type: STATUS_TO_MODAL[lead.status], lead });
  };

  // Opens the shared LeadDetailModal (components/shared/) — it fetches the
  // full lead + calls + pipeline activity itself.
  const openDetail = (lead: PipelineLead) => setModal({ type: 'detail', lead });

  const applyMutation = (updated: Lead, lastAction: string | null): PipelineLead => {
    const mapped = mapLeadRow(updated, lastAction);
    setLeads((prev) =>
      mapped.status === 'archived'
        ? prev.filter((l) => l.id !== mapped.id)
        : prev.map((l) => (l.id === mapped.id ? mapped : l)),
    );
    return mapped;
  };

  const handleSaveUrl = async (leadId: number, url: string) => {
    const { lead } = await api.pipeline.saveSiteUrl(leadId, url);
    applyMutation(lead, 'url_saved');
    setUndo({ leadId, message: 'URL saved', key: `save-${leadId}-${Date.now()}` });
  };

  const runAction = async (
    leadId: number,
    action:
      | 'intro_sent'
      | 'followed_up'
      | 'reply_received'
      | 'call_outcome'
      | 'calendar_sent'
      | 'scheduling_followup'
      | 'called'
      | 'archived',
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

  const recordCallOutcome = async (
    lead: PipelineLead,
    outcome: CallOutcome,
  ): Promise<boolean> => {
    try {
      const { lead: updated } = await api.pipeline.action(lead.id, {
        action: 'call_outcome',
        meta: { outcome },
      });
      applyMutation(updated, 'call_outcome');
      return true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not record call outcome';
      showToast(msg, 'error');
      return false;
    }
  };

  const markCalendarSent = (
    lead: PipelineLead,
    outcome: CallOutcome,
    message: string,
  ) =>
    runAction(lead.id, 'calendar_sent', 'Calendar link sent', {
      call_outcome: outcome,
      body: message,
      calendar_url: lead.calendarUrl,
    });

  const markSchedulingFollowupSent = (lead: PipelineLead, message: string) =>
    runAction(lead.id, 'scheduling_followup', 'Scheduling follow-up sent', {
      body: message,
    });

  const archiveLead = (lead: PipelineLead) => {
    if (!window.confirm(`Archive ${lead.name}? It will leave the active Text Outreach board.`)) return;
    void runAction(lead.id, 'archived', 'Lead archived', { reason: 'stale_outreach' });
  };

  const archiveNotInterested = (lead: PipelineLead) => {
    if (!window.confirm(`Archive ${lead.name} as not interested?`)) return;
    void runAction(lead.id, 'archived', 'Archived as not interested', {
      reason: 'not_interested_after_call',
    });
  };

  const markReplied = (lead: PipelineLead) => {
    const prompt = lead.status === 'engaged'
      ? `Record a text reply from ${lead.name}?`
      : `Mark ${lead.name} as replied and move it to Engaged?`;
    if (!window.confirm(prompt)) return;
    void runAction(
      lead.id,
      'reply_received',
      lead.status === 'engaged' ? 'Reply recorded' : 'Moved to Engaged',
      { reason: 'replied_by_text' },
    );
  };

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

  const industryOptions = useMemo(
    () => Array.from(new Set(leads.map((l) => l.category).filter(Boolean))).sort(),
    [leads],
  );

  const cityOptions = useMemo(
    () => Array.from(new Set(leads.map((l) => l.city).filter(Boolean))).sort(),
    [leads],
  );

  const visibleLeads = useMemo(
    () =>
      leads.filter((l) => {
        const normalizedQuery = query.trim().toLowerCase();
        const matchesQuery =
          normalizedQuery === ''
          || [l.name, l.category, l.city, l.address, l.phone]
            .some((value) => value.toLowerCase().includes(normalizedQuery));
        const matchesIndustry = industryFilter === 'all' || l.category === industryFilter;
        const matchesCity = cityFilter === 'all' || l.city === cityFilter;
        return matchesQuery && matchesIndustry && matchesCity;
      }),
    [leads, query, industryFilter, cityFilter],
  );

  const filtered = useMemo(
    () => visibleLeads.filter((l) => filter === 'all' || l.status === filter),
    [visibleLeads, filter],
  );

  const counts = useMemo(
    () =>
      visibleLeads.reduce<Record<string, number>>((acc, l) => {
        acc[l.status] = (acc[l.status] || 0) + 1;
        return acc;
      }, {}),
    [visibleLeads],
  );

  return (
    <div className="min-h-full bg-slate-50">
      {/* Page title/subtitle live in the AppShell top bar since Phase 3. */}
      <div className="page-container">
        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leads..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[170px] flex-1 sm:flex-none">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={industryFilter}
                onChange={(event) => setIndustryFilter(event.target.value)}
                aria-label="Filter by industry"
                className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm font-medium text-slate-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">All industries</option>
                {industryOptions.map((industry) => (
                  <option key={industry} value={industry}>{industry}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            </div>
            <div className="relative min-w-[150px] flex-1 sm:flex-none">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={cityFilter}
                onChange={(event) => setCityFilter(event.target.value)}
                aria-label="Filter by city"
                className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm font-medium text-slate-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">All cities</option>
                {cityOptions.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            </div>
            <button
              onClick={() => void loadLeads()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
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
              const items = visibleLeads.filter((l) => l.status === col.status);
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
                        onArchive={archiveLead}
                        onReply={markReplied}
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
                onArchive={archiveLead}
                onReply={markReplied}
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
          onCallOutcome={recordCallOutcome}
          onCalendarSent={markCalendarSent}
          onNotInterested={archiveNotInterested}
          onBookDemo={(lead) => {
            setModal(null);
            void openBookDemo(lead);
          }}
        />
      )}
      {modal?.type === 'scheduling' && (
        <SchedulingFollowupModal
          lead={modal.lead}
          onClose={() => setModal(null)}
          onSent={markSchedulingFollowupSent}
          onNotInterested={archiveNotInterested}
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
