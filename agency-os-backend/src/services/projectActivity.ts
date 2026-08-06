export type ProjectActivityTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export interface ProjectActivityEvent {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  occurredAt: string;
  tone: ProjectActivityTone;
}

interface ActivityRow {
  id: number;
  kind?: string;
  title?: string | null;
  status?: string | null;
  detail?: string | null;
  occurred_at?: string | null;
}

function event(
  id: string,
  kind: string,
  title: string,
  occurredAt: string | null | undefined,
  detail: string | null = null,
  tone: ProjectActivityTone = 'neutral',
): ProjectActivityEvent | null {
  if (!occurredAt) return null;
  return { id, kind, title, detail, occurredAt, tone };
}

export async function getProjectActivity(db: D1Database, projectId: number): Promise<ProjectActivityEvent[]> {
  const project = await db.prepare(`
    SELECT id, lead_id, business_name, status, is_internal, created_at, updated_at,
           scrape_completed_at, dns_last_checked
      FROM projects WHERE id = ?
  `).bind(projectId).first<{
    id: number; lead_id: number | null; business_name: string; status: string;
    is_internal: number; created_at: string | null; updated_at: string | null;
    scrape_completed_at: string | null; dns_last_checked: string | null;
  }>();
  if (!project) return [];

  const [briefs, pages, onboarding, reports, snapshots, audits, growth, leadActivity] = await Promise.all([
    db.prepare(`SELECT id, kind, status, generated_at AS occurred_at, completed_at FROM briefs WHERE project_id = ?`).bind(projectId).all<ActivityRow & { completed_at: string | null }>(),
    db.prepare(`SELECT id, title, type AS kind, status, created_at AS occurred_at, COALESCE(marked_complete_at, built_at) AS completed_at FROM pages WHERE project_id = ?`).bind(projectId).all<ActivityRow & { completed_at: string | null }>(),
    db.prepare(`SELECT rowid AS id, item_key AS title, notes AS detail, completed_at AS occurred_at FROM project_onboarding_checks WHERE project_id = ? AND completed = 1`).bind(projectId).all<ActivityRow>(),
    db.prepare(`SELECT id, period AS title, sent_to AS detail, COALESCE(sent_at, created_at) AS occurred_at FROM report_history WHERE project_id = ?`).bind(projectId).all<ActivityRow>(),
    db.prepare(`SELECT id, period AS title, created_at AS occurred_at, impressions, clicks, avg_position FROM seo_snapshots WHERE project_id = ?`).bind(projectId).all<ActivityRow & { impressions: number | null; clicks: number | null; avg_position: number | null }>(),
    db.prepare(`SELECT id, status, completed_at AS occurred_at, started_at, pages_crawled, health_score, critical_count, warning_count, error_message FROM seo_audit_runs WHERE project_id = ?`).bind(projectId).all<ActivityRow & { started_at: string; pages_crawled: number; health_score: number | null; critical_count: number; warning_count: number; error_message: string | null }>(),
    db.prepare(`SELECT wi.id, wi.title, wi.category AS kind, wi.status, COALESCE(wi.completed_at, wi.updated_at) AS occurred_at FROM growth_work_items wi JOIN growth_cycles gc ON gc.id = wi.cycle_id WHERE gc.project_id = ?`).bind(projectId).all<ActivityRow>(),
    project.lead_id
      ? db.prepare(`SELECT id, action AS kind, meta AS detail, created_at AS occurred_at FROM lead_activity WHERE lead_id = ? AND action IN ('client_pending','client_converted','brief_generated','url_saved','contract_signed')`).bind(project.lead_id).all<ActivityRow>()
      : Promise.resolve({ results: [] as ActivityRow[] }),
  ]);

  const events: ProjectActivityEvent[] = [];
  const add = (value: ProjectActivityEvent | null) => { if (value) events.push(value); };
  add(event(`project-created-${project.id}`, 'project_created', 'Client workspace created', project.created_at, project.is_internal ? 'Internal workspace' : null, 'success'));
  if (project.updated_at && project.updated_at !== project.created_at) {
    add(event(`project-updated-${project.id}`, 'project_updated', 'Client configuration updated', project.updated_at, null, 'info'));
  }
  add(event(`scrape-${project.id}`, 'website_scanned', 'Website data refreshed', project.scrape_completed_at, null, 'info'));
  add(event(`dns-${project.id}`, 'dns_checked', 'Domain and DNS checked', project.dns_last_checked, null, 'info'));

  for (const row of briefs.results) {
    add(event(`brief-${row.id}`, 'brief_generated', `${row.kind === 'master' ? 'Master' : row.kind === 'outreach' ? 'Outreach' : 'Page'} brief generated`, row.occurred_at, row.status ? `Status: ${row.status}` : null, 'info'));
    add(event(`brief-complete-${row.id}`, 'brief_completed', 'Brief marked complete', row.completed_at, null, 'success'));
  }
  for (const row of pages.results) {
    const name = row.title || `${row.kind || 'Page'} page`;
    add(event(`page-${row.id}`, 'page_added', `${name} added to Page Matrix`, row.occurred_at, row.status ? `Status: ${row.status}` : null, 'info'));
    add(event(`page-live-${row.id}`, 'page_completed', `${name} marked live`, row.completed_at, null, 'success'));
  }
  for (const row of onboarding.results) {
    add(event(`onboarding-${row.id}`, 'onboarding_completed', `Onboarding completed: ${(row.title || '').replaceAll('_', ' ')}`, row.occurred_at, row.detail ?? null, 'success'));
  }
  for (const row of reports.results) {
    add(event(`report-${row.id}`, 'report_sent', `Report prepared for ${row.title}`, row.occurred_at, row.detail ? `Recipient: ${row.detail}` : null, 'success'));
  }
  for (const row of snapshots.results) {
    const metrics = [`${row.impressions ?? 0} impressions`, `${row.clicks ?? 0} clicks`];
    if (row.avg_position != null) metrics.push(`average position ${row.avg_position.toFixed(1)}`);
    add(event(`snapshot-${row.id}`, 'reporting_refreshed', `Reporting data refreshed for ${row.title}`, row.occurred_at, metrics.join(' · '), 'info'));
  }
  for (const row of audits.results) {
    const occurredAt = row.occurred_at || row.started_at;
    const failed = row.status === 'failed';
    const detail = failed
      ? row.error_message
      : `${row.pages_crawled} pages · health ${row.health_score ?? '—'} · ${row.critical_count} critical · ${row.warning_count} warnings`;
    add(event(`audit-${row.id}`, 'seo_audit', failed ? 'SEO audit failed' : 'SEO audit completed', occurredAt, detail, failed ? 'error' : 'success'));
  }
  for (const row of growth.results) {
    add(event(`growth-${row.id}`, 'growth_work', row.title || 'Growth work updated', row.occurred_at, `${row.kind || 'work'} · ${row.status || 'updated'}`, row.status === 'complete' ? 'success' : 'info'));
  }
  for (const row of leadActivity.results) {
    const title = row.kind === 'client_pending' ? 'Moved to Clients — agreement pending' : row.kind === 'contract_signed' ? 'Agreement marked signed' : row.kind === 'client_converted' ? 'Lead converted to client' : row.kind === 'brief_generated' ? 'Outreach brief generated' : 'Outreach site URL saved';
    add(event(`lead-${row.id}`, row.kind || 'lead_activity', title, row.occurred_at, null, row.kind === 'client_converted' || row.kind === 'contract_signed' ? 'success' : 'info'));
  }

  return events
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 150);
}
