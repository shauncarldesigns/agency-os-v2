/**
 * Brief Studio matrix builder.
 *
 * Given a project, return the page matrix the operator sees in Site Detail:
 *   - foundationPages: Homepage, About, Services Overview, Contact, FAQ, plus
 *     any 'custom' rows the operator added
 *   - servicePages: one row per service in the project's services list
 *   - serviceAreaGrid: the services × cities grid for service-area pages
 *
 * Each cell carries the existing pages row (id + status + billing_status) if
 * one has been created, or nulls if the cell is still "planned but not
 * briefed". The UI uses those nulls to know when to POST a new brief vs open
 * an existing one.
 */

import type { Project, Page } from '../types';

// The full set of foundation page types. The Service Areas hub is in here
// but only emitted by buildMatrixForProject() when the project has 2+
// service areas — a single-city site has no service-area sub-tree to hub
// into, so the page would be a thin/useless index.
const FOUNDATION_TYPES = [
  { type: 'homepage', label: 'Homepage' },
  { type: 'about', label: 'About' },
  { type: 'services_overview', label: 'Services' },
  { type: 'service_areas_overview', label: 'Service Areas' },
  { type: 'contact', label: 'Contact' },
  { type: 'faq', label: 'FAQ' },
] as const;

type FoundationType = (typeof FOUNDATION_TYPES)[number]['type'];

export interface MatrixCell {
  pageId: number | null;
  status: string;            // 'planned' | 'briefed' | 'complete' (or '' if no row yet)
  billingStatus: string;     // 'included' | 'add_on' | 'comp' (or '' if no row yet)
  metrics: PageSearchMetrics | null;
}

export interface PageSearchMetrics {
  period: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number | null;
  positionChange: number | null;
  impressionsChange: number | null;
}

interface StoredPageMetric { page: string; impressions: number; clicks: number; position?: number | null }

export async function pageMetricsHistory(
  db: D1Database,
  projectId: number,
  publishedUrl: string | null,
  limit = 6,
): Promise<PageSearchMetrics[]> {
  const path = normalizePagePath(publishedUrl);
  if (!path) return [];
  const snapshots = await db.prepare(`SELECT period, top_pages FROM seo_snapshots WHERE project_id=? AND top_pages IS NOT NULL ORDER BY period DESC LIMIT ?`)
    .bind(projectId, limit).all<{ period: string; top_pages: string }>();
  const newestFirst = (snapshots.results ?? []).flatMap((snapshot) => {
    const metric = pageMetricMap(snapshot.top_pages).get(path);
    return metric ? [{ period: snapshot.period, metric }] : [];
  });
  return newestFirst.map(({ period, metric }, index) => {
    const previous = newestFirst[index + 1]?.metric;
    return {
      period,
      impressions: metric.impressions,
      clicks: metric.clicks,
      ctr: metric.impressions > 0 ? metric.clicks / metric.impressions : 0,
      position: metric.position ?? null,
      positionChange: metric.position != null && previous?.position != null ? previous.position - metric.position : null,
      impressionsChange: previous ? metric.impressions - previous.impressions : null,
    };
  });
}

export interface FoundationMatrixRow extends MatrixCell {
  type: FoundationType | 'custom';
  label: string;
}

export interface ServicePageMatrixRow extends MatrixCell {
  service: string;
}

export interface ServiceAreaCell extends MatrixCell {
  service: string;
  city: string;
}

export interface Matrix {
  foundationPages: FoundationMatrixRow[];
  servicePages: ServicePageMatrixRow[];
  serviceAreaGrid: {
    services: string[];
    cities: string[];
    cells: ServiceAreaCell[];
  };
}

