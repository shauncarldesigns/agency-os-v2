import { Hono } from 'hono';
import type { Env } from '../types';
import {
  listScripts,
  listObjectionsByCategory,
  listFollowUps,
  getScript,
  getObjection,
  getFollowUp,
} from '../services/playbook';

// Phase 2 ships the playbook runtime. Phase 3 will add /generate-rebuttal
// alongside the read endpoints below.
export const playbookRouter = new Hono<{ Bindings: Env }>();

// Sanity endpoint — eagerly parses every playbook file. Returns counts
// and full IDs so the operator can curl after deploy and confirm the
// runtime sees what's on disk.
playbookRouter.get('/_debug', (c) => {
  const scripts = listScripts();
  const objectionsByCategory = listObjectionsByCategory();
  const followUps = listFollowUps();
  return c.json({
    scripts: { count: scripts.length, items: scripts },
    objections: {
      counts: {
        standard: objectionsByCategory.standard.length,
        'deep-dive': objectionsByCategory['deep-dive'].length,
        closing: objectionsByCategory.closing.length,
      },
      by_category: objectionsByCategory,
    },
    follow_ups: { count: followUps.length, items: followUps.map((f) => ({ id: f.id, label: f.label, touch_count: f.touches.length })) },
  });
});

playbookRouter.get('/scripts', (c) => c.json({ scripts: listScripts() }));

playbookRouter.get('/scripts/:id', (c) => {
  const script = getScript(c.req.param('id'));
  if (!script) return c.json({ error: 'Script not found' }, 404);
  return c.json({ script });
});

playbookRouter.get('/objections', (c) => {
  return c.json({ by_category: listObjectionsByCategory() });
});

playbookRouter.get('/objections/:id', (c) => {
  const objection = getObjection(c.req.param('id'));
  if (!objection) return c.json({ error: 'Objection not found' }, 404);
  return c.json({ objection });
});

playbookRouter.get('/follow-ups/:id', (c) => {
  const sequence = getFollowUp(c.req.param('id'));
  if (!sequence) return c.json({ error: 'Follow-up not found' }, 404);
  return c.json({ sequence });
});
