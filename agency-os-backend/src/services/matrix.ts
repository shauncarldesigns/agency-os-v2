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

  const pagesResult = await db
    .prepare(
      `SELECT id, type, service, city, status, billing_status
       FROM pages
       WHERE project_id = ?`
    )
    .bind(projectId)
    .all<Pick<Page, 'id' | 'type' | 'service' | 'city' | 'status'> & { billing_status: string | null }>();
  const pages = pagesResult.results ?? [];

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
      });
    }
  }

  return {
    foundationPages,
    servicePages,
    serviceAreaGrid: { services, cities, cells },
  };
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