export async function buildMatrixForProject(
  db: D1Database,
  projectId: number
): Promise<Matrix | null> {
  const project = await db
    .prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId)
    .first<Project>();
  if (!project) return null;

  const services = safeArr(project.services);
  const cities = safeArr(project.service_areas);

  const [pagesResult, snapshotsResult] = await Promise.all([
    db.prepare(`SELECT id, type, service, city, status, billing_status, published_url FROM pages WHERE project_id = ?`)
      .bind(projectId)
      .all<Pick<Page, 'id' | 'type' | 'service' | 'city' | 'status' | 'published_url'> & { billing_status: string | null }>(),
    db.prepare(`SELECT period, top_pages FROM seo_snapshots WHERE project_id = ? AND top_pages IS NOT NULL ORDER BY period DESC LIMIT 2`)
      .bind(projectId)
      .all<{ period: string; top_pages: string }>(),
  ]);
  const pages = pagesResult.results ?? [];
  const snapshots = snapshotsResult.results ?? [];
  const currentSnapshot = snapshots[0];
  const previousSnapshot = snapshots[1];
  const currentMetrics = pageMetricMap(currentSnapshot?.top_pages);
  const previousMetrics = pageMetricMap(previousSnapshot?.top_pages);
  const metricsFor = (page?: (typeof pages)[number]): PageSearchMetrics | null => {
    const path = normalizePagePath(page?.published_url);
    if (!path) return null;
    const current = currentMetrics.get(path);
    if (!current || !currentSnapshot) return null;
    const previous = previousMetrics.get(path);
    return {
      period: currentSnapshot.period,
      impressions: current.impressions,
      clicks: current.clicks,
      ctr: current.impressions > 0 ? current.clicks / current.impressions : 0,
      position: current.position ?? null,
      positionChange: current.position != null && previous?.position != null ? previous.position - current.position : null,
      impressionsChange: previous ? current.impressions - previous.impressions : null,
    };
  };

  // Index for fast lookups
  const foundationByType = new Map<string, (typeof pages)[number]>();
  const serviceByName = new Map<string, (typeof pages)[number]>();
  const cellByKey = new Map<string, (typeof pages)[number]>();

  for (const p of pages) {
    if (p.type === 'service-area' && p.service && p.city) {
      cellByKey.set(`${p.service}::${p.city}`.toLowerCase(), p);
    } else if (p.type === 'service' && p.service) {
      serviceByName.set(p.service.toLowerCase(), p);
    } else if (p.type) {
      foundationByType.set(p.type, p);
    }
  }

  // Service Areas hub only earns a row with 2+ service areas — same rule
  // as the service-area grid. Single-city projects don't need a hub page
  // that has nothing to hub into.
  const tooFewCitiesForHub = cities.length < 2;
  const foundationPages: FoundationMatrixRow[] = FOUNDATION_TYPES
    .filter((f) => !(f.type === 'service_areas_overview' && tooFewCitiesForHub))
    .map((f) => {
      const row = foundationByType.get(f.type);
      return {
        type: f.type,
        label: f.label,
        pageId: row?.id ?? null,
        status: row?.status ?? '',
        billingStatus: row?.billing_status ?? '',
        metrics: metricsFor(row),
      };
    });

  // Also include any 'custom' page rows already created
  for (const p of pages) {
    if (p.type === 'custom') {
      foundationPages.push({
        type: 'custom',
        label: p.service ?? `Custom page #${p.id}`, // service column holds the label
        pageId: p.id,
        status: p.status ?? '',
        billingStatus: p.billing_status ?? '',
        metrics: metricsFor(p),
      });
    }
  }

  const servicePages: ServicePageMatrixRow[] = services.map((service) => {
    const row = serviceByName.get(service.toLowerCase());
    return {
      service,
      pageId: row?.id ?? null,
      status: row?.status ?? '',
      billingStatus: row?.billing_status ?? '',
      metrics: metricsFor(row),
    };
  });

  const cells: ServiceAreaCell[] = [];
  for (const service of services) {
    for (const city of cities) {
      const row = cellByKey.get(`${service}::${city}`.toLowerCase());
      cells.push({
        service,
        city,
        pageId: row?.id ?? null,
        status: row?.status ?? '',
        billingStatus: row?.billing_status ?? '',
        metrics: metricsFor(row),
      });
    }
  }

  return {
    foundationPages,
    servicePages,
    serviceAreaGrid: { services, cities, cells },
  };
}

function pageMetricMap(raw: string | null | undefined): Map<string, StoredPageMetric> {
  const map = new Map<string, StoredPageMetric>();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return map;
    for (const item of parsed as StoredPageMetric[]) {
      const path = normalizePagePath(item.page);
      if (path) map.set(path, item);
    }
  } catch { /* A malformed snapshot should not break the page matrix. */ }
  return map;
}

function normalizePagePath(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, 'https://matrix.local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return decodeURIComponent(path).toLowerCase();
  } catch { return null; }
}

function safeArr(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}
