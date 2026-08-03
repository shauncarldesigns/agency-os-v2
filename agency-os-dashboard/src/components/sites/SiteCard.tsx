import { useState } from 'react';
import type { Project, ShowToast, Tab } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { TIER_MRR } from '../../lib/pricing';
import { ArrowRight, BarChart3, Bolt, Check, ExternalLink, FileText, Globe2, LoaderCircle, MapPin, Pencil, X } from 'lucide-react';

interface SiteCardProps {
  project: Project;
  showToast: ShowToast;
  onSwitchTab: (tab: Tab) => void;
  /** Open the Brief Studio detail (Tier 3 only — Tier 1/2 cards short-circuit
   *  this to Edit Info instead). */
  onOpenDetail: () => void;
  /** Open the Edit Project modal (tier change / business info / delete). */
  onEditInfo: () => void;
  /** Open the Quick Brief modal — business name + reviews verbatim, for the
   *  pre-call landingsite paste. Available on every tier. */
  onQuickBrief: () => void;
  /** Called after the project's status has been flipped via the card's
   *  "Mark as Active Client" action so the parent can reload the projects
   *  list and refresh stats/MRR. */
  onProjectChanged: () => void;
}

export function SiteCard({
  project, onSwitchTab, onOpenDetail, onEditInfo, onQuickBrief, onProjectChanged, showToast,
}: SiteCardProps) {
  const tier = project.tier;
  const liveUrl = project.custom_domain ?? project.landingsite_url;
  const isBuilding = project.status === 'building';
  const isProspect = project.status === 'prospect';
  const mrr = TIER_MRR[tier] ?? 0;
  const pagesBuilt = project.pages_built ?? 0;
  const monthlyTarget = project.monthly_pages_target ?? (tier === 3 ? 5 : 0);
  const hasBriefStudio = tier === 3;
  const [signing, setSigning] = useState(false);

  const subtitle = (() => {
    const where = [project.city, project.state].filter(Boolean).join(', ');
    if (isProspect) return `${where} · Prospect (qualified, not yet signed)`;
    if (project.contract_start) {
      return `${where} · Client since ${formatDate(project.contract_start, { year: 'numeric', month: 'short' })}`;
    }
    return `${where} · ${project.status === 'building' ? 'Just signed' : project.status}`;
  })();

  async function handleMarkActive() {
    if (signing) return;
    setSigning(true);
    try {
      await api.projects.update(project.id, {
        status: 'building',
        contract_start: new Date().toISOString(),
      });
      showToast(`${project.business_name} marked as active client`, 'success');
      onProjectChanged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not mark active: ${msg}`, 'error');
    } finally {
      setSigning(false);
    }
  }

  // Demo happened, prospect declined. Project becomes a 'dead' historical
  // record and the lead returns to 'contacted' so they can be re-engaged.
  // Destructive enough to warrant a confirm dialog — the project leaves
  // the active Sites view immediately.
  async function handleDemoPassed() {
    if (signing) return;
    const confirmed = window.confirm(
      `Mark "${project.business_name}" as demo passed?\n\n` +
      `The project will be archived as 'dead' (kept for audit), and the lead ` +
      `returns to the calling pipeline as 'contacted' so you can re-engage later.`
    );
    if (!confirmed) return;
    setSigning(true);
    try {
      await api.projects.demoPassed(project.id);
      showToast(`${project.business_name} archived — lead returned to pipeline`, 'default');
      onProjectChanged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not mark demo passed: ${msg}`, 'error');
    } finally {
      setSigning(false);
    }
  }

  // Tier 3 → header opens Brief Studio (existing behaviour).
  // Tier 1/2 → no Brief Studio exists; header opens Edit Info instead so the
  // card still has a primary action and the operator can upsell from here.
  const headerAction = hasBriefStudio ? onOpenDetail : onEditInfo;
  const headerTitle = hasBriefStudio ? 'Open Brief Studio' : 'Edit project info';

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 border-b border-slate-100 p-4 text-left sm:p-5"
        onClick={headerAction}
        title={headerTitle}
      >
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-950">{project.business_name}</h2>
          <div className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
            <MapPin size={13} className="mt-px shrink-0" />
            <span>{subtitle}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {isProspect && (
            <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-200"
              title="Qualified for pitch, not yet signed. Excluded from MRR."
            >Prospect</span>
          )}
          <TierBadge tier={tier} />
        </div>
      </button>
      <div className="p-4 sm:p-5">
        <div className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm">
          <Globe2 size={15} className="shrink-0 text-slate-400" />
          {isBuilding && !liveUrl ? (
            <>
              <span className="min-w-0 flex-1 truncate text-slate-500">Site is being built</span>
              <LoaderCircle size={14} className="animate-spin text-blue-500" />
            </>
          ) : liveUrl ? (
            <>
              <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{liveUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
              <a
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md p-1 text-slate-400 transition hover:bg-white hover:text-blue-600"
                aria-label="Open site"
                onClick={(e) => e.stopPropagation()}
              ><ExternalLink size={14} /></a>
            </>
          ) : (
            <span className="text-slate-400">No site URL yet</span>
          )}
        </div>

        {/* MRR + pages-this-month — uniform across all tiers (no tier-gating in v2.2) */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MetricChip
            label="MRR"
            value={mrr > 0 ? `$${mrr}/mo` : '— '}
            tone={mrr > 0 ? 'green' : 'muted'}
          />
          <MetricChip
            label={monthlyTarget > 0 ? 'This month' : 'Pages built'}
            value={monthlyTarget > 0 ? `${pagesBuilt} / ${monthlyTarget}` : String(pagesBuilt)}
            tone={pagesBuilt > 0 ? 'accent' : 'muted'}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {/* Prospects get a dedicated "they signed!" button at the top of
              the action row. Once flipped, the card becomes a regular active
              client and this button stops rendering. */}
          {isProspect && (
            <>
              <ActionButton primary className="col-span-2" onClick={handleMarkActive} disabled={signing}
                      title="They signed. Move to active client status — counts toward MRR.">
                {signing ? <><LoaderCircle size={14} className="animate-spin" /> Marking…</> : <><Check size={14} /> Mark active client</>}
              </ActionButton>
              <ActionButton onClick={handleDemoPassed} disabled={signing}
                      title="The demo happened and they declined. Archive the project and send the lead back to the pipeline."
                      danger><X size={14} /> Demo passed</ActionButton>
            </>
          )}
          {hasBriefStudio ? (
            <>
              {!isProspect && (
                <ActionButton primary onClick={onOpenDetail}><FileText size={14} /> Brief Studio</ActionButton>
              )}
              {isProspect && (
                <ActionButton onClick={onOpenDetail}><FileText size={14} /> Brief Studio</ActionButton>
              )}
              <ActionButton onClick={onQuickBrief} title="Business + reviews verbatim, for the pre-call landingsite paste"><Bolt size={14} /> Quick brief</ActionButton>
              <ActionButton onClick={() => onSwitchTab('reports')}><BarChart3 size={14} /> Reports</ActionButton>
              <ActionButton onClick={onEditInfo}><Pencil size={14} /> Edit</ActionButton>
            </>
          ) : (
            <>
              {!isProspect && (
                <ActionButton primary onClick={onEditInfo}><Pencil size={14} /> Edit info</ActionButton>
              )}
              {isProspect && (
                <ActionButton onClick={onEditInfo}><Pencil size={14} /> Edit</ActionButton>
              )}
              <ActionButton onClick={onQuickBrief} title="Business + reviews verbatim, for the pre-call landingsite paste"><Bolt size={14} /> Quick brief</ActionButton>
              <span className="col-span-2 flex items-center gap-1 text-xs text-slate-400"><ArrowRight size={13} /> Upgrade to Tier 3 for Brief Studio</span>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function MetricChip({
  label, value, tone,
}: {
  label: string; value: string; tone: 'accent' | 'green' | 'muted';
}) {
  const color = tone === 'green' ? 'text-emerald-600' : tone === 'accent' ? 'text-blue-600' : 'text-slate-500';
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tracking-tight ${color}`}>{value}</div>
    </div>
  );
}

function TierBadge({ tier }: { tier: 1 | 2 | 3 }) {
  const styles = tier === 3 ? 'bg-violet-50 text-violet-700 ring-violet-200' : tier === 2 ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${styles}`}>Tier {tier}</span>;
}

function ActionButton({ children, primary = false, danger = false, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  const tone = primary ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700' : danger ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50';
  return <button type="button" className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${className}`} {...props}>{children}</button>;
}
