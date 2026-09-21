import { Hono } from 'hono';
import type { Env } from '../types';
import { badRequest, notFound, serverError, log } from '../utils/errors';
import { callClaudeVisionJson } from '../services/claude';

export const designLibraryRouter = new Hono<{ Bindings: Env }>();

export interface DesignReference {
  id: number;
  name: string;
  description: string | null;
  source_lead_id: number | null;
  source_project_id: number | null;
  source_url: string | null;
  industry: string | null;
  status: 'draft' | 'ready' | 'archived';
  notes: string | null;
  style_tags: string;
  design_recipe: string;
  technical_tokens: string;
  source_brief_snapshot: string | null;
  recipe_generated_at: string | null;
  recipe_generation_error: string | null;
  reuse_count: number;
  created_at: string;
  updated_at: string;
  preview_asset_id?: number | null;
}

interface DesignAsset {
  id: number;
  design_reference_id: number;
  kind: 'desktop_full' | 'mobile_full';
  viewport_width: number;
  viewport_height: number;
  created_at: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

const NORTHTOWN_RECIPE = `DESIGN REFERENCE: Dark Emergency Service

Use this reference for visual direction only. Never reuse the source company's identity, logo, address, phone, reviews, photographs, or wording. New-business facts always take precedence.

DESIGN CHARACTER
Restrained, premium local-service design with a calm emergency-response character. Operational and dependable rather than promotional. Alternate midnight-blue, white, and pale blue-gray sections. Avoid conventional red-versus-blue HVAC styling, loud gradients, decorative gauges, and generic trust claims.

COLOR AND TYPE
- Primary midnight: #081724
- Elevated dark surface: #0F2436
- Steel blue: #244058
- Light section: #F2F6FA
- White: #FFFFFF
- Light-card border: #C6D8E8
- Muted text: #5F7180
- Light text: #E3ECF4
- Status accent used sparingly: #20C997
- Display headings: Archivo, 800 weight
- Body, navigation, labels, and buttons: Inter
- Desktop hero: 60px/61px; major H2: 44px/49px; inset H2: 36px/40px; card H3: 18px/28px

CONTAINER SYSTEM
Use .container { max-width: 96rem; } with responsive horizontal padding. At a 1280px viewport the container fills the viewport and visible content begins 32px from each edge. Do not replace this with a fixed 1216px shell plus additional padding. All primary sections share the same visible edges.

BORDERS AND SURFACES
- White cards: white background, 1px solid #C6D8E8, 16px radius, 24px padding, no resting shadow.
- Major dark translucent panels: rgba(255,255,255,.05 to .08), 1px solid rgba(255,255,255,.15), 24px radius, 20–24px backdrop blur.
- Small dark cards: rgba(255,255,255,.05), 1px solid rgba(255,255,255,.12), 16px radius.
- Dark pills: rgba(255,255,255,.05), border rgba(255,255,255,.20 to .25), fully rounded.
- Dark dividers: rgba(255,255,255,.10).
- Hover only: lift light cards 4px, darken border toward #96B8D3, add restrained shadow.

HERO
Approximately 746px tall. Full-bleed HVAC service photograph rendered at 35% opacity. Place above it a separate diagonal overlay: linear-gradient(to bottom right, #081724 0%, rgba(8,23,36,.92) 50%, rgba(36,64,88,.70) 100%). The photo supplies texture and should be difficult to perceive at first glance. Add a heavily blurred 448px steel-blue glow at 20% opacity partly outside the upper-right.
Use a 1.05fr / .95fr two-column grid with a 64px gap. Left: exact hero copy, two pill CTAs, and a small operational note. Right: a roughly 547x500 translucent hours card with 32px padding, 24px radius, white/8 background, white/15 border, backdrop blur, and 0 25px 50px -12px rgba(0,0,0,.40) shadow. Include day rows with white/10 dividers, a small teal status pill, location, and service-coverage line.

SECTION BLUEPRINT
1. Thin dark utility bar with status dot and coverage message.
2. White header: logo; Emergency Repair, Services, Service Areas, About; outlined phone and solid emergency CTA.
3. Full-width dark photographic hero with hours card.
4. White services section: label, large heading, introduction, six equal bordered cards in a 3x2 grid, then pale symptom callout. At 1280px cards are about 392x272 with 20px gaps.
5. Pale-blue About split: visible three-image editorial HVAC collage on left; two concise paragraphs, four-item checklist, and text link on right.
6. Full-width dark service-area feature: label and heading, then a 676px photographic map-style panel and 500px towns panel separated by about 40px. Both about 523px tall with 24px radii and white/15 borders.
7. White section containing inset dark emergency panel with 56px padding; 36px one-line heading on left and three translucent information cards on right.
8. Pale FAQ split: approximately 490px introduction and 662px white bordered accordion with 64px gap. All items collapsed initially.
9. White section with a full-width split contact panel, approximately 48% dark information side and 52% pale form side.
10. Slim dark CTA strip and deep midnight four-column footer.

SERVICE-AREA TREATMENT
Use a desaturated aerial residential-neighborhood photograph, not a radar, blueprint, grid, or embedded map. Overlay linear-gradient(to top, #081724 0%, rgba(8,23,36,.45) 50%, rgba(15,36,54,.20) 100%). Place outlined town-marker pills and a translucent home-base card over the image. Add a heavily blurred 672x384 steel-blue glow at 20% opacity behind the section.

ICON SYSTEM
Use Lucide outline icons. Service icons are 24x24, 2px stroke, #244058, in pale rounded-square containers. Exact semantic mapping: emergency=Siren; furnace repair=Flame; AC repair=Snowflake; heating installation=ThermometerSun; AC installation=Wind; maintenance=Wrench. Supporting icons use Phone, Clock, MapPin, ShieldCheck, Check, ArrowRight, ArrowUpRight, and Plus at 16–20px with 1.8–2px strokes.

RESPONSIVE AND STATE
Stack split layouts on mobile while preserving section order, borders, overlays, and dark/light rhythm. Keep all three About images visible. Keep the photographic service-area panel. All FAQ items start collapsed; no content may remain invisible after animation; contact form starts empty. Do not invent social URLs or business claims.`;

const NORTHTOWN_TOKENS = JSON.stringify({
  container: { maxWidth: '96rem', desktopPaddingInline: '2rem', behavior: 'full-width below 1536px' },
  typography: { displayFamily: 'Archivo', bodyFamily: 'Inter' },
  colors: { midnight: '#081724', darkSurface: '#0F2436', steel: '#244058', lightBackground: '#F2F6FA', lightBorder: '#C6D8E8', accent: '#20C997' },
  hero: { imageOpacity: 0.35, overlay: 'linear-gradient(to bottom right, #081724 0%, rgba(8,23,36,.92) 50%, rgba(36,64,88,.70) 100%)' },
  serviceIcons: { library: 'Lucide', size: 24, strokeWidth: 2, mapping: { emergency: 'Siren', furnaceRepair: 'Flame', acRepair: 'Snowflake', heatingInstallation: 'ThermometerSun', acInstallation: 'Wind', maintenance: 'Wrench' } },
});

async function ensureStarterReference(db: D1Database) {
  const count = await db.prepare('SELECT COUNT(*) AS count FROM design_references').first<{ count: number }>();
  if (Number(count?.count ?? 0) > 0) return;
  await db.prepare(`INSERT INTO design_references
    (name, description, source_url, industry, status, notes, style_tags, design_recipe, technical_tokens)
    VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?)`)
    .bind(
      'Dark Emergency Service',
      'Northtown-inspired operational service design with deep layered surfaces, visible cool borders, and a photographic service-area treatment.',
      'https://northtown-heating-air-conditioning.agcy.dev/',
      'HVAC',
      'Validated through two LandingSite test generations. Container rule corrected to max-width: 96rem.',
      JSON.stringify(['dark', 'emergency', 'local service', 'operational', 'editorial']),
      NORTHTOWN_RECIPE,
      NORTHTOWN_TOKENS,
    ).run();
}

designLibraryRouter.get('/design-references', async (c) => {
  try {
    await ensureStarterReference(c.env.DB);
    const result = await c.env.DB.prepare(`SELECT d.*,
      (SELECT a.id FROM design_reference_assets a JOIN design_capture_jobs j ON j.id=a.capture_job_id
       WHERE a.design_reference_id=d.id AND a.kind='desktop_full' AND j.status='completed'
       ORDER BY j.id DESC LIMIT 1) preview_asset_id
      FROM design_references d ORDER BY
      CASE status WHEN 'ready' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, updated_at DESC`).all<DesignReference>();
    return c.json({ designs: result.results });
  } catch (err) {
    log('error', 'design-library', 'GET /design-references failed', err);
    return c.json(serverError(), 500);
  }
});

designLibraryRouter.get('/design-references/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json(badRequest('Invalid design reference ID'), 400);
  const design = await c.env.DB.prepare('SELECT * FROM design_references WHERE id = ?').bind(id).first<DesignReference>();
  return design ? c.json({ design }) : c.json(notFound('Design reference'), 404);
});

