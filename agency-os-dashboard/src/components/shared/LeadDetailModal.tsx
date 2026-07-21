import { useEffect, useState } from 'react';
import {
  X,
  Phone,
  Globe,
  Star,
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
} from 'lucide-react';
import type { Lead, CallEntry, LeadActivity, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { CallLogTab } from '../pipeline/CallLogTab';
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

type DetailTab = 'overview' | 'reviews' | 'pitch' | 'call' | 'activity';

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

  const tabs: Array<{ key: DetailTab; label: string; badge?: number }> = [
    { key: 'overview', label: 'Overview' },
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
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
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
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
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
                      <span className="font-semibold">· score {lead.opportunity_score}</span>
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
              {tab === 'activity' && <ActivityPane lead={lead} activity={activity} />}
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
                {onQualify &&
                  lead.enrichment_status === 'enriched' &&
                  !['qualified', 'client', 'not_interested', 'dead'].includes(lead.status) && (
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
}: {
  lead: Lead;
  onFieldChange: (
    field: 'status' | 'outcome' | 'recommended_tier',
    value: string | number | null,
  ) => void;
  pipelineContext?: boolean;
}) {
  const services = parseList<string>(lead.extracted_services);
  const areas = parseList<string>(lead.extracted_service_areas);
  const ownerNames = parseList<string>(lead.owner_names);
  const mapsUrl = googleMapsUrl(lead);
  // lead.address usually already carries city/state (Places formats it);
  // only fall back to city/state when it's missing so we don't render
  // "…, WI 53946, USA, Markesan, WI" style duplication.
  const addressLine =
    lead.address?.trim() || [lead.city, lead.state].filter(Boolean).join(', ');

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

function ActivityPane({ lead, activity }: { lead: Lead; activity: LeadActivity[] }) {
  // The last-action + sessions summary lives in the modal footer's Activity
  // card (always visible in pipeline context) — this tab is the trail.
  return (
    <div className="space-y-4">
      {lead.site_url && (
        <a
          href={lead.site_url}
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20"
        >
          View live site
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}

      {activity.length > 0 ? (
        <div>
          <FieldLabel>Outreach trail</FieldLabel>
          <div className="space-y-1.5">
            {activity.slice(0, 15).map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-[13px]"
              >
                <span className="text-slate-600">{a.action.replace(/_/g, ' ')}</span>
                <span className="text-slate-400">{relativeTime(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-slate-400">No outreach activity yet.</p>
      )}
    </div>
  );
}
