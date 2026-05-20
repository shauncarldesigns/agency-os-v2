import { Hono } from 'hono';
import type { Env, BrandAttribute, BrandAttributeCategory, BrandAttributeSource } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';

export const brandAttributesRouter = new Hono<{ Bindings: Env }>();

const VALID_CATEGORIES: BrandAttributeCategory[] = [
  'tagline',
  'certification',
  'review_theme',
  'photography_direction',
  'positioning',
  'differentiator',
  'value',
  'other',
];

const VALID_SOURCES: BrandAttributeSource[] = ['scrape', 'reviews', 'operator', 'claude'];

// GET /api/projects/:projectId/brand-attributes
brandAttributesRouter.get('/projects/:projectId/brand-attributes', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const rows = await c.env.DB.prepare(
      `SELECT * FROM brand_attributes
       WHERE project_id = ?
       ORDER BY weight DESC, id ASC`
    )
      .bind(projectId)
      .all<BrandAttribute>();

    return c.json({ brandAttributes: rows.results ?? [] });
  } catch (err) {
    log('error', 'brand-attributes', 'GET failed', err);
    return c.json(serverError(), 500);
  }
});

// POST /api/projects/:projectId/brand-attributes
// Body: { category, value, source?, weight? }
brandAttributesRouter.post('/projects/:projectId/brand-attributes', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const body = (await c.req.json()) as {
      category?: string;
      value?: string;
      source?: string;
      weight?: number;
    };
    if (!body.category || !VALID_CATEGORIES.includes(body.category as BrandAttributeCategory)) {
      return c.json(badRequest(`category required, one of: ${VALID_CATEGORIES.join(', ')}`), 400);
    }
    if (!body.value || typeof body.value !== 'string') {
      return c.json(badRequest('value (string) required'), 400);
    }
    if (body.source && !VALID_SOURCES.includes(body.source as BrandAttributeSource)) {
      return c.json(badRequest(`source must be one of: ${VALID_SOURCES.join(', ')}`), 400);
    }

    const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
      .bind(projectId)
      .first<{ id: number }>();
    if (!project) return c.json(notFound('Project'), 404);

    const insert = await c.env.DB.prepare(
      `INSERT INTO brand_attributes (project_id, category, value, source, weight)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(projectId, body.category, body.value, body.source ?? null, body.weight ?? 1)
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM brand_attributes WHERE id = ?')
      .bind(insert.meta.last_row_id)
      .first<BrandAttribute>();

    return c.json(created, 201);
  } catch (err) {
    log('error', 'brand-attributes', 'POST failed', err);
    return c.json(serverError(`Brand attribute create failed: ${(err as Error).message}`), 500);
  }
});

// DELETE /api/brand-attributes/:id
brandAttributesRouter.delete('/brand-attributes/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json(badRequest('Invalid id'), 400);

    const row = await c.env.DB.prepare('SELECT id FROM brand_attributes WHERE id = ?')
      .bind(id)
      .first<{ id: number }>();
    if (!row) return c.json(notFound('Brand attribute'), 404);

    await c.env.DB.prepare('DELETE FROM brand_attributes WHERE id = ?').bind(id).run();
    return c.body(null, 204);
  } catch (err) {
    log('error', 'brand-attributes', 'DELETE failed', err);
    return c.json(serverError(), 500);
  }
});