designLibraryRouter.post('/design-references', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const recipe = typeof body.design_recipe === 'string' ? body.design_recipe.trim() : '';
    if (!name || !recipe) return c.json(badRequest('Name and design recipe are required'), 400);
    const result = await c.env.DB.prepare(`INSERT INTO design_references
      (name, description, source_url, industry, status, notes, style_tags, design_recipe, technical_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(name, body.description ?? null, body.source_url ?? null, body.industry ?? null,
        body.status === 'ready' ? 'ready' : 'draft', body.notes ?? null,
        JSON.stringify(Array.isArray(body.style_tags) ? body.style_tags : []), recipe,
        typeof body.technical_tokens === 'string' ? body.technical_tokens : '{}').run();
    const design = await c.env.DB.prepare('SELECT * FROM design_references WHERE id = ?').bind(result.meta.last_row_id).first<DesignReference>();
    return c.json({ design }, 201);
  } catch (err) {
    log('error', 'design-library', 'POST /design-references failed', err);
    return c.json(serverError(), 500);
  }
});

designLibraryRouter.post('/design-references/snapshot', async (c) => {
  try {
    const body = await c.req.json<{name?:string;source_url?:string;industry?:string}>();
    const name = body.name?.trim();
    let sourceUrl: string;
    try { const parsed = new URL(body.source_url?.trim() ?? ''); if (!['http:','https:'].includes(parsed.protocol)) throw new Error(); sourceUrl = parsed.href; }
    catch { return c.json(badRequest('A valid source URL is required'),400); }
    if (!name) return c.json(badRequest('A design name is required'),400);
    const inserted = await c.env.DB.prepare(`INSERT INTO design_references(name,description,source_url,industry,status,notes,style_tags,design_recipe,technical_tokens)
      VALUES(?,?,?,?, 'draft', ?, '[]', ?, '{}')`).bind(name,'Standalone website snapshot.',sourceUrl,body.industry?.trim()||null,
        'Screenshots and technical audit are queued. Generate the reusable recipe after capture.',
        'DRAFT DESIGN REFERENCE — capture and recipe generation pending.').run();
    const id = Number(inserted.meta.last_row_id);
    const queued = await c.env.DB.prepare('INSERT INTO design_capture_jobs(design_reference_id,source_url) VALUES(?,?)').bind(id,sourceUrl).run();
    const design = await c.env.DB.prepare('SELECT * FROM design_references WHERE id=?').bind(id).first<DesignReference>();
    return c.json({design,job:{id:queued.meta.last_row_id,status:'queued'}},202);
  } catch (err) { log('error','design-library','POST snapshot failed',err); return c.json(serverError(),500); }
});

designLibraryRouter.post('/design-references/from-lead/:leadId', async (c) => {
  try {
    const leadId = Number(c.req.param('leadId'));
    if (!Number.isInteger(leadId)) return c.json(badRequest('Invalid lead ID'), 400);
    const lead = await c.env.DB.prepare(`SELECT id,company,industry,site_url_raw,site_url,pipeline_brief,demo_site_status
      FROM leads WHERE id=? AND deleted_at IS NULL`).bind(leadId).first<{
        id:number;company:string;industry:string|null;site_url_raw:string|null;site_url:string|null;pipeline_brief:string|null;demo_site_status:string;
      }>();
    if (!lead) return c.json(notFound('Lead'), 404);
    if (lead.demo_site_status !== 'cleanup_needed') return c.json(badRequest('Only sites awaiting cleanup can be saved'), 400);
    const sourceUrl = lead.site_url_raw?.trim() || lead.site_url?.trim();
    if (!sourceUrl) return c.json(badRequest('This lead has no demo site URL'), 400);
    const existing = await c.env.DB.prepare(`SELECT d.*, (SELECT status FROM design_capture_jobs WHERE design_reference_id=d.id ORDER BY id DESC LIMIT 1) capture_status
      FROM design_references d WHERE d.source_lead_id=? AND d.status!='archived' ORDER BY d.id DESC LIMIT 1`).bind(leadId).first<DesignReference & {capture_status?:string}>();
    if (existing) {
      const active = await c.env.DB.prepare("SELECT id,status FROM design_capture_jobs WHERE design_reference_id=? AND status IN ('queued','capturing') ORDER BY id DESC LIMIT 1").bind(existing.id).first();
      if (active) return c.json({ design: existing, job: active });
      if (existing.capture_status === 'completed') return c.json({ design: existing, job: { status: 'completed' } });
      const retry = await c.env.DB.prepare('INSERT INTO design_capture_jobs(design_reference_id,source_url) VALUES(?,?)').bind(existing.id,sourceUrl).run();
      return c.json({ design: existing, job: { id: retry.meta.last_row_id, status: 'queued' } }, 202);
    }
    const sourceBrief = lead.pipeline_brief?.trim() || 'No generated pipeline brief was available for this site.';
    const recipe = `DRAFT DESIGN REFERENCE — REVIEW BEFORE MARKING READY\n\nThis entry was preserved from a declined demo. Use the source brief below only to understand the original page structure and visual intent. Never reuse the source company name, contact details, claims, reviews, photographs, or wording in another company website.\n\nSOURCE PIPELINE BRIEF\n${sourceBrief}`;
    const inserted = await c.env.DB.prepare(`INSERT INTO design_references
      (name,description,source_lead_id,source_url,industry,status,notes,style_tags,design_recipe,technical_tokens,source_brief_snapshot)
      VALUES(?,?,?,?,?,'draft',?,?,?,?,?)`).bind(
        `${lead.company} Design`, `Saved from the declined ${lead.company} demo before LandingSite cleanup.`, lead.id, sourceUrl,
        lead.industry, 'Screenshots and technical audit are being captured. Review the reusable recipe before marking Ready.',
        JSON.stringify([lead.industry, 'declined demo'].filter(Boolean)), recipe, '{}', sourceBrief,
      ).run();
    const designId = Number(inserted.meta.last_row_id);
    const queued = await c.env.DB.prepare('INSERT INTO design_capture_jobs(design_reference_id,source_url) VALUES(?,?)').bind(designId,sourceUrl).run();
    const design = await c.env.DB.prepare('SELECT * FROM design_references WHERE id=?').bind(designId).first<DesignReference>();
    return c.json({ design, job: { id: queued.meta.last_row_id, status: 'queued' } }, 202);
  } catch (err) {
    log('error', 'design-library', 'POST /design-references/from-lead failed', err);
    return c.json(serverError(), 500);
  }
});

designLibraryRouter.put('/design-references/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json(badRequest('Invalid design reference ID'), 400);
    const existing = await c.env.DB.prepare('SELECT * FROM design_references WHERE id = ?').bind(id).first<DesignReference>();
    if (!existing) return c.json(notFound('Design reference'), 404);
    const body = await c.req.json<Partial<DesignReference> & { style_tags?: string[] | string }>();
    const status = ['draft', 'ready', 'archived'].includes(body.status ?? '') ? body.status : existing.status;
    const tags = Array.isArray(body.style_tags) ? JSON.stringify(body.style_tags) : body.style_tags ?? existing.style_tags;
    await c.env.DB.prepare(`UPDATE design_references SET name=?, description=?, source_url=?, industry=?, status=?, notes=?, style_tags=?, design_recipe=?, technical_tokens=?, updated_at=datetime('now') WHERE id=?`)
      .bind(body.name?.trim() || existing.name, body.description ?? existing.description, body.source_url ?? existing.source_url,
        body.industry ?? existing.industry, status, body.notes ?? existing.notes, tags,
        body.design_recipe ?? existing.design_recipe, body.technical_tokens ?? existing.technical_tokens, id).run();
    const design = await c.env.DB.prepare('SELECT * FROM design_references WHERE id = ?').bind(id).first<DesignReference>();
    return c.json({ design });
  } catch (err) {
    log('error', 'design-library', 'PUT /design-references failed', err);
    return c.json(serverError(), 500);
  }
});

designLibraryRouter.post('/design-references/:id/capture', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json(badRequest('Invalid design reference ID'), 400);
  const design = await c.env.DB.prepare('SELECT id, source_url FROM design_references WHERE id=?').bind(id).first<{id:number;source_url:string|null}>();
  if (!design) return c.json(notFound('Design reference'), 404);
  let sourceUrl: string;
  try {
    const parsed = new URL(design.source_url ?? '');
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    sourceUrl = parsed.href;
  } catch { return c.json(badRequest('A valid source URL is required before capture'), 400); }
  const active = await c.env.DB.prepare("SELECT id,status FROM design_capture_jobs WHERE design_reference_id=? AND status IN ('queued','capturing') ORDER BY id DESC LIMIT 1").bind(id).first();
  if (active) return c.json({ job: active });
  const result = await c.env.DB.prepare('INSERT INTO design_capture_jobs(design_reference_id,source_url) VALUES(?,?)').bind(id,sourceUrl).run();
  return c.json({ job: { id: result.meta.last_row_id, status: 'queued' } }, 202);
});

designLibraryRouter.get('/design-references/:id/captures', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json(badRequest('Invalid design reference ID'), 400);
  const job = await c.env.DB.prepare('SELECT id,status,error,created_at,completed_at FROM design_capture_jobs WHERE design_reference_id=? ORDER BY id DESC LIMIT 1').bind(id).first();
  const assets = await c.env.DB.prepare(`SELECT a.id,a.design_reference_id,a.kind,a.viewport_width,a.viewport_height,a.created_at
    FROM design_reference_assets a JOIN design_capture_jobs j ON j.id=a.capture_job_id
    WHERE a.design_reference_id=? AND j.status='completed' AND j.id=(SELECT MAX(id) FROM design_capture_jobs WHERE design_reference_id=? AND status='completed') ORDER BY a.kind`).bind(id,id).all<DesignAsset>();
  const history = await c.env.DB.prepare('SELECT id,status,error,created_at,completed_at FROM design_capture_jobs WHERE design_reference_id=? ORDER BY id DESC LIMIT 20').bind(id).all();
  return c.json({ job, assets: assets.results, history: history.results });
});

export async function generateDesignRecipe(env: Env, id: number): Promise<DesignReference> {
  const design = await env.DB.prepare('SELECT * FROM design_references WHERE id=?').bind(id).first<DesignReference>();
  if (!design) throw new Error('Design reference not found');
  if (design.status === 'ready') throw new Error('Move this Ready design back to Draft before regenerating its approved recipe');
  const analysisJob = await env.DB.prepare(`SELECT desktop_analysis_key,mobile_analysis_key FROM design_capture_jobs
    WHERE design_reference_id=? AND status='completed' ORDER BY id DESC LIMIT 1`).bind(id).first<{desktop_analysis_key:string|null;mobile_analysis_key:string|null}>();
  const rows = { results: [
    analysisJob?.desktop_analysis_key ? {kind:'desktop_analysis',storage_key:analysisJob.desktop_analysis_key} : null,
    analysisJob?.mobile_analysis_key ? {kind:'mobile_analysis',storage_key:analysisJob.mobile_analysis_key} : null,
  ].filter((row): row is {kind:string;storage_key:string} => row !== null) };
  if (rows.results.length !== 2) throw new Error('A completed desktop and mobile capture is required');
  try {
    const images: Array<{mediaType:'image/png';base64:string}> = [];
    let totalBytes = 0;
    for (const row of rows.results) {
      const object = await env.DESIGN_ASSETS.get(row.storage_key);
      if (!object) throw new Error(`Missing ${row.kind} screenshot`);
      const buffer = await object.arrayBuffer(); totalBytes += buffer.byteLength;
      if (totalBytes > 18 * 1024 * 1024) throw new Error('Captured screenshots are too large for recipe analysis');
      images.push({mediaType:'image/png',base64:arrayBufferToBase64(buffer)});
    }
    const generated = await callClaudeVisionJson<{
      name?:string;description:string;style_tags:string[];design_recipe:string;technical_tokens:Record<string,unknown>;
    }>(env.CLAUDE_API_KEY, `Create a reusable, company-neutral website design system from these desktop and mobile screenshots.

SOURCE INDUSTRY: ${design.industry ?? 'unspecified'}
SOURCE BRIEF (facts are reference-only and MUST NOT appear in output):
${design.source_brief_snapshot ?? 'No source brief supplied.'}

BROWSER TECHNICAL AUDIT:
${design.technical_tokens}

Return JSON only with: description, style_tags (array), design_recipe (detailed human instructions), technical_tokens (normalized JSON object). The recipe must cover visual character, exact color/type tokens, container widths, borders, gradients/overlays, section sequence, image treatment, icons, responsive behavior, and UI states. Never include or imply the source company name, location, phone, email, reviews, claims, copy, or image identities. Separate invariant visual rules from content that a new business supplies. Use measured audit values when reliable and explicitly state max-width behavior.`, images, {
      model:'claude-sonnet-4-6', maxTokens:7000, timeoutMs:120_000,
      systemPrompt:'You are a senior design systems engineer. Convert visual references into precise, reusable implementation briefs. Return strict JSON and remove all source-business identity.',
    });
    if (!generated.design_recipe?.trim() || !generated.technical_tokens) throw new Error('Generated recipe was incomplete');
    await env.DB.prepare(`UPDATE design_references SET description=?,style_tags=?,design_recipe=?,technical_tokens=?,recipe_generated_at=datetime('now'),recipe_generation_error=NULL,notes='Draft recipe generated automatically from desktop/mobile snapshots and browser audit. Review and test before approval.',updated_at=datetime('now') WHERE id=?`)
      .bind(generated.description?.trim()||design.description,JSON.stringify(generated.style_tags??[]),generated.design_recipe.trim(),JSON.stringify(generated.technical_tokens),id).run();
    return (await env.DB.prepare('SELECT * FROM design_references WHERE id=?').bind(id).first<DesignReference>())!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare('UPDATE design_references SET recipe_generation_error=?,updated_at=datetime(\'now\') WHERE id=?').bind(message.slice(0,1000),id).run();
    log('error','design-library','Recipe generation failed',err); throw err;
  }
}

designLibraryRouter.post('/design-references/:id/generate-recipe', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json(badRequest('Invalid design reference ID'),400);
  try { return c.json({design:await generateDesignRecipe(c.env,id)}); }
  catch (err) { return c.json(serverError(err instanceof Error ? err.message : 'Recipe generation failed'),500); }
});

designLibraryRouter.post('/design-references/:id/approve', async (c) => {
  const id = Number(c.req.param('id'));
  const design = await c.env.DB.prepare('SELECT recipe_generated_at FROM design_references WHERE id=?').bind(id).first<{recipe_generated_at:string|null}>();
  if (!design) return c.json(notFound('Design reference'),404);
  const capture = await c.env.DB.prepare("SELECT status FROM design_capture_jobs WHERE design_reference_id=? ORDER BY id DESC LIMIT 1").bind(id).first<{status:string}>();
  if (capture?.status !== 'completed' || !design.recipe_generated_at) return c.json(badRequest('Complete capture and recipe generation before approval'),400);
  await c.env.DB.prepare("UPDATE design_references SET status='ready',updated_at=datetime('now') WHERE id=?").bind(id).run();
  return c.json({design:await c.env.DB.prepare('SELECT * FROM design_references WHERE id=?').bind(id).first<DesignReference>()});
});

designLibraryRouter.delete('/design-references/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const design = await c.env.DB.prepare('SELECT status FROM design_references WHERE id=?').bind(id).first<{status:string}>();
  if (!design) return c.json(notFound('Design reference'),404);
  if (design.status === 'ready') return c.json(badRequest('Archive a ready design before deleting it'),400);
  const assets = await c.env.DB.prepare('SELECT storage_key FROM design_reference_assets WHERE design_reference_id=?').bind(id).all<{storage_key:string}>();
  const analysisAssets = await c.env.DB.prepare('SELECT desktop_analysis_key,mobile_analysis_key FROM design_capture_jobs WHERE design_reference_id=?').bind(id).all<{desktop_analysis_key:string|null;mobile_analysis_key:string|null}>();
  const keys = [...assets.results.map((asset) => asset.storage_key), ...analysisAssets.results.flatMap((job) => [job.desktop_analysis_key,job.mobile_analysis_key].filter((key): key is string => !!key))];
  await Promise.all(keys.map((key) => c.env.DESIGN_ASSETS.delete(key)));
  await c.env.DB.prepare('DELETE FROM design_references WHERE id=?').bind(id).run();
  return c.body(null,204);
});

designLibraryRouter.get('/design-assets/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const asset = await c.env.DB.prepare('SELECT storage_key FROM design_reference_assets WHERE id=?').bind(id).first<{storage_key:string}>();
  if (!asset) return c.json(notFound('Design asset'), 404);
  const object = await c.env.DESIGN_ASSETS.get(asset.storage_key);
  if (!object) return c.json(notFound('Design asset file'), 404);
  return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType ?? 'image/png', 'Cache-Control': 'private, max-age=300' } });
});
