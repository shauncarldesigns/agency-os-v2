import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  Phone,
  MapPin,
  Clock,
  Sparkles,
  Search,
  Filter,
  ChevronRight,
  ChevronLeft,
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
  Loader2,
  RefreshCw,
  AlertCircle,
  Archive,
  Eye,
  MessageCircleReply,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import type { Lead, Project, ShowToast } from '../../lib/types';
import { api, TRACKING_BASE, ApiError } from '../../lib/api';
import { LeadDetailModal as SharedLeadDetailModal } from '../shared/LeadDetailModal';
import { StarRating } from '../shared/StarRating';
import { QualifyLeadModal } from '../pipeline/QualifyLeadModal';
import {
  parseSiteReviewReasons,
  SiteReviewFixModal,
  SiteReviewIssueSummary,
} from '../shared/SiteReviewFixModal';
import { interpolate, type Script } from '../../lib/playbook';
import { RecordButton, type RecordButtonHandle } from '../dashboard/RecordButton';
import { NOT_INTERESTED_REASONS, NotInterestedModal, type NotInterestedCloseout, type NotInterestedReason } from '../shared/NotInterestedModal';

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
  | 'built_needs_review'
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
  built_needs_review: {
    label: 'Site built — needs review',
    chipBg: 'bg-amber-50',
    chipText: 'text-amber-700',
    chipBorder: 'border-amber-100',
    icon: Eye,
    iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500',
    action: 'Approve site',
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
  email: string | null;
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
  ownerFirst: string;
  lastAction: string;                 // pre-formatted display string
  initials: string;
  url: string | null;                 // tagged live URL (for preview + View live site)
  rawUrl: string | null;              // clean destination for operator preview links
  reviewStatus: 'pending' | 'needs_fix' | 'approved';
  reviewReasons: string[];
  reviewNote: string | null;
  clarityTag: string | null;
  trackerUrl: string;                 // /r/:id link — this is what gets texted
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
    case 'site_approved':
      return 'Site approved';
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
    case 'click_tracked':
      return 'Visited';
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
      if (status === 'built_needs_review') return 'Site URL saved';
      if (status === 'ready_to_send') return 'Brief ready';
      if (status === 'sent_no_reply') return 'Intro text sent';
      if (status === 'engaged') return 'Engagement recorded';
      if (status === 'booked') return 'Demo booked';
      return 'Archived';
  }
}

// Full mapper: D1 row → PipelineLead. Called on every list fetch AND
// every mutation response so the two paths stay consistent.
export function mapLeadRow(l: Lead, lastActionAction: string | null = null): PipelineLead {
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
    email: l.email,
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
    ownerFirst: deriveOwnerFirst(l.owner_names),
    lastAction,
    initials: deriveInitials(l.company ?? ''),
    url: l.site_url,
    rawUrl: l.site_url_raw,
    reviewStatus: l.site_review_status ?? 'pending',
    reviewReasons: parseSiteReviewReasons(l.site_review_reasons),
    reviewNote: l.site_review_note,
    clarityTag: l.clarity_tag,
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
    : grade === 'walkthrough' ? 'Ready to discuss'
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

function SiteSignalBadges({
  url,
  rawUrl,
  status,
  reviewStatus = 'pending',
}: {
  url: string | null;
  rawUrl: string | null;
  status: PipelineStatus;
  reviewStatus?: PipelineLead['reviewStatus'];
}) {
  if (!url) return null;
  const cleanUrl = cleanSiteUrl(rawUrl, url);
  const needsReview = status === 'built_needs_review';
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pb-3">
      <a
        href={cleanUrl ?? undefined}
        target="_blank"
        rel="noreferrer"
        title="Open the site without outreach tracking"
        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          reviewStatus === 'needs_fix'
            ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800'
            : needsReview
            ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800'
            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800'
        }`}
      >
        {reviewStatus === 'needs_fix' ? 'Edit fix note' : needsReview ? 'Review site' : 'Site built'}
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
  textVariant: 'nurture' | 'reply_link' | 'follow_up' | 'none';
}

function getOutreachRecommendation(input: {
  status: PipelineStatus;
  sessions: number;
  engagementScore: number;
  replied: boolean;
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
  if (input.replied) {
    return {
      action: 'call',
      label: 'Open sales call',
      detail: 'They replied after seeing the site. Move into the warm sales conversation instead of sending more texts.',
      tone: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      textVariant: 'none',
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
      action: 'call',
      label: 'Call to discuss site',
      detail: 'They invested meaningful time. Call to discuss the site and determine whether they are ready to move forward.',
      tone: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      textVariant: 'none',
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
  if (lead.replied && lead.sessions > 0) return null;
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

// A sent_no_reply lead whose text sequence is exhausted — the only move left
// is the last-chance call. Surfaced as its own board column + filter pill so
// the texting queue in Sent — no reply stays clean. Purely derived; the lead's
// pipeline_status stays sent_no_reply.
function isLastChanceNoReply(lead: PipelineLead): boolean {
  return getNoReplyProgress(lead)?.action === 'call';
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

function EngagedRecommendationPanel({ lead, compact = false }: { lead: PipelineLead; compact?: boolean }) {
  const progress = getEngagedProgress(lead);
  const rec = getOutreachRecommendation({
    status: lead.status,
    sessions: lead.sessions,
    engagementScore: lead.engagementScore,
    replied: lead.replied,
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
  headerActions?: React.ReactNode;
  wide?: boolean;
}

function ModalShell({ title, subtitle, subtitleCopy, onClose, children, footer, headerActions, wide = false }: ModalShellProps) {
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
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-slate-900/40 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-4">
      <div className={`w-full ${wide ? 'sm:max-w-5xl' : 'sm:max-w-lg'} max-h-[90dvh] rounded-t-2xl sm:rounded-2xl bg-white shadow-xl flex flex-col`}>
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
          <div className="flex items-center gap-2">
            {headerActions}
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </div>
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
  onNeedsFix,
}: {
  lead: PipelineLead;
  onAction: (l: PipelineLead) => void;
  onArchive: (l: PipelineLead) => void;
  onNeedsFix: (l: PipelineLead) => void;
}) {
  const cfg = STATUS_CONFIG[lead.status];
  const rec = getOutreachRecommendation({
    status: lead.status,
    sessions: lead.sessions,
    engagementScore: lead.engagementScore,
    replied: lead.replied,
    lastVisitAt: lead.pipelineLastActionAt,
  });
  const progress = getEngagedProgress(lead);
  const noReplyProgress = getNoReplyProgress(lead);
  const actionLabel =
    noReplyProgress?.actionLabel
    ?? progress?.actionLabel
    ?? rec?.label
    ?? cfg.action;
  const isCallAction =
    noReplyProgress?.action === 'call'
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
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          onClick={() => onAction(lead)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20 transition hover:shadow-md hover:shadow-blue-600/30 active:scale-[0.98]"
        >
          {isCallAction && <PhoneCall className="h-3.5 w-3.5" strokeWidth={2.25} />}
          {actionLabel}
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
        {lead.status === 'built_needs_review' && (
          <button type="button" onClick={() => onNeedsFix(lead)} className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">
            {lead.reviewStatus === 'needs_fix' ? 'Edit fix note' : 'Needs fix'}
          </button>
        )}
      </div>
      {(lead.status === 'sent_no_reply' || lead.status === 'engaged') && (
        <button
          onClick={() => onArchive(lead)}
          title="Archive — not interested or asked to stop"
          aria-label={`Archive ${lead.name}`}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white ${
            isStaleLead(lead)
              ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
              : 'border-slate-200 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'
          }`}
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
  onNeedsFix: (l: PipelineLead) => void;
}

