import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Project, ShowToast, Tab } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { SiteCard } from './SiteCard';
import { MatrixModal } from './MatrixModal';

interface SitesPanelProps {
  showToast: ShowToast;
  onSwitchTab: (tab: Tab) => void;
}

type Sort = 'tier' | 'due' | 'az';

const TIER_MRR = { 1: 0, 2: 79, 3: 499 } as const;

export function SitesPanel({ showToast, onSwitchTab }: SitesPanelProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>('tier');
  const [matrixProject, setMatrixProject] = useState<Project | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.projects.list();
      setProjects(res.projects);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load sites: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => {
    const list = [...projects];
    if (sort === 'tier') list.sort((a, b) => b.tier - a.tier);
    else if (sort === 'az') list.sort((a, b) => a.business_name.localeCompare(b.business_name));
    else if (sort === 'due') list.sort((a, b) => {
      const aDate = a.next_pages_due ? Date.parse(a.next_pages_due) : Infinity;
      const bDate = b.next_pages_due ? Date.parse(b.next_pages_due) : Infinity;
      return aDate - bDate;
    });
    return list;
  }, [projects, sort]);

  const stats = useMemo(() => {
    const live = projects.filter(p => p.status === 'live' || p.status === 'building');
    const t3 = live.filter(p => p.tier === 3);
    const t2 = live.filter(p => p.tier === 2);
    const t1 = live.filter(p => p.tier === 1);
    const t3Mrr = t3.length * TIER_MRR[3];
    const t2Mrr = t2.length * TIER_MRR[2];
    return { total: live.length, t3: t3.length, t2: t2.length, t1: t1.length, t3Mrr, t2Mrr };
  }, [projects]);

  return (
    <>
      <div className="sec-header">
        <div>
          <div className="sec-title">Sites</div>
          <div className="sec-sub">All client sites managed across landingsite.ai · Tier-aware actions and scheduling</div>
        </div>
        <select className="fsel" value={sort} onChange={e => setSort(e.target.value as Sort)}>
          <option value="tier">Sort: Tier (high to low)</option>
          <option value="due">Sort: Update due</option>
          <option value="az">Sort: A-Z</option>
        </select>
      </div>

      <div className="stats-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="scard"><div className="snum">{stats.total}</div><div className="slabel">Total Sites</div></div>
        <div className="tier-stat t3">
          <div className="tier-num t3">{stats.t3}</div>
          <div className="slabel" style={{ color: 'var(--tier3)' }}>Tier 3 active</div>
          <div className="sdelta">${stats.t3Mrr.toLocaleString()}/mo recurring</div>
        </div>
        <div className="tier-stat t2">
          <div className="tier-num t2">{stats.t2}</div>
          <div className="slabel" style={{ color: 'var(--tier2)' }}>Tier 2 active</div>
          <div className="sdelta">${stats.t2Mrr.toLocaleString()}/mo recurring</div>
        </div>
        <div className="tier-stat t1">
          <div className="tier-num t1">{stats.t1}</div>
          <div className="slabel" style={{ color: 'var(--tier1)' }}>Tier 1 (handed off)</div>
          <div className="sdelta">No ongoing work</div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)' }}>
          <Spinner /> Loading sites…
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon="🌐"
          title="No client sites yet"
          sub="Convert a Tier 3 lead in Pipeline to its first project, generate a brief in Build, then queue it for Cowork."
        />
      ) : (
        <div className="sites-grid">
          {sorted.map(p => (
            <SiteCard
              key={p.id}
              project={p}
              showToast={showToast}
              onSwitchTab={onSwitchTab}
              onOpenMatrix={() => setMatrixProject(p)}
            />
          ))}
        </div>
      )}

      <MatrixModal
        open={matrixProject !== null}
        projectId={matrixProject?.id ?? null}
        projectName={matrixProject?.business_name ?? ''}
        projectUrl={matrixProject?.custom_domain ?? matrixProject?.landingsite_url ?? null}
        onClose={() => setMatrixProject(null)}
        showToast={showToast}
        onExpanded={load}
      />
    </>
  );
}
