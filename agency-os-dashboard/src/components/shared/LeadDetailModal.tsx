import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Phone,
  Globe,
  MapPin,
  Clock,
  ExternalLink,
  Loader2,
  Map as MapIcon,
  Sparkles,
  Target,
  Gem,
  AlertTriangle,
  DollarSign,
  RefreshCw,
  Copy,
} from 'lucide-react';
import type { Lead, CallEntry, LeadActivity, ShowToast } from '../../lib/types';
import { api, ApiError, type PhoneRoute } from '../../lib/api';
import { CallLogTab } from '../pipeline/CallLogTab';
import { StarRating } from './StarRating';
import { ScoreHover } from './ScoreHover';
import { formatPhone, parseList, stars, googleMapsUrl } from '../../lib/format';
import { type Tier, tierPitchBlurb } from '../../lib/pricing';

// ---------------------------------------------------------------------------
// Shared lead-detail modal — the single rich lead view used by BOTH the Cold
// Call Pipeline (row click) and the Automated Pipeline ("View lead").
//
// Merges the old pipeline/LeadModal content (Overview / Reviews / Pitch Prep
// / Call Log tabs, Google Maps card, tier + opportunity score banner,
// outcome/stage/tier editors, Book demo) into the Automated Pipeline's
// Tailwind visual language (rounded-2xl, slate palette, gradient primary).
//
// `pipelineContext` adds an Activity tab with the text+site outreach trail.
// ---------------------------------------------------------------------------

type DetailTab = 'overview' | 'notes' | 'reviews' | 'pitch' | 'call' | 'activity';

interface Props {
  leadId: number;
  onClose: () => void;
  showToast: ShowToast;
  /** Called after any field edit (outcome/stage/tier) so list views can refresh. */
  onLeadUpdated?: () => void;
  /** When provided, an eligible lead gets the "→ Book demo" footer action. */
  onQualify?: (lead: Lead) => void;
  /** Automated Pipeline context: adds the Activity tab (site sessions +
   *  outreach trail from lead_activity). */
  pipelineContext?: boolean;
}

interface RawReview {
  author: string;
  rating: number;
  text: string;
  relativeTime?: string;
  publishTime?: string;
}
interface PitchQuote {
  author: string;
  location?: string;
  quote: string;
  why?: string;
}

const TIER_BANNER: Record<1 | 2 | 3, { bg: string; text: string; pill: string }> = {
  1: { bg: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700', pill: 'bg-emerald-500' },
  2: { bg: 'bg-amber-50 border-amber-100', text: 'text-amber-700', pill: 'bg-amber-500' },
  3: { bg: 'bg-violet-50 border-violet-100', text: 'text-violet-700', pill: 'bg-violet-500' },
};

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

// Verb for the footer Activity card, derived from the most recent outreach
// activity when available, otherwise from enrichment state.
function lastActionLabel(lead: Lead, activity: LeadActivity[]): string {
  switch (activity[0]?.action) {
    case 'email_captured':
      return 'Email captured';
    case 'email_sent':
      return 'Email sent';
    case 'email_followed_up':
      return 'Email followed up';
    case 'email_final_touch':
      return 'Final email sent';
    case 'email_delivered':
      return 'Email delivered';
    case 'email_opened':
      return 'Email opened';
    case 'email_clicked':
      return 'Email link clicked';
    case 'email_bounced':
    case 'email_failed':
    case 'email_suppressed':
      return 'Email failed';
    case 'email_final_review':
      return 'Final review required';
    case 'email_review_extended':
      return 'Final review extended';
    case 'url_saved':
      return 'Built';
    case 'intro_sent':
      return 'Sent';
    case 'followed_up':
      return 'Followed up';
    case 'called':
      return 'Called';
    case 'click_observed':
      return 'Link checked';
    case 'click_confirmation_screened':
      return 'Visit screened';
    case 'click_tracked':
      return 'Visited';
    case 'brief_generated':
      return 'Brief generated';
    case 'undo':
      return 'Undone';
    default:
      return lead.enrichment_status === 'enriched' ? 'Enriched' : 'Updated';
  }
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </label>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
      {children}
    </span>
  );
}

const SELECT_CLS =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

