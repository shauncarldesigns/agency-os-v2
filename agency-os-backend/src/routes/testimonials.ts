import { Hono } from 'hono';
import type { Env, Testimonial, TestimonialSource } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';

export const testimonialsRouter = new Hono<{ Bindings: Env }>();

const VALID_SOURCES: TestimonialSource[] = ['google', 'operator', 'website', 'other'];

// GET /api/projects/:projectId/testimonials
testimonialsRouter.get('/projects/:projectId/testimonials', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const rows = await c.env.DB.prepare(
      `SELECT * FROM testimonials
       WHERE project_id = ?
       ORDER BY is_featured DESC, id ASC`
    )
      .bind(projectId)
      .all<Testimonial>();

    return c.json({ testimonials: rows.results ?? [] });
  } catch (err) {
    log('error', 'testimonials', 'GET failed', err);
    return c.json(serverError(), 500);
  }
});

// POST /api/projects/:projectId/testimonials
// Body: { authorName, authorLocation?, quote, rating?, source?, isFeatured? }
testimonialsRouter.post('/projects/:projectId/testimonials', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json(badRequest('Invalid projectId'), 400);

    const body = (await c.req.json()) as {
      authorName?: string;
      authorLocation?: string;
      quote?: string;
      rating?: number;
      source?: string;
      isFeatured?: boolean;
    };
    if (!body.authorName || typeof body.authorName !== 'string') {
      return c.json(badRequest('authorName required'), 400);
    }
    if (!body.quote || typeof body.quote !== 'string') {
      return c.json(badRequest('quote required'), 400);
    }
    if (body.source && !VALID_SOURCES.includes(body.source as TestimonialSource)) {
      return c.json(badRequest(`source must be one of: ${VALID_SOURCES.join(', ')}`), 400);
    }
    if (body.rating != null && (typeof body.rating !== 'number' || body.rating < 1 || body.rating > 5)) {
      return c.json(badRequest('rating must be a number 1-5'), 400);
    }

    const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
      .bind(projectId)
      .first<{ id: number }>();
    if (!project) return c.json(notFound('Project'), 404);

    const insert = await c.env.DB.prepare(
      `INSERT INTO testimonials (project_id, author_name, author_location, quote, rating, source, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        projectId,
        body.authorName,
        body.authorLocation ?? null,
        body.quote,
        body.rating ?? null,
        body.source ?? null,
        body.isFeatured ? 1 : 0
      )
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM testimonials WHERE id = ?')
      .bind(insert.meta.last_row_id)
      .first<Testimonial>();

    return c.json(created, 201);
  } catch (err) {
    log('error', 'testimonials', 'POST failed', err);
    return c.json(serverError(`Testimonial create failed: ${(err as Error).message}`), 500);
  }
});

// PATCH /api/testimonials/:id
// Body: { authorName?, authorLocation?, quote?, rating?, source?, isFeatured? }
testimonialsRouter.patch('/testimonials/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json(badRequest('Invalid id'), 400);

    const body = (await c.req.json()) as {
      authorName?: string;
      authorLocation?: string | null;
      quote?: string;
      rating?: number | null;
      source?: string | null;
      isFeatured?: boolean;
    };

    const existing = await c.env.DB.prepare('SELECT * FROM testimonials WHERE id = ?')
      .bind(id)
      .first<Testimonial>();
    if (!existing) return c.json(notFound('Testimonial'), 404);

    if (body.source != null && body.source !== '' && !VALID_SOURCES.includes(body.source as TestimonialSource)) {
      return c.json(badRequest(`source must be one of: ${VALID_SOURCES.join(', ')}`), 400);
    }
    if (body.rating != null && (typeof body.rating !== 'number' || body.rating < 1 || body.rating > 5)) {
      return c.json(badRequest('rating must be a number 1-5'), 400);
    }

    await c.env.DB.prepare(
      `UPDATE testimonials
       SET author_name = COALESCE(?, author_name),
           author_location = CASE WHEN ? = 1 THEN ? ELSE author_location END,
           quote = COALESCE(?, quote),
           rating = CASE WHEN ? = 1 THEN ? ELSE rating END,
           source = CASE WHEN ? = 1 THEN ? ELSE source END,
           is_featured = COALESCE(?, is_featured)
       WHERE id = ?`
    )
      .bind(
        body.authorName ?? null,
        body.authorLocation !== undefined ? 1 : 0,
        body.authorLocation ?? null,
        body.quote ?? null,
        body.rating !== undefined ? 1 : 0,
        body.rating ?? null,
        body.source !== undefined ? 1 : 0,
        body.source ?? null,
        body.isFeatured === undefined ? null : body.isFeatured ? 1 : 0,
        id
      )
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM testimonials WHERE id = ?')
      .bind(id)
      .first<Testimonial>();
    return c.json(updated);
  } catch (err) {
    log('error', 'testimonials', 'PATCH failed', err);
    return c.json(serverError(`Testimonial update failed: ${(err as Error).message}`), 500);
  }
});

// DELETE /api/testimonials/:id
testimonialsRouter.delete('/testimonials/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json(badRequest('Invalid id'), 400);

    const row = await c.env.DB.prepare('SELECT id FROM testimonials WHERE id = ?')
      .bind(id)
      .first<{ id: number }>();
    if (!row) return c.json(notFound('Testimonial'), 404);

    await c.env.DB.prepare('DELETE FROM testimonials WHERE id = ?').bind(id).run();
    return c.body(null, 204);
  } catch (err) {
    log('error', 'testimonials', 'DELETE failed', err);
    return c.json(serverError(), 500);
  }
});
