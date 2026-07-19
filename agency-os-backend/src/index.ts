import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { authMiddleware } from './utils/auth';
import { log } from './utils/errors';
import { leadsRouter } from './routes/leads';
import { leadCallsRouter, callsRouter } from './routes/calls';
import { prospectRouter } from './routes/prospect';
import { enrichRouter, leadEnrichRouter } from './routes/enrich';
import { projectsRouter } from './routes/projects';
import { briefsRouter } from './routes/briefs';
import { brandAttributesRouter } from './routes/brand-attributes';
import { testimonialsRouter } from './routes/testimonials';
import { scrapeRouter } from './routes/scrape';
import { reportsRouter, refreshTier3Snapshots, refreshTier3PageSpeed } from './routes/reports';
import { dnsRouter, pollPendingDnsZones } from './routes/dns';
import { sessionsRouter } from './routes/sessions';
import { callbacksRouter } from './routes/callbacks';
import { demosRouter } from './routes/demos';
import { dashboardRouter } from './routes/dashboard';
import { playbookRouter } from './routes/playbook';
import { recordingsRouter } from './routes/recordings';
import { pipelineRouter } from './routes/pipeline';
import { redirectRouter } from './routes/redirect';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'X-API-Key'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.get('/', c => c.json({ name: 'agency-os-v2-api', version: '2.0.0', status: 'ok' }));
app.get('/health', c => c.json({ status: 'ok', ts: new Date().toISOString() }));

// Public click-tracker for Automated Pipeline text links (/r/:lead_id).
// MUST mount before the /api/* auth middleware so recipient browsers can
// resolve the redirect without an API key.
app.route('/', redirectRouter);

app.use('/api/*', authMiddleware());

// Sub-routes that share /api/leads must mount before the bare leads router
app.route('/api/leads', leadCallsRouter);
app.route('/api/leads', leadEnrichRouter);
app.route('/api/leads', enrichRouter); // exposes /enrich-all under /api/leads/enrich-all
app.route('/api/leads', leadsRouter);
app.route('/api/calls', callsRouter);
app.route('/api/prospect', prospectRouter);
// dnsRouter handles /:id/dns/* — mount before projectsRouter so the more
// specific DNS paths match first (Hono's matcher is order-dependent for
// overlapping subrouters mounted at the same prefix).
app.route('/api/projects', dnsRouter);
app.route('/api/projects', projectsRouter);
// v2.1 brief routes span /api/projects/:id/briefs, /api/briefs/:id, and /api/pages/:id/complete
app.route('/api', briefsRouter);
app.route('/api', brandAttributesRouter);
app.route('/api', testimonialsRouter);
app.route('/api', scrapeRouter);
app.route('/api/reports', reportsRouter);
// Calling dashboard (Phase 3)
app.route('/api/sessions', sessionsRouter);
app.route('/api/callbacks', callbacksRouter);
app.route('/api/demos', demosRouter);
app.route('/api/dashboard', dashboardRouter);
// Playbook content (read endpoints + /_debug). Phase 3 adds /generate-rebuttal here.
app.route('/api/playbook', playbookRouter);
// Call recordings — multipart upload → R2, returns public URL.
app.route('/api/recordings', recordingsRouter);
// Automated Pipeline — text + site outreach queue.
app.route('/api/pipeline', pipelineRouter);

app.notFound(c => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404));
app.onError((err, c) => {
  log('error', 'app', 'Unhandled error', err.message);
  return c.json({ error: 'Internal server error', code: 'SERVER_ERROR' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    log('info', 'cron', `Scheduled trigger: ${event.cron}`);
    if (event.cron === '0 6 * * *') {
      // Daily 6am — refresh PageSpeed for live Tier 3 sites
      ctx.waitUntil(refreshTier3PageSpeed(env));
    } else if (event.cron === '0 7 1 * *') {
      // Monthly 1st 7am — finalize prior-month snapshots + exec summaries
      ctx.waitUntil(refreshTier3Snapshots(env).then(out => log('info', 'cron', `Monthly snapshot run`, { results: out })));
    } else if (event.cron === '0 8 * * 1') {
      // Weekly Monday 8am — refresh GSC for current period (intermediate progress check)
      ctx.waitUntil(refreshTier3Snapshots(env).then(out => log('info', 'cron', `Weekly GSC refresh run`, { results: out })));
    } else if (event.cron === '0 * * * *') {
      // Hourly — poll Cloudflare for any project zones still awaiting
      // nameserver delegation. Flips dns_status pending→active when CF
      // reports the zone is active. Partial index makes this cheap when
      // there are zero pending projects.
      ctx.waitUntil(pollPendingDnsZones(env).then(out => log('info', 'cron', `DNS poll run`, { count: out.length })));
    }
  },
};