function LeadCard({ lead, index, onAction, onViewLead, onArchive, onReply, onNeedsFix }: LeadCardProps) {
  const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const recommendation = getOutreachRecommendation({
    status: lead.status,
    sessions: lead.sessions,
    engagementScore: lead.engagementScore,
    replied: lead.replied,
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
        <StatusChip lead={lead} onAction={onAction} onArchive={onArchive} onNeedsFix={onNeedsFix} />
      </div>

      {isStaleLead(lead) && (
        <div className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>
            Stale lead — {lead.status === 'sent_no_reply' ? '14+ days after the final nudge.' : '30+ days.'}
          </strong>{' '}
          Make one last call, then archive it if there is still no response.
        </div>
      )}

      <SiteSignalBadges url={lead.url} rawUrl={lead.rawUrl} status={lead.status} reviewStatus={lead.reviewStatus} />
      {lead.status === 'built_needs_review' && lead.reviewStatus === 'needs_fix' && (
        <div className="px-4 pb-3"><SiteReviewIssueSummary reasons={lead.reviewReasons} note={lead.reviewNote} /></div>
      )}
      {recommendation && (
        <div className="px-4 pb-3">
          <EngagedRecommendationPanel lead={lead} />
        </div>
      )}
      {lead.status === 'sent_no_reply' && (
        <div className="px-4 pb-3">
          <NoReplyProgressPanel lead={lead} />
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
    replied: lead.replied,
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

// ---------- Open sales call (engaged / final attempt) ----------

type CallOutcome =
  | 'no_answer'
  | 'voicemail'
  | 'busy'
  | 'talk_later'
  | 'feedback_only'
  | 'bad_contact'
  | 'interested';

export type BadContactReason = 'disconnected' | 'wrong_number' | 'no_contact' | 'business_closed' | 'call_screening';

export type SelectedPlan = 'Build & Maintain' | 'Growth';

// Adapted opening for the mid-call pivot from the last-chance script: the
// intro and "did you get a chance to look" have already happened on this
// call, so the stage keeps only the reaction questions.
const OVERRIDE_OPENING_BODY = `“Perfect — now that you have it open, what catches your eye first?”

“As you’re looking through it, what feels right for your business — and what would you want changed?”

“Absolutely. What you’re seeing is a starting point based on what I could find online. If we move forward, we’ll customize it around your business.”`;

const OVERRIDE_OPENING_NOTE = 'They are seeing the site for the first time right now. Let them react before guiding them. Ask about what is on their screen in the present tense.';

// Email Outreach's question-based approach deliberately overrides only the
// conversational moments. Plan details, pricing, agreements, and outcome
// handling remain owned by the shared sales flow below.
const QUESTION_BASED_FOLLOWUP_COPY: Record<string, { label: string; body: string }> = {
  opening: {
    label: 'GET THEIR HONEST REACTION',
    body: `“Hey {{contact_name}}, it’s Shaun. I wanted to get your honest reaction to the homepage I sent. What did you think?”

“What would you want changed before you’d feel comfortable having something like that represent the business?”
`,
  },
  unsure: {
    label: 'ISOLATE THE HESITATION',
    body: `“Totally fair. What’s the part you’re unsure about—the website itself, the investment, or whether it will actually help the business?”

Address only the concern they name.

“If we can get that part handled, is there anything else stopping you from moving forward?”`,
  },
};

function ScriptParagraph({ children }: { children: string }) {
  const waitsForResponse = children.includes('?');
  return (
    <div className="mb-4 last:mb-0">
      <p>{children}</p>
      {waitsForResponse && (
        <div className="mt-3 flex items-center gap-3" role="note" aria-label="Pause and let the prospect answer">
          <span className="h-px flex-1 bg-blue-200" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-600">Pause</span>
          <span className="h-px flex-1 bg-blue-200" />
        </div>
      )}
    </div>
  );
}

const WARM_CALL_RESPONSES = [
  { label: 'They only need a website', body: 'That sounds like the Build & Maintain plan. Let’s focus on making the business look credible and giving you a site I can keep updated for you.' },
  { label: 'They want more clients', body: 'That sounds more like Growth. The website is the foundation, and the monthly work is what keeps improving how often the business gets found.' },
  { label: 'They need to think', body: 'That makes sense. What part do you feel you still need to think through—the website itself, which plan fits, or the timing?' },
  { label: 'They need a partner', body: 'Absolutely. Would it help if we scheduled a short follow-up with both of you so I can answer the same questions once?' },
] as const;

export function OpenSalesCallModal({
  lead,
  onClose,
  onCallOutcome,
  onMoveToClients,
  onNotInterested,
  onFollowUpSent,
  onEmailCaptured,
  showToast,
  initialWarm = false,
  initialEmailBridge = false,
  callApproach,
  externalRecorderRef,
  externalNotes,
  onExternalNotesChange,
  externalRecordingCallId,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onCallOutcome: (lead: PipelineLead, outcome: CallOutcome, selectedPlan?: SelectedPlan, notes?: string, recordingCallId?: number, badContactReason?: BadContactReason, callbackDate?: string) => Promise<boolean>;
  onMoveToClients: (lead: PipelineLead, selectedPlan: SelectedPlan, commitmentTerm: 'ongoing_hosting' | '6_months' | '12_months') => Promise<void>;
  onNotInterested: (lead: PipelineLead, closeout: NotInterestedCloseout, recordingCallId?: number) => Promise<void>;
  // Channel-recovery hooks — provided only by the Text Outreach page, where
  // "the texts never landed" is a real failure mode. The email-outreach page
  // reuses this modal and omits them, which hides the recovery section.
  onFollowUpSent?: (leadId: number, messageBody: string) => Promise<void>;
  onEmailCaptured?: () => void;
  showToast: ShowToast;
  initialWarm?: boolean;
  initialEmailBridge?: boolean;
  callApproach?: 'direct' | 'question_based';
  externalRecorderRef: RefObject<RecordButtonHandle | null>;
  externalNotes?: string;
  onExternalNotesChange?: (value: string) => void;
  externalRecordingCallId?: number | null;
}) {
  const [loggingOutcome, setLoggingOutcome] = useState<CallOutcome | null>(null);
  const [callbackDate, setCallbackDate] = useState('');
  const [script, setScript] = useState<Script | null>(null);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [stageIndex, setStageIndex] = useState(0);
  const [stageHistory, setStageHistory] = useState<number[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<SelectedPlan | null>(null);
  const [commitmentTerm, setCommitmentTerm] = useState<'ongoing_hosting' | '6_months' | '12_months' | ''>('');
  const [internalNotes, setInternalNotes] = useState('');
  const [openResponse, setOpenResponse] = useState<string | null>(null);
  const [archivingNotInterested, setArchivingNotInterested] = useState(false);
  const [notInterestedOpen, setNotInterestedOpen] = useState(false);
  const recorderRef = externalRecorderRef;
  const notes = externalNotes ?? internalNotes;
  const setNotes = onExternalNotesChange ?? setInternalNotes;
  const recordingCallId = externalRecordingCallId ?? null;
  const scriptTopRef = useRef<HTMLDivElement | null>(null);
  const progress = getEngagedProgress(lead);
  const noReplyProgress = getNoReplyProgress(lead);
  const isLastChanceCall = progress?.action === 'call' || noReplyProgress?.action === 'call';
  // Mid-call pivot: a last-chance lead can turn interested on the phone. The
  // override opens the warm sales script UI without touching lead status —
  // status still flips via the tracked link or the close-out outcome.
  const [warmOverride, setWarmOverride] = useState(initialWarm);
  const isWarm = warmOverride || (lead.status === 'engaged' && lead.sessions > 0);
  // Channel recovery: the texts may never have landed (wrong line type,
  // unread inbox). The operator can resend the tracked link or capture an
  // email and hand the lead to the email-outreach motion mid-call. Both
  // paths keep THIS modal open — the operator is mid-conversation and must
  // not lose the lead they're selling.
  const [recoverEmail, setRecoverEmail] = useState('');
  const [capturingEmail, setCapturingEmail] = useState(false);
  const [emailCapturedDone, setEmailCapturedDone] = useState(false);
  const [introEmailSent, setIntroEmailSent] = useState(initialEmailBridge);
  const [showResendComposer, setShowResendComposer] = useState(false);
  // After the intro email fires mid-call, the warm script opens on an
  // "email track" bridge stage — walk them to their inbox and onto the site
  // before asking for their reaction.
  const [emailBridgeDone, setEmailBridgeDone] = useState(false);

  const captureEmailAndSwitch = async () => {
    const nextEmail = recoverEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      showToast('Enter a valid email address', 'error');
      return;
    }
    setCapturingEmail(true);
    try {
      // Email + ready_to_send + Email Captured is the canonical capture shape:
      // the backend logs email_captured and schedules the email automation
      // (the intro email sends from the Email Outreach queue). Attribution
      // derives from those email rows, so this call is what flips the lead's
      // channel to email.
      await api.leads.update(lead.id, {
        email: nextEmail,
        pipeline_status: 'ready_to_send',
        outcome: 'Email Captured',
      });
      // Texting demonstrably didn't reach them — route the phone to the call
      // motion so the lead leaves the Text Outreach queue for good.
      await api.leads.updatePhoneRoute(lead.id, 'call');
      // Fire the intro email NOW — the prospect is on the phone and can
      // check their inbox while the operator talks. send_now advances the
      // automation past its review window into the normal follow-up flow.
      try {
        const { automation } = await api.emailOutreach.automation(lead.id);
        await api.emailOutreach.automationAction(automation.id, 'send_now');
        setIntroEmailSent(true);
        // Jump straight onto the email track — the operator is mid-sentence
        // ("just sent it — check your inbox") and shouldn't need a click to
        // get the script for that moment.
        setWarmOverride(true);
        showToast('Email captured — intro email sent. Have them check their inbox.');
      } catch {
        showToast('Email captured, but the intro email could not send right now — review it on the Email Outreach page.', 'error');
      }
      setEmailCapturedDone(true);
      // Refresh the board behind the modal; the modal itself stays open so
      // the operator can finish the conversation.
      onEmailCaptured?.();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not capture email: ${msg}`, 'error');
    } finally {
      setCapturingEmail(false);
    }
  };

  useEffect(() => {
    let active = true;
    api.playbook.script('warm-lead-sales-call')
      .then(({ script: loaded }) => { if (active) setScript(loaded); })
      .catch((err) => { if (active) setScriptError(err instanceof ApiError ? err.message : 'Could not load sales script'); });
    return () => { active = false; };
  }, []);

  const activeStage = script?.stages[stageIndex] ?? null;

  useEffect(() => {
    if (!script) return;
    requestAnimationFrame(() => {
      scriptTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [script, stageIndex]);

  const goToStage = (stageId: string) => {
    if (!script) return;
    const target = script.stages.findIndex((stage) => stage.id === stageId);
    if (target < 0 || target === stageIndex) return;
    setStageHistory((history) => [...history, stageIndex]);
    setStageIndex(target);
  };

  const goBack = () => {
    setStageHistory((history) => {
      const previous = history[history.length - 1];
      if (previous == null) return history;
      setStageIndex(previous);
      return history.slice(0, -1);
    });
  };

  const choosePlan = (plan: SelectedPlan) => {
    setSelectedPlan(plan);
    goToStage(plan === 'Growth' ? 'growth' : 'presence');
  };

  const chooseOutcome = async (outcome: CallOutcome, badContactReason?: BadContactReason) => {
    if (outcome === 'talk_later' && !callbackDate) {
      showToast('Choose a follow-up date first', 'error');
      return;
    }
    setLoggingOutcome(outcome);
    const savedRecording = await recorderRef.current?.stopAndSave();
    const recorded = await onCallOutcome(lead, outcome, selectedPlan ?? undefined, notes.trim() || undefined, savedRecording?.callId ?? recordingCallId ?? undefined, badContactReason, outcome === 'talk_later' ? callbackDate : undefined);
    setLoggingOutcome(null);
    if (!recorded) return;
    if (outcome === 'interested' && selectedPlan && commitmentTerm) {
      await onMoveToClients(lead, selectedPlan, commitmentTerm);
      return;
    }
    onClose();
  };

  const submitNotInterested = async (closeout: NotInterestedCloseout) => {
    setArchivingNotInterested(true);
    try {
      const savedRecording = await recorderRef.current?.stopAndSave();
      await onNotInterested(lead, closeout, savedRecording?.callId ?? recordingCallId ?? undefined);
      setNotInterestedOpen(false);
    } finally {
      setArchivingNotInterested(false);
    }
  };

  const decisionClass = 'inline-flex w-auto items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold leading-5 text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
  const primaryDecisionClass = 'inline-flex w-auto items-center gap-1.5 rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-left text-xs font-semibold leading-5 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

  const showEmailBridge = isWarm && introEmailSent && !emailBridgeDone;

  const renderStageActions = () => {
    if (!isWarm) return (
      <button type="button" onClick={() => setWarmOverride(true)} className={primaryDecisionClass}>
        They’re interested — open the sales script <ChevronRight className="h-3.5 w-3.5" />
      </button>
    );
    if (showEmailBridge) return (
      <>
        <button type="button" onClick={() => setEmailBridgeDone(true)} className={primaryDecisionClass}>They can see the website — get their reaction <ChevronRight className="h-3.5 w-3.5" /></button>
      </>
    );
    if (!activeStage) return null;
    if (activeStage.id === 'opening') return (
      <>
        <button type="button" onClick={() => void chooseOutcome('feedback_only')} disabled={loggingOutcome !== null} className={decisionClass}>Feedback only — nurture</button>
        <button type="button" onClick={() => goToStage('needs')} className={primaryDecisionClass}>They want to discuss moving forward <ChevronRight className="h-3.5 w-3.5" /></button>
      </>
    );
    if (activeStage.id === 'needs') return (
      <>
        <button type="button" onClick={() => goToStage('unsure')} className={decisionClass}>They are not sure</button>
        <button type="button" onClick={() => choosePlan('Build & Maintain')} className={primaryDecisionClass}>Professional presence</button>
        <button type="button" onClick={() => choosePlan('Growth')} className={primaryDecisionClass}>More clients</button>
      </>
    );
    if (activeStage.id === 'presence') return (
      <>
        <button type="button" onClick={() => goToStage('unsure')} className={decisionClass}>They are still unsure</button>
        <button type="button" onClick={() => goToStage('next-steps')} className={primaryDecisionClass}>Continue with Build & Maintain <ChevronRight className="h-3.5 w-3.5" /></button>
      </>
    );
    if (activeStage.id === 'growth') return (
      <>
        <button type="button" onClick={() => goToStage('unsure')} className={decisionClass}>They are still unsure</button>
        <button type="button" onClick={() => goToStage('next-steps')} className={primaryDecisionClass}>Continue with Growth <ChevronRight className="h-3.5 w-3.5" /></button>
      </>
    );
    if (activeStage.id === 'unsure') return (
      <>
        <button type="button" onClick={() => choosePlan('Build & Maintain')} className={primaryDecisionClass}>Professional presence</button>
        <button type="button" onClick={() => choosePlan('Growth')} className={primaryDecisionClass}>More clients and visibility</button>
      </>
    );
    if (activeStage.id === 'next-steps') return <button type="button" onClick={() => goToStage(selectedPlan === 'Growth' ? 'growth-process' : 'full-close')} className={primaryDecisionClass}>{selectedPlan === 'Growth' ? 'Explain Growth after launch' : 'Finish the close'} <ChevronRight className="h-3.5 w-3.5" /></button>;
    if (activeStage.id === 'growth-process') return <button type="button" onClick={() => goToStage('full-close')} className={primaryDecisionClass}>Finish the close <ChevronRight className="h-3.5 w-3.5" /></button>;
    if (activeStage.id === 'full-close') return (
      <div className="flex w-full flex-wrap items-end justify-end gap-3">
        <fieldset className="min-w-0 flex-1 sm:max-w-2xl">
          <legend className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Confirm commitment</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(selectedPlan === 'Growth'
              ? [
                  { value: '6_months' as const, label: '6-month Growth', detail: '$499 website build · $499/month' },
                  { value: '12_months' as const, label: '12-month Growth', detail: 'Website build waived · $499/month' },
                ]
              : [
                  { value: 'ongoing_hosting' as const, label: 'Month-to-month hosting', detail: '$79/month after launch' },
                  { value: '12_months' as const, label: 'One-year hosting', detail: '$50/month after launch' },
                ]
            ).map((option) => {
              const selected = commitmentTerm === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCommitmentTerm(option.value)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${selected
                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                    : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'}`}
                >
                  <span className={`flex items-center gap-2 text-xs font-semibold ${selected ? 'text-blue-800' : 'text-slate-700'}`}>
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${selected ? 'border-blue-600 bg-blue-600' : 'border-slate-300'}`}>
                      {selected && <Check className="h-3 w-3 text-white" />}
                    </span>
                    {option.label}
                  </span>
                  <span className="mt-1 block pl-6 text-[11px] text-slate-500">{option.detail}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <button type="button" onClick={() => void chooseOutcome('interested')} disabled={!selectedPlan || !commitmentTerm || loggingOutcome !== null} className={primaryDecisionClass}>
          {loggingOutcome === 'interested' ? 'Advancing…' : selectedPlan ? `Advance to client · ${selectedPlan}` : 'Select a plan to continue'}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
    return null;
  };

  return (
    <ModalShell
      title="Open sales call"
      subtitle={`${lead.name} · ${isLastChanceCall ? 'Final attempt' : isWarm ? 'Warm lead' : 'Follow-up'}`}
      onClose={onClose}
      wide
      headerActions={<a href={`tel:${lead.phone}`} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"><PhoneCall className="h-3.5 w-3.5" /> Call {lead.phone}</a>}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {isWarm && stageHistory.length > 0 && (
              <button type="button" onClick={goBack} className={decisionClass}><ChevronLeft className="h-3.5 w-3.5" /> Back</button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {renderStageActions()}
          </div>
        </div>
      }
    >
      <div className="grid min-h-[560px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="border-b border-slate-200 px-5 py-5 lg:border-b-0 lg:border-r">
          <div ref={scriptTopRef} />
          <div className={`mb-5 rounded-xl border px-3 py-2.5 text-xs ${isWarm ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-rose-100 bg-rose-50 text-rose-700'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{warmOverride ? 'Interested on the call' : isWarm ? (lead.engagementScore >= 90 ? 'Call now' : 'Ready for sales call') : 'Final call attempt'}</span>
              <span>{lead.sessions} session{lead.sessions === 1 ? '' : 's'} · score {lead.engagementScore}</span>
            </div>
            <p className="mt-1 opacity-80">
              {warmOverride
                ? 'They showed interest during the last-chance call. Work the plan conversation and close.'
                : isWarm
                  ? 'Use their reaction to the site to identify the right plan, then move directly into closing steps.'
                  : 'The outreach sequence is complete. Record this call before the lead can leave the active workflow.'}
            </p>
          </div>

          {isWarm && showEmailBridge ? (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Warm-lead sales call · email track</p>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">GET THEM TO THE INBOX</h3>
              <div className="mt-5 border-l-2 border-blue-200 pl-4 text-[17px] leading-8 text-slate-700 sm:pl-5">
                <p>“Alright — it’s on its way. You’ll see an email from Shaun Gehrke at Shaun Carl Designs, subject line ‘I built something for {lead.name}.’”</p>
                <p className="mt-4">“If you have a minute, I can walk through it with you, or you can look through it on your own time and let me know what stands out. Which one is easier for ya?”</p>
              </div>
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">If they want to walk through it now</p>
                <div className="mt-2">
                  <ScriptParagraph>“Did the email come through?”</ScriptParagraph>
                  <ScriptParagraph>“Great. Go ahead and open it, click the link to view the website, and let me know when you can see the homepage.”</ScriptParagraph>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
                <p className="font-semibold text-slate-700">While the email lands — keep it easy:</p>
                <p className="mt-1.5">“While that comes through — how long have you been running {lead.name}?”</p>
                <p className="mt-1.5">“Busy season treating you alright{lead.city ? ` out in ${lead.city}` : ''}?”</p>
                <p className="mt-1.5">“Don’t see it yet? Give it a few seconds — and peek at spam or promotions just in case.”</p>
              </div>
              {cleanSiteUrl(lead.rawUrl, lead.url) && (
                <a
                  href={cleanSiteUrl(lead.rawUrl, lead.url) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                >
                  <Link2 className="h-3.5 w-3.5" /> Open the site on your side — walk it together
                </a>
              )}
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                Open the site on your own screen (button above — it’s the untracked link, so it won’t count as their visit) so you’re both looking at the same thing when they land on it. Do not advance until they say they can see the homepage. If the email never arrives, confirm the address before retrying. If they can’t get to their email right now, record “Follow up later” — the email sequence takes over from here.
              </div>
              <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">If they’ll look later · close before clicking</p>
                <p className="mt-1.5">“No problem at all. Take a look when you have a chance, and I’ll follow up in a couple of days to see what stood out or what you’d want changed. Thanks for taking the call.”</p>
              </div>
            </section>
          ) : isWarm ? (
            <>
              {scriptError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{scriptError}</div>}
              {!script && !scriptError && <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-blue-500" /></div>}
              {activeStage && (() => {
                // Mid-call pivot: the intro already happened via the
                // last-chance opener, so the opening stage swaps to the
                // trimmed reaction-only version.
                const overrideOpening = warmOverride && activeStage.id === 'opening';
                const questionBasedBody = callApproach === 'question_based'
                  ? QUESTION_BASED_FOLLOWUP_COPY[activeStage.id]
                  : undefined;
                const stageLabel = questionBasedBody?.label ?? (overrideOpening ? 'GET THEIR REACTION' : activeStage.label);
                const stageBody = questionBasedBody?.body ?? (overrideOpening ? OVERRIDE_OPENING_BODY : activeStage.body);
                const stageNote = overrideOpening ? OVERRIDE_OPENING_NOTE : activeStage.note;
                return (
                  <section>
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Warm-lead sales call{overrideOpening ? ' · continued from last-chance opener' : ''}</p>
                        <h3 className="mt-1 text-xl font-semibold text-slate-900">{stageLabel}</h3>
                      </div>
                      {selectedPlan && <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">{selectedPlan}</span>}
                    </div>
                    <div className="border-l-2 border-blue-200 pl-4 text-[17px] leading-8 text-slate-700 sm:pl-5">
                      {interpolate(stageBody, {
                        company: lead.name,
                        contact_name: lead.ownerFirst,
                        city: lead.city,
                        trade: lead.category,
                      }).split(/\n{2,}/).map((paragraph) => <ScriptParagraph key={paragraph}>{paragraph}</ScriptParagraph>)}
                    </div>
                    {stageNote && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">{stageNote}</div>}
                    {activeStage.id === 'opening' && (
                      <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">If they need to follow up later · close before clicking</p>
                        <p className="mt-1.5">“No problem at all. Take your time with it. I’ll follow up in a couple of days and see what stood out or what you’d want changed. Thanks for taking the call.”</p>
                      </div>
                    )}
                  </section>
                );
              })()}
            </>
          ) : (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">Last-attempt call</p>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">Confirm interest before closing the outreach loop.</h3>
              <div className="mt-5 border-l-2 border-rose-200 pl-5 text-[17px] leading-8 text-slate-700">
                <ScriptParagraph>{`“Hey ${lead.ownerFirst}, it’s Shaun. I wanted to make one quick call about the homepage I put together for ${lead.name} before I close this out.”`}</ScriptParagraph>
                <ScriptParagraph>“Did you get a chance to take a look, and is it worth having a quick conversation about?”</ScriptParagraph>
              </div>
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">If they are interested, use <strong>“They’re interested — open the sales script”</strong> below to continue into the warm sales conversation. If they are not interested or do not answer, record that outcome in the sidebar.</div>

              {lead.status === 'sent_no_reply' && onFollowUpSent && onEmailCaptured && (
                // A successful capture auto-pivots onto the warm email track,
                // so the only post-capture state this pane can show is the
                // send failure.
                emailCapturedDone ? (
                  <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-700">
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">Email captured — send failed</p>
                    <p className="mt-1">The intro email did not send. The lead is in the Email Outreach queue — review and send it there. You can finish the call as normal.</p>
                  </div>
                ) : (
                  <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                    <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">If they never saw the text</p>
                      <div className="mt-2">
                        <ScriptParagraph>“No problem. I can resend the link so it’s right at the top of your messages, or if email is easier, I can send it there instead. Which works better for you?”</ScriptParagraph>
                        <ScriptParagraph>“Sure—what’s the best email address for you?”</ScriptParagraph>
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-blue-700">Use the resend button in Call Context if they prefer text. If they choose email, enter it below and send the site while they are still on the call.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-slate-500" />
                      <span className="text-sm font-semibold text-slate-900">Capture email</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        type="email"
                        value={recoverEmail}
                        onChange={(event) => setRecoverEmail(event.target.value)}
                        placeholder="owner@business.com"
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      />
                      <button
                        type="button"
                        onClick={() => void captureEmailAndSwitch()}
                        disabled={capturingEmail || !recoverEmail.trim()}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                      >
                        {capturingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {capturingEmail ? 'Sending…' : 'Capture & email the site'}
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Sends the intro email with the site link right away, and moves this lead to the Email Outreach queue for follow-ups — engagement is then attributed to email, not text.
                    </p>
                  </section>
                )
              )}
            </section>
          )}
        </div>

        <aside className="bg-slate-50/70 px-5 py-5">
          {isWarm && (
            <>
              {selectedPlan && (
                <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Selected direction</p>
                  <p className="mt-1 text-sm font-semibold text-emerald-800">{selectedPlan}</p>
                </div>
              )}
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Objection responses</p>
              <div className="mt-3 space-y-2">
                {WARM_CALL_RESPONSES.map((response) => (
                  <div key={response.label} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <button type="button" onClick={() => setOpenResponse(openResponse === response.label ? null : response.label)} className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left text-xs font-semibold text-slate-700">{response.label}<ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${openResponse === response.label ? 'rotate-180' : ''}`} /></button>
                    {openResponse === response.label && <p className="border-t border-slate-100 px-3 py-3 text-xs leading-5 text-slate-600">{response.body}</p>}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className={`${isWarm ? 'mt-6' : ''} rounded-xl border border-slate-200 bg-white p-3.5`}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Call context</p><p className="mt-1 text-xs text-slate-400">Useful details while talking.</p></div>
              <div className="text-right"><p className="text-lg font-bold leading-none text-slate-900">{lead.reviews}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Reviews</p></div>
            </div>
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><strong>{lead.rating ? lead.rating.toFixed(1) : 'No rating'}</strong> Google reputation</div>
            {lead.rawUrl && <a href={lead.rawUrl} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-blue-700">Open their website <ChevronRight className="h-3.5 w-3.5" /></a>}
            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Call notes</label>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="What they liked, changes requested, timing, concerns…" className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100" />
          </div>

          {lead.status === 'sent_no_reply' && onFollowUpSent && onEmailCaptured && !(emailCapturedDone && !isWarm) && (
            <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-800"><Mail className="h-3.5 w-3.5" />Texts not landing?</div>
              {emailCapturedDone ? (
                // Warm mode only — in the last-attempt view the status lives
                // in the left pane next to the capture card's old spot.
                introEmailSent ? (
                  <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] leading-4 text-emerald-800">
                    <strong>Intro email sent.</strong> Walk them to their inbox — the email-track stage on the left has the script.
                  </div>
                ) : (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] leading-4 text-rose-700">
                    <strong>Email captured, but the intro email did not send.</strong> The lead is in the Email Outreach queue — open it there to review and send. You can finish the call as normal.
                  </div>
                )
              ) : (
                <>
                  <p className="mt-1 text-[11px] leading-4 text-amber-700">
                    If they never saw the texts, resend the site now{isWarm ? ' — or capture their email to send the site by email immediately' : ' — or capture their email on the left to send the site by email immediately'}. Either way you stay in this call.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowResendComposer(true)}
                    className="mt-2.5 w-full rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-left text-xs font-medium text-amber-800 transition hover:bg-amber-100"
                  >
                    Resend the site link by text
                  </button>
                  {isWarm && (
                    <>
                      <div className="mt-2 flex gap-1.5">
                        <input
                          type="email"
                          value={recoverEmail}
                          onChange={(event) => setRecoverEmail(event.target.value)}
                          placeholder="owner@business.com"
                          className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                        />
                        <button
                          type="button"
                          onClick={() => void captureEmailAndSwitch()}
                          disabled={capturingEmail || !recoverEmail.trim()}
                          className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
                        >
                          {capturingEmail ? 'Sending…' : 'Capture & email the site'}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[10px] leading-4 text-amber-700/80">
                        Sends the intro email with the site link right away, and moves this lead to the Email Outreach queue for follow-ups — engagement is then attributed to email, not text.
                      </p>
                    </>
                  )}
                </>
              )}
            </section>
          )}

          <section className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-700"><PhoneCall className="h-3.5 w-3.5" />After the call, what happened?</div>
            <p className="mt-0.5 text-[10px] leading-4 text-blue-600">Tag the result so this card moves to the correct next step.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => void chooseOutcome('no_answer')} disabled={loggingOutcome !== null} className="rounded-lg border border-blue-200 bg-white px-2.5 py-2 text-left text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50">{loggingOutcome === 'no_answer' ? 'Recording…' : 'No answer'}</button>
              <button onClick={() => void chooseOutcome('voicemail')} disabled={loggingOutcome !== null} className="rounded-lg border border-blue-200 bg-white px-2.5 py-2 text-left text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50">{loggingOutcome === 'voicemail' ? 'Recording…' : 'Left voicemail'}</button>
              <button onClick={() => void chooseOutcome('talk_later')} disabled={loggingOutcome !== null} className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-left text-xs font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-50">{loggingOutcome === 'talk_later' ? 'Recording…' : 'Follow up later'}</button>
              <input type="date" value={callbackDate} min={localDateIso()} onChange={(event) => setCallbackDate(event.target.value)} className="h-9 rounded-lg border border-blue-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-blue-100" aria-label="Follow-up date" />
            <div className="relative col-span-2">
              <select
                defaultValue=""
                disabled={loggingOutcome !== null || archivingNotInterested}
                onChange={(event) => {
                  if (event.target.value) void chooseOutcome('bad_contact', event.target.value as BadContactReason);
                }}
                className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white py-0 pl-3 pr-10 text-xs font-medium text-slate-600 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
                aria-label="Unable to reach reason"
              >
                <option value="" disabled>Unable to reach…</option>
                <option value="disconnected">Disconnected number</option>
                <option value="wrong_number">Wrong number</option>
                <option value="no_contact">No usable contact</option>
                <option value="business_closed">Business appears closed</option>
                <option value="call_screening">Call screening blocked</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            </div>
            <button
              onClick={() => setNotInterestedOpen(true)}
              disabled={loggingOutcome !== null || archivingNotInterested}
              className="col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-left text-xs font-medium text-rose-700 transition hover:bg-rose-100"
            >
              {archivingNotInterested ? 'Saving recording…' : 'Not interested'}
            </button>
          </div>
          </section>
        </aside>
      </div>
      {/* Nested resend composer — overlays the call modal instead of
          replacing it, so closing it returns to the call in progress. */}
      {showResendComposer && onFollowUpSent && (
        <FollowUpModal
          lead={lead}
          onClose={() => setShowResendComposer(false)}
          onSent={async (leadId, messageBody) => {
            await onFollowUpSent(leadId, messageBody);
            setShowResendComposer(false);
          }}
        />
      )}
      {notInterestedOpen && (
        <NotInterestedModal
          leadName={lead.name}
          initialNote={notes}
          initialEmail={lead.email ?? ''}
          busy={archivingNotInterested}
          onClose={() => setNotInterestedOpen(false)}
          onConfirm={(closeout) => void submitNotInterested(closeout)}
        />
      )}
    </ModalShell>
  );
}

// Archiving requires a note — the operator reviews archived leads later and
// needs to see why each one left the board (STOP reply, wrong number, …).
function ArchiveNoteModal({
  lead,
  onClose,
  onConfirm,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onConfirm: (note: string, markNotInterested: boolean, reason?: NotInterestedReason) => Promise<string | null>;
}) {
  const [note, setNote] = useState('');
  const [markNotInterested, setMarkNotInterested] = useState(false);
  const [notInterestedReason, setNotInterestedReason] = useState<NotInterestedReason | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">Archive {lead.name}</h3>
        <p className="mt-1 text-xs text-slate-500">Add a note about what happened — it's saved on the lead so you can see why it was archived when you review later.</p>
        <textarea
          autoFocus
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          placeholder="e.g. Replied STOP to the intro text"
          className="mt-3 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
        />
        <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <input
            type="checkbox"
            checked={markNotInterested}
            onChange={(event) => setMarkNotInterested(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
          />
          <span>
            <span className="block text-xs font-semibold text-slate-800">They said they’re not interested</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">Also marks the CRM stage as Not interested so this lead is fully closed.</span>
          </span>
        </label>
        {markNotInterested && (
          <fieldset className="mt-3">
            <legend className="text-xs font-semibold text-slate-700">Why are they not interested? <span className="text-rose-500">*</span></legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {NOT_INTERESTED_REASONS.map((option) => (
                <button key={option.value} type="button" aria-pressed={notInterestedReason === option.value} onClick={() => setNotInterestedReason(option.value)} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${notInterestedReason === option.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50'}`}>{option.label}</button>
              ))}
            </div>
          </fieldset>
        )}
        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const trimmed = note.trim();
              if (!trimmed) return;
              if (markNotInterested && !notInterestedReason) {
                setError('Choose why they are not interested.');
                return;
              }
              setSaving(true);
              setError(null);
              void onConfirm(trimmed, markNotInterested, notInterestedReason ?? undefined)
                .then((failure) => setError(failure))
                .finally(() => setSaving(false));
            }}
            disabled={!note.trim() || saving}
            className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {saving ? 'Archiving…' : 'Archive lead'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Page ----------

type FilterKey = 'all' | 'awaiting_build' | 'built_needs_review' | 'needs_fix' | 'ready_to_send' | 'sent_no_reply' | 'last_chance' | 'engaged';

function localDateIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'awaiting_build', label: 'Awaiting build' },
  { key: 'built_needs_review', label: 'Awaiting review' },
  { key: 'needs_fix', label: 'Needs fix' },
  { key: 'ready_to_send', label: 'Ready to send' },
  { key: 'sent_no_reply', label: 'Sent — no reply' },
  { key: 'last_chance', label: 'Last chance — call' },
  { key: 'engaged', label: 'Engaged' },
];

type ModalType = 'brief' | 'text' | 'followup' | 'call' | 'detail';
type ModalState = { type: ModalType; lead: PipelineLead } | null;

type ViewMode = 'grid' | 'board';
const VIEW_KEY = 'agency-os-pipeline-view';

// Kanban columns — the active stages in flow order, plus one DERIVED column:
// "No engagement — last chance" splits out sent_no_reply leads whose text
// sequence is exhausted (next action = call) so the texting queue stays
// clean. Membership is a predicate, not a status; drops still route through
// handleBoardDrop with the column's underlying status. booked/archived stay
// off the board until they get real UI.
const BOARD_COLUMNS: Array<{
  key: string;
  label: string;
  icon: LucideIcon;
  iconBg: string;
  dropStatus: PipelineStatus;
  match: (lead: PipelineLead) => boolean;
}> = [
  {
    key: 'awaiting_build', label: 'Awaiting build',
    icon: STATUS_CONFIG.awaiting_build.icon, iconBg: STATUS_CONFIG.awaiting_build.iconBg,
    dropStatus: 'awaiting_build', match: (l) => l.status === 'awaiting_build',
  },
  {
    key: 'built_needs_review', label: 'Built needs review',
    icon: STATUS_CONFIG.built_needs_review.icon, iconBg: STATUS_CONFIG.built_needs_review.iconBg,
    dropStatus: 'built_needs_review', match: (l) => l.status === 'built_needs_review',
  },
  {
    key: 'ready_to_send', label: 'Ready to send',
    icon: STATUS_CONFIG.ready_to_send.icon, iconBg: STATUS_CONFIG.ready_to_send.iconBg,
    dropStatus: 'ready_to_send', match: (l) => l.status === 'ready_to_send',
  },
  {
    key: 'sent_no_reply', label: 'Sent — no reply',
    icon: STATUS_CONFIG.sent_no_reply.icon, iconBg: STATUS_CONFIG.sent_no_reply.iconBg,
    dropStatus: 'sent_no_reply', match: (l) => l.status === 'sent_no_reply' && !isLastChanceNoReply(l),
  },
  {
    key: 'engaged', label: 'Engaged',
    icon: STATUS_CONFIG.engaged.icon, iconBg: STATUS_CONFIG.engaged.iconBg,
    dropStatus: 'engaged', match: (l) => l.status === 'engaged',
  },
  {
    key: 'last_chance', label: 'No engagement — last chance',
    icon: PhoneCall, iconBg: 'bg-gradient-to-br from-rose-500 to-red-600',
    dropStatus: 'sent_no_reply', match: isLastChanceNoReply,
  },
];

// Compact card for the board view. Draggable; the stage action + View lead
// stay one tap away so the board is workable, not just a status readout.
function BoardCard({
  lead,
  onAction,
  onViewLead,
  onArchive,
  onReply,
  onNeedsFix,
}: {
  lead: PipelineLead;
  onAction: (l: PipelineLead) => void;
  onViewLead: (l: PipelineLead) => void;
  onArchive: (l: PipelineLead) => void;
  onReply: (l: PipelineLead) => void;
  onNeedsFix: (l: PipelineLead) => void;
}) {
  const cfg = STATUS_CONFIG[lead.status];
  const rec = getOutreachRecommendation({
    status: lead.status,
    sessions: lead.sessions,
    engagementScore: lead.engagementScore,
    replied: lead.replied,
    lastVisitAt: lead.pipelineLastActionAt,
  });
  const progress = getEngagedProgress(lead);
  const noReplyProgress = getNoReplyProgress(lead);
  const actionLabel =
    noReplyProgress?.actionLabel
    ?? progress?.actionLabel
    ?? rec?.label
    ?? cfg.action;
  const isCallAction =
    noReplyProgress?.action === 'call'
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
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              lead.reviewStatus === 'needs_fix'
                ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800'
                : lead.status === 'built_needs_review'
                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800'
            }`}
          >
            {lead.reviewStatus === 'needs_fix' ? 'Edit fix note' : lead.status === 'built_needs_review' ? 'Review site' : 'Site built'}
          </a>
        </div>
      )}
      {lead.status === 'built_needs_review' && lead.reviewStatus === 'needs_fix' && (
        <SiteReviewIssueSummary reasons={lead.reviewReasons} note={lead.reviewNote} />
      )}
      {rec && <EngagedRecommendationPanel lead={lead} compact />}
      {lead.status === 'sent_no_reply' && (
        <NoReplyProgressPanel lead={lead} compact />
      )}
      {isStaleLead(lead) && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-800">
          <strong>Stale {lead.status === 'sent_no_reply' ? '14+' : '30+'} days.</strong> Make one last attempt or archive.
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            onClick={() => onAction(lead)}
            className="flex w-fit min-w-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-2 py-1 text-xs font-medium text-white shadow-sm shadow-blue-600/20"
          >
            {isCallAction && <PhoneCall className="h-3 w-3 shrink-0" strokeWidth={2.25} />}
            <span className="truncate">{actionLabel}</span>
            <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2.5} />
          </button>
          {lead.status === 'built_needs_review' && (
            <button type="button" onClick={() => onNeedsFix(lead)} className="shrink-0 rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-50">
              {lead.reviewStatus === 'needs_fix' ? 'Edit fix note' : 'Needs fix'}
            </button>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {(lead.status === 'sent_no_reply' || lead.status === 'engaged') && (
            <button
              onClick={() => onArchive(lead)}
              title="Archive — not interested or asked to stop"
              aria-label={`Archive ${lead.name}`}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                isStaleLead(lead)
                  ? 'text-amber-700 hover:bg-amber-50 hover:text-amber-800'
                  : 'text-slate-400 hover:bg-rose-50 hover:text-rose-600'
              }`}
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
  built_needs_review: 'detail',
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
  const pipelineCallRecorderRef = useRef<RecordButtonHandle>(null);
  const [pipelineCallRecordingId, setPipelineCallRecordingId] = useState<number | null>(null);
  const [qualifyLead, setQualifyLead] = useState<Lead | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<PipelineLead | null>(null);
  const [fixTarget, setFixTarget] = useState<PipelineLead | null>(null);
  const activeCallLeadId = modal?.type === 'call' ? modal.lead.id : null;

  useEffect(() => {
    setPipelineCallRecordingId(null);
  }, [activeCallLeadId]);
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

  const openFor = (lead: PipelineLead) => {
    if (lead.status === 'built_needs_review') {
      void approveSite(lead);
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
        replied: lead.replied,
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
    offerUndo(leadId, 'URL saved');
  };

  const approveSite = async (lead: PipelineLead) => {
    try {
      const { lead: updated } = await api.pipeline.approveSite(lead.id);
      applyMutation(updated, 'site_approved');
      showToast(`${lead.name} approved and ready to send`, 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not approve site';
      showToast(msg, 'error');
    }
  };

  const saveNeedsFix = async (lead: PipelineLead, reasons: string[], note: string) => {
    const { lead: updated } = await api.pipeline.updateSiteReview(lead.id, {
      status: 'needs_fix', reasons, note,
    });
    applyMutation(updated, 'site_needs_fix');
    setFixTarget(null);
    showToast(`${lead.name} marked Needs fix`, 'success');
  };

  const undoAction = async (leadId: number) => {
    try {
      const result = await api.pipeline.undo(leadId);
      if (result?.lead) applyMutation(result.lead, null);
      showToast('Action undone', 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Undo failed';
      showToast(msg, 'error');
    }
  };

  const offerUndo = (leadId: number, message: string) => {
    showToast(message, 'success', {
      label: 'Undo',
      onClick: () => undoAction(leadId),
    });
  };

  const runAction = async (
    leadId: number,
    action:
      | 'intro_sent'
      | 'followed_up'
      | 'reply_received'
      | 'call_outcome'
      | 'called'
      | 'archived',
    toastMessage: string,
    meta?: unknown,
    showErrorToast = true,
  ): Promise<string | null> => {
    try {
      const { lead } = await api.pipeline.action(leadId, { action, meta });
      applyMutation(lead, action);
      setModal(null);
      offerUndo(leadId, toastMessage);
      return null;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Action failed';
      if (showErrorToast) showToast(msg, 'error');
      return msg;
    }
  };

  const markSent = async (leadId: number, messageBody: string) => {
    await runAction(leadId, 'intro_sent', "Moved to Sent — no reply. Didn't send it?", { body: messageBody });
  };

  const markFollowedUp = async (leadId: number, messageBody: string) => {
    await runAction(leadId, 'followed_up', 'Follow-up marked', { body: messageBody });
  };

  const recordCallOutcome = async (
    lead: PipelineLead,
    outcome: CallOutcome,
    selectedPlan?: SelectedPlan,
    notes?: string,
    recordingCallId?: number,
    badContactReason?: BadContactReason,
    callbackDate?: string,
  ): Promise<boolean> => {
    try {
      const { lead: updated } = await api.pipeline.action(lead.id, {
        action: 'call_outcome',
        meta: { outcome, selected_plan: selectedPlan ?? null, notes: notes ?? null, recording_call_id: recordingCallId ?? null, bad_contact_reason: badContactReason ?? null, callback_date: callbackDate ?? null },
      });
      applyMutation(updated, 'call_outcome');
      return true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not record call outcome';
      showToast(msg, 'error');
      return false;
    }
  };

  const archiveLead = (lead: PipelineLead) => setArchiveTarget(lead);

  const confirmArchive = async (note: string, markNotInterested: boolean, notInterestedReason?: NotInterestedReason): Promise<string | null> => {
    const lead = archiveTarget;
    if (!lead) return null;
    const error = await runAction(
      lead.id,
      'archived',
      'Lead archived',
      {
        reason: markNotInterested ? 'declined_by_reply' : isStaleLead(lead) ? 'stale_outreach' : 'operator_archive',
        note,
        mark_not_interested: markNotInterested,
        not_interested_reason: markNotInterested ? notInterestedReason ?? null : null,
      },
      false, // the modal stays open and renders the error itself
    );
    if (error) return error;
    // Mirror the note onto the lead record itself, where it's visible when
    // reviewing archived leads in the detail modal — but only once the archive
    // actually landed, so a rejected attempt can't stamp "Archived:" onto a
    // lead that never left the board. Non-fatal if it fails — the note also
    // lives in the archive activity's meta.
    try {
      await api.leads.appendNote(lead.id, `Archived: ${note}`);
    } catch {
      // activity meta still carries the note
    }
    setArchiveTarget(null);
    return null;
  };

  const markNotInterested = async (lead: PipelineLead, closeout: NotInterestedCloseout, recordingCallId?: number) => {
    try {
      const { lead: updated } = await api.pipeline.action(lead.id, {
        action: 'call_outcome',
        meta: {
          outcome: 'not_interested',
          not_interested_reason: closeout.reason,
          notes: closeout.note,
          recording_call_id: recordingCallId ?? null,
          receptionist_interested: closeout.receptionistInterested,
          receptionist_email: closeout.email ?? null,
        },
      });
      applyMutation(updated, 'call_outcome');
      setModal(null);
      showToast('Call recorded and lead archived');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not mark lead not interested', 'error');
    }
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

  const moveToClients = async (lead: PipelineLead, selectedPlan: SelectedPlan) => {
    const tier: 2 | 3 = selectedPlan === 'Growth' ? 3 : 2;
    try {
      const { project } = await api.leads.convertToClient(lead.id, {
        tier,
        initialStatus: 'prospect',
        note: `${selectedPlan} selected during warm sales call.`,
      });
      setLeads((current) => current.filter((item) => item.id !== lead.id));
      setModal(null);
      showToast(`${lead.name} moved to Clients — agreement pending`, 'success');
      onQualified?.(project, tier);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not create pending client', 'error');
    }
  };

  // Board drops are REAL status changes routed through the same guarded
  // transitions as the buttons — see the drop rules below. Invalid moves
  // explain themselves instead of silently repainting a column.
  const handleBoardDrop = (leadId: number, to: PipelineStatus) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === to) return;
    if (lead.status === 'awaiting_build' && (to === 'built_needs_review' || to === 'ready_to_send')) {
      // The move requires a live URL — the brief modal's Save completes it.
      setModal({ type: 'brief', lead });
      showToast('Paste the live site URL to move this lead to Built needs review');
    } else if (lead.status === 'built_needs_review' && to === 'ready_to_send') {
      void approveSite(lead);
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
    () => visibleLeads.filter((l) => {
      if (filter === 'all') return true;
      if (filter === 'last_chance') return isLastChanceNoReply(l);
      if (filter === 'needs_fix') return l.status === 'built_needs_review' && l.reviewStatus === 'needs_fix';
      if (filter === 'built_needs_review') return l.status === 'built_needs_review' && l.reviewStatus !== 'needs_fix';
      if (filter === 'sent_no_reply') return l.status === 'sent_no_reply' && !isLastChanceNoReply(l);
      return l.status === filter;
    }),
    [visibleLeads, filter],
  );

  const counts = useMemo(
    () =>
      visibleLeads.reduce<Record<string, number>>((acc, l) => {
        const key = isLastChanceNoReply(l) ? 'last_chance' : l.status;
        if (l.status === 'built_needs_review' && l.reviewStatus === 'needs_fix') {
          acc.needs_fix = (acc.needs_fix || 0) + 1;
        } else {
          acc[key] = (acc[key] || 0) + 1;
        }
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
              const ColIcon = col.icon;
              const items = visibleLeads.filter(col.match);
              return (
                <div
                  key={col.key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
                    if (!isNaN(id)) handleBoardDrop(id, col.dropStatus);
                  }}
                  className="w-72 shrink-0 rounded-2xl bg-slate-100/80 p-2.5"
                >
                  <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full ${col.iconBg}`}
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
                        onNeedsFix={setFixTarget}
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
                onNeedsFix={setFixTarget}
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
      {fixTarget && (
        <SiteReviewFixModal
          leadName={fixTarget.name}
          initialReasons={fixTarget.reviewReasons}
          initialNote={fixTarget.reviewNote ?? ''}
          onClose={() => setFixTarget(null)}
          onSave={(reasons, note) => saveNeedsFix(fixTarget, reasons, note)}
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
        <OpenSalesCallModal
          lead={modal.lead}
          onClose={() => setModal(null)}
          onCallOutcome={recordCallOutcome}
          onMoveToClients={moveToClients}
          onNotInterested={markNotInterested}
          onFollowUpSent={markFollowedUp}
          onEmailCaptured={() => void loadLeads()}
          showToast={showToast}
          externalRecorderRef={pipelineCallRecorderRef}
          externalRecordingCallId={pipelineCallRecordingId}
        />
      )}
      {modal?.type === 'call' && (
        <div className="fixed right-16 top-4 z-[230] sm:right-20">
          <RecordButton
            ref={pipelineCallRecorderRef}
            leadId={modal.lead.id}
            showToast={showToast}
            resetKey={modal.lead.id}
            onRecorded={(_url, callId) => setPipelineCallRecordingId(callId)}
          />
        </div>
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

      {archiveTarget && (
        <ArchiveNoteModal
          lead={archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onConfirm={confirmArchive}
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

    </div>
  );
}