export function LeadDetailModal({
  leadId,
  onClose,
  showToast,
  onLeadUpdated,
  onQualify,
  pipelineContext,
}: Props) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [lead, setLead] = useState<Lead | null>(null);
  const [calls, setCalls] = useState<CallEntry[]>([]);
  const [activity, setActivity] = useState<LeadActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.leads.get(leadId);
      setLead(res.lead);
      setCalls(res.calls);
      if (pipelineContext) {
        // Best-effort: the activity trail enriches the Activity tab but its
        // absence shouldn't block the modal.
        try {
          const p = await api.pipeline.get(leadId);
          setActivity(p.activity);
        } catch {
          setActivity([]);
        }
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not load lead';
      showToast(msg, 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const handleFieldChange = async (
    field: 'status' | 'outcome' | 'recommended_tier',
    value: string | number | null,
  ) => {
    if (!lead) return;
    const original = lead;
    setLead({ ...lead, [field]: value } as Lead);
    try {
      await api.leads.update(lead.id, { [field]: value } as Partial<Lead>);
      onLeadUpdated?.();
    } catch (err) {
      setLead(original);
      showToast(`Update failed: ${(err as Error).message}`, 'error');
    }
  };

  const tier =
    lead?.recommended_tier === 1 || lead?.recommended_tier === 2 || lead?.recommended_tier === 3
      ? lead.recommended_tier
      : null;
  const reviewCount = lead?.google_review_count ?? 0;
  const canQualify =
    !!lead &&
    !!onQualify &&
    lead.enrichment_status === 'enriched' &&
    !['qualified', 'client', 'not_interested', 'dead'].includes(lead.status);

  const tabs: Array<{ key: DetailTab; label: string; badge?: number }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'notes', label: 'Notes', badge: lead?.notes ? 1 : undefined },
    { key: 'reviews', label: 'Reviews', badge: reviewCount || undefined },
    { key: 'pitch', label: 'Pitch Prep' },
    { key: 'call', label: 'Call Log', badge: calls.length || undefined },
    ...(pipelineContext ? [{ key: 'activity' as DetailTab, label: 'Activity' }] : []),
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl bg-white shadow-xl flex flex-col">
        {loading || !lead ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <p className="text-sm text-slate-400">Loading lead…</p>
            <button
              onClick={onClose}
              className="mt-2 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-slate-900">
                    {lead.company}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {lead.industry && <Chip>{lead.industry}</Chip>}
                    {lead.google_rating != null && (
                      <span className="flex items-center gap-1 font-medium text-amber-500">
                        <StarRating rating={lead.google_rating} />
                        {lead.google_rating.toFixed(1)}
                        <span className="font-normal text-slate-400">({reviewCount})</span>
                      </span>
                    )}
                    {(lead.city || lead.state) && (
                      <span className="flex items-center gap-1 text-slate-400">
                        <MapPin className="h-3 w-3" />
                        {[lead.city, lead.state].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <button
                    onClick={onClose}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  {pipelineContext && canQualify && (
                    <button
                      onClick={() => {
                        onQualify?.(lead);
                        onClose();
                      }}
                      title="Book a demo — creates a Sites prospect project"
                      className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-blue-600/20 hover:shadow-md"
                    >
                      Book demo
                    </button>
                  )}
                </div>
              </div>

              {/* Tier + opportunity score banner */}
              {(tier || lead.opportunity_score != null) && (
                <div
                  className={`mt-3 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${
                    tier ? TIER_BANNER[tier].bg : 'bg-slate-50 border-slate-200'
                  } ${tier ? TIER_BANNER[tier].text : 'text-slate-600'}`}
                >
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    {tier ? `Recommended: Tier ${tier}` : 'Unscored tier'}
                    {lead.opportunity_score != null && (
                      <span className="font-semibold">
                        · score{' '}
                        <ScoreHover
                          score={lead.opportunity_score}
                          reasoning={lead.opportunity_reasoning}
                          color="currentColor"
                          meta={`${tier ? `Tier ${tier}` : 'No tier'} · ${lead.enrichment_status}`}
                        />
                      </span>
                    )}
                  </span>
                  {tier && (
                    <span
                      className={`flex h-5 items-center rounded-full px-2 text-[10px] font-bold text-white ${TIER_BANNER[tier].pill}`}
                    >
                      T{tier}
                    </span>
                  )}
                </div>
              )}

              {/* Tabs */}
              <div className="mt-3 flex gap-1.5 overflow-x-auto">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
                      tab === t.key
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {t.label}
                    {t.badge ? (
                      <span className={tab === t.key ? 'text-slate-300' : 'text-slate-400'}>
                        {t.badge}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {tab === 'overview' && (
                <OverviewPane
                  lead={lead}
                  onFieldChange={handleFieldChange}
                  pipelineContext={pipelineContext}
                  showToast={showToast}
                  onLeadUpdated={(updated) => {
                    setLead(updated);
                    onLeadUpdated?.();
                  }}
                />
              )}
              {tab === 'notes' && (
                <NotesPane
                  lead={lead}
                  showToast={showToast}
                  onSaved={(updated) => {
                    setLead(updated);
                    onLeadUpdated?.();
                  }}
                />
              )}
              {tab === 'reviews' && <ReviewsPane lead={lead} />}
              {tab === 'pitch' && <PitchPrepPane lead={lead} />}
              {tab === 'call' && (
                <CallLogTab
                  leadId={lead.id}
                  calls={calls}
                  showToast={showToast}
                  onCallsChanged={() => void load()}
                />
              )}
              {tab === 'activity' && (
                <ActivityPane
                  lead={lead}
                  activity={activity}
                  showToast={showToast}
                />
              )}
            </div>

            {/* Footer.
                Automated context: the Activity summary card (last action +
                site sessions) replaces the Close button — the header X
                closes. Cold-call context keeps Close + Book demo. */}
            {pipelineContext ? (
              <div className="border-t border-slate-100 px-5 py-4">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Activity
                  </h4>
                  <div className="space-y-2 text-sm text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Last action</span>
                      <span className="font-medium text-slate-700">
                        {lastActionLabel(lead, activity)}{' '}
                        {relativeTime(
                          lead.pipeline_last_action_at ?? lead.updated_at ?? lead.created_at,
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Site sessions</span>
                      <span className="font-medium text-slate-700">
                        {lead.pipeline_sessions ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Engagement score</span>
                      <span className="font-medium text-slate-700">
                        {lead.engagement_score ?? 0}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3.5">
                <button
                  onClick={onClose}
                  className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                >
                  Close
                </button>
                {canQualify && (
                    <button
                      onClick={() => {
                        onQualify(lead);
                        onClose();
                      }}
                      title="Book a demo — creates a Sites prospect project at the chosen tier so Quick Brief is available for demo prep"
                      className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-600/20 hover:shadow-md"
                    >
                      → Book demo
                    </button>
                  )}
                {(lead.status === 'qualified' || lead.status === 'client') && lead.project_id && (
                  <span className="text-xs font-medium text-slate-400">
                    {lead.status === 'qualified'
                      ? '✓ Demo booked · open in Sites'
                      : '✓ Active client · open in Sites'}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Overview ----------

function OverviewPane({
  lead,
  onFieldChange,
  pipelineContext,
  showToast,
  onLeadUpdated,
}: {
  lead: Lead;
  onFieldChange: (
    field: 'status' | 'outcome' | 'recommended_tier',
    value: string | number | null,
  ) => void;
  pipelineContext?: boolean;
  showToast: ShowToast;
  onLeadUpdated: (lead: Lead) => void;
}) {
  const [classifying, setClassifying] = useState(false);
  const [routing, setRouting] = useState<PhoneRoute | null>(null);
  const services = parseList<string>(lead.extracted_services);
  const areas = parseList<string>(lead.extracted_service_areas);
  const ownerNames = parseList<string>(lead.owner_names);
  const mapsUrl = googleMapsUrl(lead);
  // lead.address usually already carries city/state (Places formats it);
  // only fall back to city/state when it's missing so we don't render
  // "…, WI 53946, USA, Markesan, WI" style duplication.
  const addressLine =
    lead.address?.trim() || [lead.city, lead.state].filter(Boolean).join(', ');

  async function handleClassifyPhone() {
    setClassifying(true);
    try {
      const res = await api.leads.classifyPhone(lead.id);
      onLeadUpdated(res.lead);
      showToast(`Phone routed to ${phoneRouteLabel(res.lead.phone_route)}`, 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Phone lookup failed: ${msg}`, 'error');
    } finally {
      setClassifying(false);
    }
  }

  async function handlePhoneRouteOverride(route: PhoneRoute) {
    if (lead.phone_route === route) return;
    setRouting(route);
    try {
      const res = await api.leads.updatePhoneRoute(lead.id, route);
      onLeadUpdated(res.lead);
      showToast(`Moved to ${phoneRouteLabel(res.lead.phone_route)}`, 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Route update failed: ${msg}`, 'error');
    } finally {
      setRouting(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Automated context: the original pipeline-card icon rows — regular
          font, address doubles as the Google Maps link. Cold-call context
          keeps the labeled grid + the standalone Maps card below. */}
      {pipelineContext && (
        <div className="space-y-2 text-sm text-slate-600">
          {lead.phone ? (
            <a
              href={`tel:${lead.phone.replace(/\D/g, '')}`}
              className="flex items-center gap-2 text-blue-600 hover:underline"
              title="Click to call (uses your computer's default phone handler)"
            >
              <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              {formatPhone(lead.phone)}
            </a>
          ) : (
            <span className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />—
            </span>
          )}
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-blue-600 hover:underline"
              title="Open the Google Maps listing — reviews, hours & photos"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{addressLine || 'View on Google Maps'}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <span className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{addressLine || '—'}</span>
            </span>
          )}
          <span className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {lead.gbp_hours || '—'}
          </span>
          <PhoneRouteRow
            lead={lead}
            classifying={classifying}
            routing={routing}
            onClassify={handleClassifyPhone}
            onOverride={handlePhoneRouteOverride}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {!pipelineContext && (
          <div>
            <FieldLabel>Phone</FieldLabel>
            {lead.phone ? (
              <a
                href={`tel:${lead.phone.replace(/\D/g, '')}`}
                className="flex items-center gap-1.5 font-mono text-sm font-medium text-blue-600 hover:underline"
                title="Click to call (uses your computer's default phone handler)"
              >
                <Phone className="h-3.5 w-3.5" />
                {formatPhone(lead.phone)}
              </a>
            ) : (
              <span className="text-sm text-slate-400">—</span>
            )}
          </div>
        )}
        {!pipelineContext && (
          <div>
            <FieldLabel>Phone Route</FieldLabel>
            <PhoneRouteRow
              lead={lead}
              classifying={classifying}
              routing={routing}
              onClassify={handleClassifyPhone}
              onOverride={handlePhoneRouteOverride}
              compact
            />
          </div>
        )}
        <div>
          <FieldLabel>Existing Website</FieldLabel>
          {lead.website ? (
            <span className="flex items-center gap-1.5 text-sm text-slate-600">
              <Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <a
                href={lead.website}
                target="_blank"
                rel="noreferrer"
                className="truncate hover:underline"
              >
                {lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
              {lead.pagespeed_mobile != null && (
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    lead.pagespeed_mobile < 50
                      ? 'bg-rose-50 text-rose-600'
                      : lead.pagespeed_mobile < 70
                        ? 'bg-amber-50 text-amber-600'
                        : 'bg-emerald-50 text-emerald-600'
                  }`}
                >
                  PSI {lead.pagespeed_mobile}
                </span>
              )}
            </span>
          ) : (
            <span className="text-sm text-slate-400">None</span>
          )}
        </div>
        <div>
          <FieldLabel>GBP Status</FieldLabel>
          <span
            className={`text-sm font-medium ${lead.gbp_claimed ? 'text-emerald-600' : 'text-violet-600'}`}
          >
            {lead.gbp_claimed ? '✓ Claimed' : '⭐ Unclaimed'}
            {lead.gbp_photos_count != null && (
              <span className="font-normal text-slate-400"> · {lead.gbp_photos_count} photos</span>
            )}
          </span>
        </div>
        <div>
          <FieldLabel>Owner Names (mined)</FieldLabel>
          <span className="text-sm text-slate-600">
            {ownerNames.length > 0 ? ownerNames.join(', ') : <span className="text-slate-400">—</span>}
          </span>
        </div>
      </div>

      {!pipelineContext && mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5"
        >
          <span className="flex items-center gap-2.5">
            <MapIcon className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              <span className="block text-sm font-medium text-emerald-700">
                View on Google Maps
              </span>
              <span className="block text-[11px] text-emerald-600/70">
                Check reviews, hours &amp; photos before your call
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-600">
            Open listing
            <ExternalLink className="h-3 w-3" />
          </span>
        </a>
      )}

      {areas.length > 0 && (
        <div>
          <FieldLabel>Service Areas Detected</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {areas.map((a) => (
              <Chip key={a}>{a}</Chip>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {areas.length} {areas.length === 1 ? 'area' : 'areas'} mined from reviews
          </p>
        </div>
      )}

      {services.length > 0 && (
        <div>
          <FieldLabel>Services Detected</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {services.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </div>
        </div>
      )}

      {pipelineContext ? null : (
      <div className="grid grid-cols-3 gap-3">
        <div>
          <FieldLabel>Outcome</FieldLabel>
          <select
            className={SELECT_CLS}
            value={lead.outcome ?? ''}
            onChange={(e) => onFieldChange('outcome', e.target.value)}
          >
            <option value="">—</option>
            <option>No Answer</option>
            <option>Voicemail Left</option>
            <option>Spoke with Owner</option>
            <option>Callback Requested</option>
            <option>Not Interested</option>
            <option>Interested</option>
            <option>Qualified for Tier</option>
          </select>
        </div>
        <div>
          <FieldLabel>Stage</FieldLabel>
          <select
            className={SELECT_CLS}
            value={lead.status}
            onChange={(e) => onFieldChange('status', e.target.value)}
            disabled={lead.status === 'qualified' || lead.status === 'client'}
            title={
              lead.status === 'qualified'
                ? 'Demo booked — manage the prospect from the Sites tab'
                : lead.status === 'client'
                  ? 'Active client — manage from the Sites tab'
                  : undefined
            }
          >
            <option value="cold">Cold</option>
            <option value="contacted">Contacted</option>
            {/* 'qualified'/'client' are set atomically by Book demo / client
                promotion flows; the dropdown locks once there. */}
            {lead.status === 'qualified' && <option value="qualified">Demo booked (locked)</option>}
            {lead.status === 'client' && <option value="client">Client (locked)</option>}
            <option value="not_interested">Not interested</option>
            <option value="dead">Dead</option>
          </select>
        </div>
        <div>
          <FieldLabel>Tier</FieldLabel>
          <select
            className={SELECT_CLS}
            value={lead.recommended_tier ?? ''}
            onChange={(e) => {
              const v = e.target.value ? parseInt(e.target.value, 10) : null;
              if (v === null || v === 1 || v === 2 || v === 3) onFieldChange('recommended_tier', v);
            }}
          >
            <option value="">— (no tier)</option>
            <option value="1">Tier 1</option>
            <option value="2">Tier 2</option>
            <option value="3">Tier 3</option>
          </select>
        </div>
      </div>
      )}
    </div>
  );
}

function PhoneRouteRow({
  lead,
  classifying,
  routing,
  onClassify,
  onOverride,
  compact = false,
}: {
  lead: Lead;
  classifying: boolean;
  routing: PhoneRoute | null;
  onClassify: () => void;
  onOverride: (route: PhoneRoute) => void;
  compact?: boolean;
}) {
  const routeBadgeRef = useRef<HTMLSpanElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null);
  const route = lead.phone_route ?? 'unknown';
  const badgeCls = {
    text: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    call: 'bg-blue-50 text-blue-700 border-blue-100',
    review: 'bg-amber-50 text-amber-700 border-amber-100',
    unknown: 'bg-slate-50 text-slate-500 border-slate-200',
  }[route] ?? 'bg-slate-50 text-slate-500 border-slate-200';
  const tooltipRows = [
    ['Route', phoneRouteLabel(route)],
    ['Line type', lead.phone_line_type ? lineTypeLabel(lead.phone_line_type) : 'Unknown'],
    ['Carrier', lead.phone_carrier || 'Unknown'],
    ['Normalized', lead.phone_e164 || 'Not available'],
    ['Last checked', lead.phone_lookup_at ? relativeTime(lead.phone_lookup_at) : 'Not checked'],
    ...(lead.phone_lookup_error ? [['Lookup note', lead.phone_lookup_error]] : []),
  ];
  const allRouteActions: Array<{ route: PhoneRoute; label: string }> = [
    { route: 'call', label: 'Move to Call' },
    { route: 'text', label: 'Move to Text' },
    { route: 'review', label: 'Review' },
  ];
  const routeActions = allRouteActions.filter((action) => action.route !== route);
  const disabled = classifying || routing !== null;
  const showTooltip = () => {
    const rect = routeBadgeRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPosition({
      top: rect.bottom + 8,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 268)),
    });
  };

  return (
    <div className={compact ? 'space-y-1' : 'flex flex-wrap items-center gap-2'}>
      <div className="inline-flex w-fit">
        <span
          ref={routeBadgeRef}
          tabIndex={0}
          aria-describedby={`phone-routing-tooltip-${lead.id}`}
          onMouseEnter={showTooltip}
          onMouseLeave={() => setTooltipPosition(null)}
          onFocus={showTooltip}
          onBlur={() => setTooltipPosition(null)}
          className={`inline-flex w-fit cursor-help rounded-full border px-2 py-0.5 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-blue-200 ${badgeCls}`}
        >
          {phoneRouteLabel(route)}
        </span>
        {tooltipPosition && createPortal(
          <div
            id={`phone-routing-tooltip-${lead.id}`}
            role="tooltip"
            style={{ top: tooltipPosition.top, left: tooltipPosition.left }}
            className="pointer-events-none fixed z-[500] w-64 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl"
          >
            <div className="mb-2 font-semibold text-slate-800">Phone routing</div>
            <div className="space-y-1">
              {tooltipRows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[78px_1fr] gap-2">
                  <span className="text-slate-400">{label}</span>
                  <span className="min-w-0 break-words text-slate-700">{value}</span>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
      </div>
      <button
        type="button"
        onClick={() => void onClassify()}
        disabled={disabled || !lead.phone}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:text-slate-300"
        title={lead.phone_lookup_at ? 'Recheck phone route' : 'Classify phone route'}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${classifying ? 'animate-spin' : ''}`} />
      </button>
      <div className={compact ? 'flex flex-wrap gap-1 pt-1' : 'flex flex-wrap gap-1'}>
        {routeActions.map((action) => (
          <button
            key={action.route}
            type="button"
            onClick={() => void onOverride(action.route)}
            disabled={disabled}
            className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:text-slate-400"
          >
            {routing === action.route ? 'Moving...' : action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function phoneRouteLabel(route: Lead['phone_route']): string {
  if (route === 'text') return 'Text Outreach';
  if (route === 'call') return 'Email Outreach';
  if (route === 'review') return 'Manual review';
  return 'Unclassified';
}

function lineTypeLabel(lineType: string): string {
  return lineType
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

function engagementGradeLabel(grade: string | null | undefined): string {
  if (grade === 'hot') return 'Call immediately';
  if (grade === 'walkthrough') return 'Schedule walkthrough';
  if (grade === 'follow_up') return 'Send follow-up';
  return 'Nurture';
}

// ---------- Notes ----------

function NotesPane({
  lead,
  showToast,
  onSaved,
}: {
  lead: Lead;
  showToast: ShowToast;
  onSaved: (lead: Lead) => void;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = note.trim();
    if (!trimmed) {
      showToast('Add a note before saving', 'error');
      return;
    }

    setSaving(true);
    try {
      const res = await api.leads.appendNote(lead.id, trimmed);
      onSaved(res.lead);
      setNote('');
      showToast('Note saved', 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not save note: ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Add note
        </div>
        <textarea
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Save context without marking this lead contacted."
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setNote('')}
            disabled={saving || !note}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save note'}
          </button>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Lead notes
        </div>
        {lead.notes ? (
          <div className="whitespace-pre-wrap rounded-2xl border border-slate-100 bg-white p-4 text-sm leading-relaxed text-slate-600">
            {lead.notes}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
            No lead notes yet.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Reviews ----------

function ReviewsPane({ lead }: { lead: Lead }) {
  const reviews = parseList<RawReview>(lead.google_reviews);
  const pitchQuotes = parseList<PitchQuote>(lead.pitch_quotes);
  const pitchTexts = new Set(pitchQuotes.map((p) => p.quote));

  if (reviews.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">
        No reviews on file. Run enrichment to fetch them from Google Places.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-slate-400">
        Showing {reviews.length} review{reviews.length === 1 ? '' : 's'}
        {lead.google_rating && <> · {lead.google_rating.toFixed(1)} avg ★</>}
      </p>
      {reviews.map((r, i) => {
        const isPitch = pitchTexts.has(r.text);
        return (
          <div
            key={i}
            className={`rounded-xl border p-3.5 ${
              isPitch ? 'border-blue-100 bg-blue-50/50' : 'border-slate-100 bg-slate-50'
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">{r.author}</span>
              <span className="text-[11px] text-slate-400">{r.relativeTime ?? ''}</span>
            </div>
            <div className="text-[11px] tracking-widest text-amber-500">{stars(r.rating)}</div>
            <p className="mt-1.5 text-sm italic leading-relaxed text-slate-600">{r.text}</p>
            {isPitch && (
              <span className="mt-2 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                ⭐ Pitch quote
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Pitch Prep ----------

function PitchSection({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Target;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-sm leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

function ownerSalutation(lead: Lead): string {
  const owners = parseList<string>(lead.owner_names);
  return owners[0] ? ` ${owners[0]}` : '';
}

function PitchPrepPane({ lead }: { lead: Lead }) {
  const pitchQuotes = parseList<PitchQuote>(lead.pitch_quotes);
  const strengths = parseList<string>(lead.extracted_strengths);
  const areas = parseList<string>(lead.extracted_service_areas);

  if (lead.enrichment_status !== 'enriched') {
    return (
      <p className="py-8 text-center text-sm text-slate-400">
        Pitch ammo is generated during enrichment. Run enrichment on this lead first.
      </p>
    );
  }

  const rawTier = lead.recommended_tier;
  const tier: Tier = rawTier === 1 || rawTier === 2 || rawTier === 3 ? rawTier : 1;

  return (
    <div className="space-y-3">
      {areas.length > 0 && (
        <PitchSection icon={Target} label="Opening line">
          "Hi{ownerSalutation(lead)} — I see you've been getting customers in{' '}
          {areas.slice(0, 3).join(', ')}
          {areas.length > 3 ? '…' : ''} from your reviews
          {lead.gbp_claimed === 0
            ? ', but your Google Business Profile is unclaimed.'
            : `, but your Google profile only highlights ${lead.city ?? 'one area'}.`}
          "
        </PitchSection>
      )}

      {pitchQuotes.length > 0 && (
        <PitchSection icon={Gem} label="Pitch ammo">
          {pitchQuotes.slice(0, 2).map((q, i) => (
            <div key={i} className={i === 0 && pitchQuotes.length > 1 ? 'mb-2' : ''}>
              "{q.quote}" — {q.author}
              {q.location ? `, ${q.location}` : ''}
              {q.why && <p className="mt-0.5 text-xs text-slate-400">↳ {q.why}</p>}
            </div>
          ))}
        </PitchSection>
      )}

      <PitchSection icon={AlertTriangle} label="Their pain points">
        <ul className="list-disc space-y-1 pl-4">
          {!lead.gbp_claimed && <li>Unclaimed Google Business Profile</li>}
          {lead.pagespeed_mobile != null && lead.pagespeed_mobile < 50 && (
            <li>Mobile site loads slow (PSI {lead.pagespeed_mobile})</li>
          )}
          {!lead.website && <li>No website — losing leads to competitors who have one</li>}
          {areas.length > 1 && (
            <li>
              Service in {areas.length} cities, but only {lead.city ?? 'one'} has dedicated SEO
              presence
            </li>
          )}
          {strengths.slice(0, 2).map((s) => (
            <li key={s}>Customers love: {s.toLowerCase()} (use this in copy)</li>
          ))}
        </ul>
      </PitchSection>

      <PitchSection icon={DollarSign} label={`The pitch · Tier ${tier}`}>
        {tierPitchBlurb(tier)}
      </PitchSection>
    </div>
  );
}

// ---------- Activity (Automated Pipeline context) ----------

function ActivityPane({
  lead,
  activity,
  showToast,
}: {
  lead: Lead;
  activity: LeadActivity[];
  showToast: ShowToast;
}) {
  const [copyingTracking, setCopyingTracking] = useState(false);
  const copyTrackingBlock = async () => {
    setCopyingTracking(true);
    try {
      const response = await api.pipeline.claritySnippet(lead.id);
      await navigator.clipboard.writeText(response.snippet);
      showToast('Updated tracking block copied', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not copy tracking block';
      showToast(message, 'error');
    } finally {
      setCopyingTracking(false);
    }
  };

  // The last-action + sessions summary lives in the modal footer's Activity
  // card (always visible in pipeline context) — this tab is the trail.
  const reasons = parseList<string>(lead.engagement_reasons);
  const lastVisitAt = activity.find((item) => item.action === 'click_tracked')?.created_at
    ?? lead.pipeline_last_action_at;
  const recommendation = activityRecommendation({
    status: lead.pipeline_status,
    sessions: lead.pipeline_sessions ?? 0,
    score: lead.engagement_score ?? 0,
    lastVisitAt,
  });
  return (
    <div className="space-y-4">
      {lead.site_url && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">Confirmed visitor tracking</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-500">
              Paste this updated block into the site header to screen bots and confirm real visits.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copyTrackingBlock()}
            disabled={copyingTracking}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
          >
            {copyingTracking ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
            Copy tracking block
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <FieldLabel>Engagement score</FieldLabel>
            <div className="text-2xl font-bold text-slate-900">{lead.engagement_score ?? 0}</div>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
            {engagementGradeLabel(lead.engagement_grade)}
          </span>
        </div>
        {reasons.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {reasons.map((reason) => (
              <span key={reason} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {reason}
              </span>
            ))}
          </div>
        )}
        {lead.clarity_last_error && (
          <p className="mt-2 text-xs text-amber-600">{lead.clarity_last_error}</p>
        )}
      </div>

      {activity.length > 0 ? (
        <div>
          <FieldLabel>Outreach trail</FieldLabel>
          <div className="space-y-1.5">
            {recommendation && (
              <ActivityRecommendationTimeline recommendation={recommendation} createdAt={lastVisitAt} />
            )}
            {activity.slice(0, 15).map((a) => (
              <ActivityHistoryItem key={a.id} activity={a} />
            ))}
          </div>
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-slate-400">No outreach activity yet.</p>
      )}
    </div>
  );
}

interface ActivityRecommendation {
  action: 'call' | 'text';
  label: string;
  detail: string;
  tone: string;
}

function activityRecommendation(input: {
  status: string | null | undefined;
  sessions: number;
  score: number;
  lastVisitAt: string | null | undefined;
}): ActivityRecommendation | null {
  if (input.status !== 'engaged') return null;
  if (input.score >= 90) {
    return {
      action: 'call',
      label: '📞 Call Now',
      detail: 'Hot intent. Call instead of sending another text.',
      tone: 'border-rose-100 bg-rose-50 text-rose-700',
    };
  }
  if (input.score >= 70) {
    return {
      action: 'text',
      label: 'Offer a walkthrough',
      detail: 'Ask for a 10–15 minute walkthrough this week.',
      tone: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    };
  }
  if (input.score >= 40) {
    return {
      action: 'text',
      label: 'Ask for feedback',
      detail: 'They looked. Ask what they liked or would change without asking for a meeting.',
      tone: 'border-amber-100 bg-amber-50 text-amber-700',
    };
  }
  return {
    action: 'text',
    label: 'Nurture',
    detail: 'No meaningful engagement yet. Bring them back to the demo.',
    tone: 'border-slate-200 bg-slate-50 text-slate-600',
  };
}

function ActivityRecommendationTimeline({
  recommendation,
  createdAt,
}: {
  recommendation: ActivityRecommendation;
  createdAt: string | null | undefined;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-[13px] ${recommendation.tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Recommended: {recommendation.label}</div>
          <div className="mt-0.5 text-xs opacity-80">{recommendation.detail}</div>
        </div>
        {createdAt && (
          <div className="shrink-0 text-right text-[11px] opacity-70">
            <div>{formatActivityTime(createdAt)}</div>
            <div>{relativeTime(createdAt)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityHistoryItem({ activity }: { activity: LeadActivity }) {
  const meta = parseActivityMeta(activity.meta);
  const url = typeof meta.url === 'string' ? meta.url : typeof meta.raw_url === 'string' ? meta.raw_url : null;
  const body = typeof meta.body === 'string' ? meta.body : null;
  const detail = activityDetail(activity, meta);
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-700">{activityTitle(activity.action)}</div>
          {detail && <div className="mt-0.5 text-xs text-slate-500">{detail}</div>}
        </div>
        <div className="shrink-0 text-right text-[11px] text-slate-400">
          <div>{formatActivityTime(activity.created_at)}</div>
          <div>{relativeTime(activity.created_at)}</div>
        </div>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block truncate rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          {url}
        </a>
      )}
      {body && (
        <blockquote className="mt-2 whitespace-pre-wrap rounded-lg bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-600">
          {body}
        </blockquote>
      )}
    </div>
  );
}

function parseActivityMeta(meta: string | null): Record<string, unknown> {
  if (!meta) return {};
  try {
    const parsed = JSON.parse(meta) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function activityTitle(action: string): string {
  switch (action) {
    case 'email_captured': return 'Email captured';
    case 'email_sent': return 'Initial email sent';
    case 'email_followed_up': return 'Follow-up email sent';
    case 'email_final_touch': return 'Final-touch email sent';
    case 'email_delivered': return 'Email delivered';
    case 'email_opened': return 'Email opened';
    case 'email_clicked': return 'Email link clicked';
    case 'email_bounced': return 'Email bounced';
    case 'email_complained': return 'Spam complaint received';
    case 'email_failed': return 'Email failed';
    case 'email_suppressed': return 'Email suppressed';
    case 'email_final_review': return 'Final review required';
    case 'email_review_extended': return 'Final review extended';
    case 'automation_stopped': return 'Email automation stopped';
    case 'url_saved': return 'Site URL saved';
    case 'brief_generated': return 'Brief generated';
    case 'intro_sent': return 'Intro text sent';
    case 'followed_up': return 'Follow-up text sent';
    case 'call_outcome': return 'Call outcome recorded';
    case 'calendar_sent': return 'Calendar link sent';
    case 'calendar_clicked': return 'Calendar opened';
    case 'scheduling_followup': return 'Scheduling follow-up sent';
    case 'called': return 'Call action logged';
    case 'click_observed': return 'Tracked link checked';
    case 'click_confirmation_screened': return 'Site confirmation screened';
    case 'click_tracked': return 'Tracked site visit';
    case 'clarity_synced': return 'Clarity synced';
    case 'engagement_reset': return 'Engagement reset';
    case 'undo': return 'Undo';
    default: return action.replace(/_/g, ' ');
  }
}

function activityDetail(activity: LeadActivity, meta: Record<string, unknown>): string | null {
  if (activity.action === 'email_captured') {
    const email = typeof meta.email === 'string' ? meta.email : null;
    const destination = activity.to_status === 'ready_to_send' ? 'Ready to Send' : 'Awaiting Build';
    const reason = activity.to_status === 'ready_to_send'
      ? ' An existing tracked site URL allowed the build stage to be skipped.'
      : '';
    return `${email ? `${email} saved` : 'Email saved'} to the company record and moved to ${destination}.${reason}`;
  }
  if (
    activity.action === 'email_sent'
    || activity.action === 'email_followed_up'
    || activity.action === 'email_final_touch'
  ) {
    const subject = typeof meta.subject === 'string' ? meta.subject : null;
    return subject ? `Subject: ${subject}` : 'Email opened in the operator’s email client.';
  }
  if (activity.action === 'email_delivered') return 'Resend confirmed delivery to the recipient’s mail server.';
  if (activity.action === 'email_opened') return 'The email tracking pixel was requested. Open signals are directional, not definitive.';
  if (activity.action === 'email_clicked') return 'The recipient clicked a tracked email link.';
  if (['email_bounced', 'email_complained', 'email_failed', 'email_suppressed'].includes(activity.action)) {
    const error = typeof meta.error === 'string' ? meta.error : null;
    return error || 'The automated sequence was stopped to protect sender reputation.';
  }
  if (activity.action === 'automation_stopped') return 'The sequence was stopped and moved to Final Review for an operator decision.';
  if (activity.action === 'email_final_review') {
    return 'The email sequence finished without engagement. The lead remains active until you decide what to do.';
  }
  if (activity.action === 'email_review_extended') {
    const days = typeof meta.days === 'number' ? meta.days : 3;
    return `The archive decision was deferred for ${days} more days.`;
  }
  if (activity.action === 'brief_generated') {
    const model = typeof meta.model === 'string' ? meta.model : null;
    return model ? `Generated with ${model}` : 'Generated and saved to this lead';
  }
  if (activity.action === 'url_saved') return 'This is the demo-site URL saved for outreach.';
  if (activity.action === 'intro_sent') return 'First text opened in Messages.';
  if (activity.action === 'followed_up') return 'Follow-up text opened in Messages.';
  if (activity.action === 'call_outcome') {
    const outcome = typeof meta.outcome === 'string' ? meta.outcome.replace(/_/g, ' ') : null;
    return outcome ? `Call result: ${outcome}.` : 'The call result was recorded.';
  }
  if (activity.action === 'calendar_sent') return 'Tracked HoneyBook link opened in Messages.';
  if (activity.action === 'calendar_clicked') return 'Prospect opened the tracked HoneyBook calendar.';
  if (activity.action === 'scheduling_followup') return 'Scheduling follow-up opened in Messages.';
  if (activity.action === 'click_observed') {
    const classification = typeof meta.classification === 'string' ? meta.classification : 'pending';
    const place = [meta.city, meta.region, meta.country].filter((value) => typeof value === 'string').join(', ');
    return `Redirect observed and classified as ${classification}${place ? ` from ${place}` : ''}. Awaiting JavaScript confirmation.`;
  }
  if (activity.action === 'click_confirmation_screened') {
    const classification = typeof meta.classification === 'string' ? meta.classification : 'suspicious';
    return `JavaScript loaded, but the ${classification} request was screened and did not award engagement points.`;
  }
  if (activity.action === 'click_tracked') {
    const place = [meta.city, meta.region, meta.country].filter((value) => typeof value === 'string').join(', ');
    return `JavaScript confirmed the tracked site visit${place ? ` from ${place}` : ''}.`;
  }
  if (activity.action === 'clarity_synced') {
    const score = typeof meta.score === 'number' ? meta.score : null;
    return score !== null ? `Engagement score updated to ${score}.` : 'Clarity data checked for this lead.';
  }
  if (activity.action === 'engagement_reset') {
    const priorScore = typeof meta.prior_score === 'number' ? meta.prior_score : null;
    return priorScore !== null ? `Previous score was ${priorScore}.` : 'Test engagement data was cleared.';
  }
  return null;
}

function formatActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
