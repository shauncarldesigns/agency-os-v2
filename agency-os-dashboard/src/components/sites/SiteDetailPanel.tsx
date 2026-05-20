import { useState, useEffect, useCallback } from 'react';
import type { Project, Page, BriefSummary, BriefKind, ShowToast, Tab } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { TierPill } from '../shared/TierPill';
import { BriefViewerModal } from '../briefs/BriefViewerModal';
import { MatrixModal } from './MatrixModal';

interface SiteDetailPanelProps {
  project: Project;
  showToast: ShowToast;
  onSwitchTab: (tab: Tab) => void;
  onBack: () => void;
  onProjectChanged: () => void;
}

const KIND_LABEL: Record<BriefKind, string> = {
  homepage_demo: 'Homepage Demo',
  master: 'Master',
  monthly_batch: 'Monthly Batch',
};

export function SiteDetailPanel({
  project, showToast, onSwitchTab, onBack, onProjectChanged,
}: SiteDetailPanelProps) {
  const [briefs, setBriefs] = useState<BriefSummary[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerBriefId, setViewerBriefId] = useState<number | null>(null);
  const [matrixOpen, setMatrixOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [briefsRes, projDetailRes] = await Promise.all([
        api.briefs.listForProject(project.id),
        api.projects.get(project.id),
      ]);
      setBriefs(briefsRes.briefs);
      setPages(projDetailRes.pages);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load site detail: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [project.id, showToast]);

  useEffect(() => { void reload(); }, [reload]);

  const liveUrl = project.custom_domain ?? project.landingsite_url;
  const pendingPages = pages.filter((p) => p.status === 'briefed' || p.status === 'in_progress');
  const completedPages = pages.filter((p) => p.status === 'complete');
  const masterBriefExists = briefs.some((b) => b.kind === 'master' && b.status !== 'archived');

  return (
    <>
      <div className="sec-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={onBack}
              style={{
                background: 'none', border: 'none', color: 'var(--text3)',
                fontSize: '0.7rem', cursor: 'pointer', padding: 0,
              }}
            >
              ← All sites
            </button>
          </div>
          <div className="sec-title" style={{ marginTop: 4 }}>{project.business_name}</div>
          <div className="sec-sub">
            {[project.city, project.state].filter(Boolean).join(', ')}
            {' · '}{project.status}
            {project.pages_built ? ` · ${project.pages_built} pages built` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
          <TierPill tier={project.tier} />
          {liveUrl && (
            <Button variant="ghost" size="sm" onClick={() => window.open(liveUrl, '_blank')}>
              ↗ Open in landingsite.ai
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)' }}>
          <Spinner /> Loading site detail…
        </div>
      ) : (
        <>
          <QuickStats
            project={project}
            briefsCount={briefs.length}
            pendingPagesCount={pendingPages.length}
            completedPagesCount={completedPages.length}
            onOpenMatrix={() => setMatrixOpen(true)}
            onOpenReports={() => onSwitchTab('reports')}
          />

          <BuildChecklist
            pages={pendingPages}
            showToast={showToast}
            onPageUpdated={() => { void reload(); onProjectChanged(); }}
          />

          <SectionCard title={`Brief history (${briefs.length})`} sub="All briefs generated for this project, most recent first.">
            {briefs.length === 0 ? (
              <div style={{ fontSize: '0.7rem', color: 'var(--text3)', fontStyle: 'italic' }}>
                {masterBriefExists
                  ? 'No additional briefs yet.'
                  : 'No briefs yet. Open the Briefs tab to generate the master brief.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {briefs.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setViewerBriefId(b.id)}
                    style={{
                      background: 'transparent', border: '1px solid var(--border)',
                      borderRadius: 'var(--r)', padding: '7px 10px',
                      fontSize: '0.72rem', color: 'var(--text2)', cursor: 'pointer',
                      textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                      opacity: b.status === 'archived' ? 0.55 : 1,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{KIND_LABEL[b.kind] ?? b.kind}</span>
                    {b.batch_period && <span>· {b.batch_period}</span>}
                    <span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: 'var(--text3)' }}>
                      {b.status} · {b.generated_at}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}

      <BriefViewerModalLoader
        briefId={viewerBriefId}
        onClose={() => setViewerBriefId(null)}
        showToast={showToast}
        onRegenerated={() => void reload()}
      />

      <MatrixModal
        open={matrixOpen}
        projectId={matrixOpen ? project.id : null}
        projectName={project.business_name}
        projectUrl={liveUrl}
        onClose={() => setMatrixOpen(false)}
        showToast={showToast}
        onExpanded={() => { void reload(); onProjectChanged(); }}
      />
    </>
  );
}

// ============================================================================

function QuickStats({
  project, briefsCount, pendingPagesCount, completedPagesCount, onOpenMatrix, onOpenReports,
}: {
  project: Project;
  briefsCount: number;
  pendingPagesCount: number;
  completedPagesCount: number;
  onOpenMatrix: () => void;
  onOpenReports: () => void;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 10,
      marginBottom: 18,
    }}>
      <StatTile label="Pages built" value={completedPagesCount} hint={`${pendingPagesCount} in progress`} />
      <StatTile label="Briefs generated" value={briefsCount} hint="Master + monthly batches" />
      <StatTile
        label="SEO Coverage"
        value={project.tier === 3 ? '→ Matrix' : '—'}
        hint={project.tier === 3 ? 'Service × City grid' : 'Tier 3 only'}
        onClick={project.tier === 3 ? onOpenMatrix : undefined}
      />
      <StatTile
        label="Monthly batch"
        value={project.monthly_pages_target ? `${project.monthly_pages_target}/mo` : '—'}
        hint={project.next_pages_due ? `Next due ${project.next_pages_due.slice(0, 10)}` : 'No schedule set'}
        onClick={project.tier === 3 ? onOpenReports : undefined}
      />
    </div>
  );
}

function StatTile({
  label, value, hint, onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--rl)',
        padding: 14,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--text3)' }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem', color: 'var(--accent)', marginTop: 4, lineHeight: 1.1 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: '0.62rem', color: 'var(--text3)', marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}

function SectionCard({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--rl)',
      padding: 18,
      marginBottom: 14,
    }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', letterSpacing: '1.5px', color: 'var(--text)' }}>{title}</div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text3)', marginTop: 2 }}>{sub}</div>
      </div>
      {children}
    </div>
  );
}

