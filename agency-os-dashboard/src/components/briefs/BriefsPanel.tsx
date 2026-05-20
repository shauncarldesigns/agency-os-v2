import { useState, useEffect, useCallback } from 'react';
import type {
  Lead, Project, Brief, BriefSummary, BriefKind, ShowToast, BriefsContext,
} from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { TierPill } from '../shared/TierPill';
import { BriefViewerModal } from './BriefViewerModal';
import { OperatorInputForm } from './OperatorInputForm';
import { MonthlyBatchModal } from './MonthlyBatchModal';

interface BriefsPanelProps {
  context: BriefsContext | null;
  showToast: ShowToast;
  onClearContext: () => void;
  onProjectCreated: () => void;
}

interface ProjectWithBriefs {
  project: Project;
  briefs: BriefSummary[];
  lead: Lead | null;
}

const KIND_LABEL: Record<BriefKind, string> = {
  homepage_demo: 'Homepage Demo',
  master: 'Master',
  monthly_batch: 'Monthly Batch',
};

export function BriefsPanel({ context, showToast, onClearContext, onProjectCreated }: BriefsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [qualifiedLeads, setQualifiedLeads] = useState<Lead[]>([]);
  const [projects, setProjects] = useState<ProjectWithBriefs[]>([]);
  const [generatingFor, setGeneratingFor] = useState<number | null>(null);   // lead id while creating demo
  const [viewerBrief, setViewerBrief] = useState<Brief | null>(null);
  const [operatorFormFor, setOperatorFormFor] = useState<ProjectWithBriefs | null>(null);
  const [monthlyBatchFor, setMonthlyBatchFor] = useState<ProjectWithBriefs | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [leadsRes, projectsRes] = await Promise.all([
        api.leads.list(),
        api.projects.list(),
      ]);

      // Qualified leads with no project yet → eligible for homepage demo.
      const eligible = leadsRes.leads.filter(
        (l) => (l.status === 'qualified' || l.status === 'contacted') && l.project_id == null,
      );
      setQualifiedLeads(eligible);

      // For each project, fetch its briefs + parent lead (in parallel-ish).
      const projectRows: ProjectWithBriefs[] = await Promise.all(
        projectsRes.projects.map(async (p) => {
          const [briefsRes, leadObj] = await Promise.all([
            api.briefs.listForProject(p.id).catch(() => ({ briefs: [] })),
            p.lead_id ? api.leads.get(p.lead_id).then((r) => r.lead).catch(() => null) : Promise.resolve(null),
          ]);
          return { project: p, briefs: briefsRes.briefs, lead: leadObj };
        }),
      );
      // Sort: projects with no master brief first (need attention), then by most recent activity.
      projectRows.sort((a, b) => {
        const aHasMaster = a.briefs.some((br) => br.kind === 'master' && br.status !== 'archived');
        const bHasMaster = b.briefs.some((br) => br.kind === 'master' && br.status !== 'archived');
        if (aHasMaster !== bHasMaster) return aHasMaster ? 1 : -1;
        return b.project.updated_at.localeCompare(a.project.updated_at);
      });
      setProjects(projectRows);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load briefs: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void reload(); }, [reload]);

  // If a context was set from Pipeline, scroll to the relevant card after load.
  useEffect(() => {
    if (!context || loading) return;
    const targetId = context.projectId ?? null;
    const targetLead = context.leadId ?? null;
    const el = targetId
      ? document.getElementById(`project-card-${targetId}`)
      : targetLead
        ? document.getElementById(`lead-row-${targetLead}`)
        : null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [context, loading]);

  async function handleGenerateHomepageDemo(lead: Lead) {
    setGeneratingFor(lead.id);
    try {
      // Step 1: create project shell from lead.
      const tier = (lead.recommended_tier ?? 1) as 1 | 2 | 3;
      const projRes = await api.projects.create({ leadId: lead.id, tier });
      const newProjectId = projRes.project.id;
      onProjectCreated();

      // Step 2: generate homepage demo brief.
      const brief = await api.briefs.master(newProjectId, 'homepage_only');
      showToast(`Homepage demo generated for ${lead.company}`, 'success');
      setViewerBrief(brief);
      await reload();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Demo generation failed: ${msg}`, 'error');
    } finally {
      setGeneratingFor(null);
    }
  }

  async function openBrief(briefId: number) {
    try {
      const brief = await api.briefs.get(briefId);
      setViewerBrief(brief);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load brief: ${msg}`, 'error');
    }
  }

  return (
    <>
      <div className="sec-header">
        <div>
          <div className="sec-title">Briefs</div>
          <div className="sec-sub">Generate homepage demos for cold calls and master briefs for signed clients.</div>
        </div>
      </div>

      {context && (
        <div style={{
          background: 'var(--accent-dim)',
          border: '1px solid rgba(255,107,43,0.22)',
          borderRadius: 'var(--r)',
          padding: '10px 14px',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--accent)' }}>
            ⚡ From Pipeline: <strong style={{ color: 'var(--text)' }}>{context.businessName}</strong>
          </div>
          <Button variant="ghost" size="xs" onClick={onClearContext}>Clear</Button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: '0.75rem' }}>
          <Spinner /> Loading briefs…
        </div>
      ) : (
        <>
          <SectionCard
            title={`Ready for Homepage Demo (${qualifiedLeads.length})`}
            sub="Qualified leads with no project yet. Generate a homepage demo to pitch on the call."
          >
            {qualifiedLeads.length === 0 ? (
              <div style={{ fontSize: '0.7rem', color: 'var(--text3)', fontStyle: 'italic' }}>
                No qualified leads waiting. Promote leads in Pipeline to status “qualified” first.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {qualifiedLeads.map((l) => (
                  <LeadDemoRow
                    key={l.id}
                    lead={l}
                    generating={generatingFor === l.id}
                    onGenerate={() => handleGenerateHomepageDemo(l)}
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={`Projects (${projects.length})`}
            sub="Generate master briefs, regenerate with feedback, or queue monthly batches (Tier 3)."
          >
            {projects.length === 0 ? (
              <div style={{ fontSize: '0.7rem', color: 'var(--text3)', fontStyle: 'italic' }}>
                No projects yet. Click “Generate Homepage Demo” above to create one from a qualified lead.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {projects.map((row) => (
                  <ProjectBriefCard
                    key={row.project.id}
                    row={row}
                    onOpenBrief={openBrief}
                    onOpenMasterForm={() => setOperatorFormFor(row)}
                    onOpenMonthlyBatch={() => setMonthlyBatchFor(row)}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}

      <BriefViewerModal
        open={viewerBrief !== null}
        onClose={() => setViewerBrief(null)}
        brief={viewerBrief}
        showToast={showToast}
        onRegenerated={(b) => { setViewerBrief(b); void reload(); }}
      />

      {operatorFormFor && (
        <OperatorInputForm
          open={true}
          onClose={() => setOperatorFormFor(null)}
          project={operatorFormFor.project}
          lead={operatorFormFor.lead}
          showToast={showToast}
          onBriefGenerated={(b) => {
            setOperatorFormFor(null);
            setViewerBrief(b);
            void reload();
          }}
        />
      )}

      {monthlyBatchFor && (
        <MonthlyBatchModal
          open={true}
          project={monthlyBatchFor.project}
          showToast={showToast}
          onClose={() => setMonthlyBatchFor(null)}
          onBriefGenerated={(b) => {
            setMonthlyBatchFor(null);
            setViewerBrief(b);
            void reload();
          }}
        />
      )}
    </>
  );
}

// ============================================================================

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

function LeadDemoRow({ lead, generating, onGenerate }: { lead: Lead; generating: boolean; onGenerate: () => void }) {
  return (
    <div
      id={`lead-row-${lead.id}`}
      style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.82rem', color: 'var(--text)', fontWeight: 600 }}>{lead.company}</div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text3)', marginTop: 2 }}>
          {[lead.city, lead.state].filter(Boolean).join(', ') || '—'}
          {lead.google_review_count ? ` · ${lead.google_review_count} reviews mined` : ''}
          {lead.recommended_tier ? ` · recommended Tier ${lead.recommended_tier}` : ''}
        </div>
      </div>
      <Button variant="primary" size="sm" disabled={generating} onClick={onGenerate}>
        {generating ? <><Spinner /> Generating…</> : '✦ Generate Homepage Demo'}
      </Button>
    </div>
  );
}

function ProjectBriefCard({
  row, onOpenBrief, onOpenMasterForm, onOpenMonthlyBatch,
}: {
  row: ProjectWithBriefs;
  onOpenBrief: (briefId: number) => void;
  onOpenMasterForm: () => void;
  onOpenMonthlyBatch: () => void;
}) {
  const { project, briefs } = row;
  const activeMaster = briefs.find((b) => b.kind === 'master' && b.status !== 'archived');
  const isTier3 = project.tier === 3;
  const monthlyEnabled = isTier3 && !!activeMaster;

  return (
    <div
      id={`project-card-${project.id}`}
      style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.88rem', color: 'var(--text)', fontWeight: 600 }}>{project.business_name}</span>
            <TierPill tier={project.tier} />
            <span style={{ fontSize: '0.62rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              {project.status}
            </span>
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text3)', marginTop: 2 }}>
            {[project.city, project.state].filter(Boolean).join(', ') || '—'}
            {project.pages_built ? ` · ${project.pages_built} pages built` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {!activeMaster && (
            <Button variant="primary" size="sm" onClick={onOpenMasterForm}>
              ✦ Generate Master Brief
            </Button>
          )}
          {activeMaster && (
            <Button variant="ghost" size="sm" onClick={() => onOpenBrief(activeMaster.id)}>
              📄 View Master Brief
            </Button>
          )}
          <Button
            variant={monthlyEnabled ? 'tier3' : 'ghost'}
            size="sm"
            disabled={!monthlyEnabled}
            onClick={onOpenMonthlyBatch}
            title={!isTier3 ? 'Tier 3 only' : !activeMaster ? 'Generate the master brief first' : 'Pick pages and generate this month\'s batch'}
          >
            🗓 Monthly Batch
          </Button>
        </div>
      </div>

      <BriefHistory briefs={briefs} onOpen={onOpenBrief} />
    </div>
  );
}

function BriefHistory({ briefs, onOpen }: { briefs: BriefSummary[]; onOpen: (id: number) => void }) {
  if (briefs.length === 0) {
    return (
      <div style={{ fontSize: '0.65rem', color: 'var(--text3)', fontStyle: 'italic', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        No briefs generated yet.
      </div>
    );
  }
  return (
    <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: '0.62rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
        Brief history ({briefs.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {briefs.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onOpen(b.id)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r)',
              padding: '6px 10px',
              fontSize: '0.7rem',
              color: 'var(--text2)',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
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
    </div>
  );
}