// ============================================================================
// Build Checklist — pages with status='briefed' or 'in_progress', mark complete
// with published URL.
// ============================================================================

interface BuildChecklistProps {
  pages: Page[];
  showToast: ShowToast;
  onPageUpdated: () => void;
}

function BuildChecklist({ pages, showToast, onPageUpdated }: BuildChecklistProps) {
  return (
    <SectionCard
      title={`Build checklist (${pages.length})`}
      sub="Pages briefed in Cowork. Paste the published URL when each goes live and mark it complete."
    >
      {pages.length === 0 ? (
        <div style={{ fontSize: '0.7rem', color: 'var(--text3)', fontStyle: 'italic' }}>
          Nothing pending. Generate a monthly batch from the Briefs tab to add more pages.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pages.map((p) => (
            <ChecklistRow key={p.id} page={p} showToast={showToast} onUpdated={onPageUpdated} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ChecklistRow({
  page, showToast, onUpdated,
}: {
  page: Page;
  showToast: ShowToast;
  onUpdated: () => void;
}) {
  const [url, setUrl] = useState<string>(page.published_url ?? page.url ?? '');
  const [notes, setNotes] = useState<string>(page.operator_notes ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function handleComplete() {
    if (!url.trim()) {
      showToast('Published URL required', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await api.pages.complete(page.id, { publishedUrl: url.trim(), notes: notes.trim() || undefined });
      showToast(`Marked complete: ${describe(page)}`, 'success');
      onUpdated();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Mark complete failed: ${msg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r)',
      padding: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--text)' }}>{describe(page)}</span>
        <span style={{ fontSize: '0.6rem', color: 'var(--text3)' }}>
          {page.type}
          {page.batch_period ? ` · batch ${page.batch_period}` : ''}
          {' · status: '}
          <strong style={{ color: page.status === 'briefed' ? 'var(--yellow)' : 'var(--text2)' }}>{page.status}</strong>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: 6 }}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://site.com/service-areas/…"
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r)', padding: '7px 9px',
            color: 'var(--text)', fontSize: '0.72rem', fontFamily: "'DM Mono', monospace",
          }}
        />
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r)', padding: '7px 9px',
            color: 'var(--text)', fontSize: '0.72rem', fontFamily: 'inherit',
          }}
        />
        <Button variant="primary" size="sm" disabled={submitting || !url.trim()} onClick={handleComplete}>
          {submitting ? <><Spinner /> Saving…</> : '✓ Mark complete'}
        </Button>
      </div>
    </div>
  );
}

function describe(page: Page): string {
  if (page.service && page.city) return `${page.service} in ${page.city}`;
  if (page.service) return page.service;
  if (page.title) return page.title;
  return `Page #${page.id}`;
}

// ============================================================================
// BriefViewerModalLoader — fetches the brief by id then renders the viewer.
// Wrapping it here keeps SiteDetailPanel from owning brief data directly.
// ============================================================================

function BriefViewerModalLoader({
  briefId, onClose, showToast, onRegenerated,
}: {
  briefId: number | null;
  onClose: () => void;
  showToast: ShowToast;
  onRegenerated: () => void;
}) {
  const [brief, setBrief] = useState<import('../../lib/types').Brief | null>(null);

  useEffect(() => {
    if (briefId == null) {
      setBrief(null);
      return;
    }
    void api.briefs.get(briefId).then(setBrief).catch((err) => {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load brief: ${msg}`, 'error');
      onClose();
    });
  }, [briefId, onClose, showToast]);

  return (
    <BriefViewerModal
      open={briefId !== null && brief !== null}
      brief={brief}
      onClose={onClose}
      showToast={showToast}
      onRegenerated={(b) => { setBrief(b); onRegenerated(); }}
    />
  );
}
