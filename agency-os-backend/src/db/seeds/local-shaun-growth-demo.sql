-- Local-only visual fixture for the internal Shaun Carl Designs workspace.
-- Idempotent: existing real rows are preserved and seed rows are inserted only when missing.

UPDATE projects
SET services = '["Web Design","Local SEO","Conversion Optimization"]',
    service_areas = '["Green Bay","De Pere","Appleton","Ashwaubenon"]',
    landingsite_url = 'https://shauncarldesigns.com',
    custom_domain = 'https://shauncarldesigns.com',
    monthly_pages_target = 3,
    pages_planned = 21,
    updated_at = datetime('now')
WHERE business_name = 'Shaun Carl Designs' AND is_internal = 1;

INSERT INTO briefs (project_id, kind, content_markdown, status, version, tbd_count, generated_by_model, generation_input, generated_at, updated_at)
SELECT id, 'master',
  '# Shaun Carl Designs — Demo Master Brief\n\nLocal-only seeded brief used to preview the completed Brief Studio experience without consuming model credits.\n\n## Positioning\nPractical web design, local SEO, and conversion improvement for service businesses in Northeast Wisconsin.',
  'saved', 1, 0, 'local-seed', '{"source":"local-demo-seed"}', datetime('now', '-45 days'), datetime('now', '-45 days')
FROM projects p
WHERE p.business_name = 'Shaun Carl Designs' AND p.is_internal = 1
  AND NOT EXISTS (SELECT 1 FROM briefs b WHERE b.project_id = p.id AND b.kind = 'master' AND b.supersedes_brief_id IS NULL);

WITH seed(type, service, slug, title) AS (VALUES
  ('homepage', NULL, '/', 'Web Design and Local SEO in Green Bay'),
  ('about', NULL, '/about', 'About Shaun Carl Designs'),
  ('services_overview', NULL, '/services', 'Web Design and SEO Services'),
  ('service_areas_overview', NULL, '/service-areas', 'Northeast Wisconsin Service Areas'),
  ('contact', NULL, '/contact', 'Start Your Website Project'),
  ('faq', NULL, '/faq', 'Website and SEO Questions'),
  ('service', 'Web Design', '/services/web-design', 'Web Design Services'),
  ('service', 'Local SEO', '/services/local-seo', 'Local SEO Services'),
  ('service', 'Conversion Optimization', '/services/conversion-optimization', 'Conversion Optimization Services')
)
INSERT INTO pages (project_id, type, service, city, slug, url, title, status, billing_status, published_url, built_at, marked_complete_at, operator_notes)
SELECT p.id, seed.type, seed.service, NULL, seed.slug, seed.slug, seed.title, 'complete', 'included',
  'https://shauncarldesigns.com' || CASE WHEN seed.slug = '/' THEN '' ELSE seed.slug END,
  datetime('now', '-30 days'), datetime('now', '-30 days'), 'Local visual seed — no model credits used.'
FROM projects p CROSS JOIN seed
WHERE p.business_name = 'Shaun Carl Designs' AND p.is_internal = 1
  AND NOT EXISTS (
    SELECT 1 FROM pages existing
    WHERE existing.project_id = p.id AND existing.type = seed.type
      AND COALESCE(existing.service, '') = COALESCE(seed.service, '')
      AND COALESCE(existing.city, '') = ''
  );

INSERT INTO briefs (project_id, kind, page_id, content_markdown, status, version, tbd_count, generated_by_model, generation_input, generated_at, updated_at, completed_at)
SELECT pg.project_id, 'page', pg.id,
  '# ' || COALESCE(pg.title, pg.service, pg.type) || '\n\nLocal-only seeded page brief representing a completed production page. No AI request was made.',
  'complete', 1, 0, 'local-seed', '{"source":"local-demo-seed"}', pg.built_at, pg.built_at, pg.marked_complete_at
FROM pages pg
JOIN projects p ON p.id = pg.project_id
WHERE p.business_name = 'Shaun Carl Designs' AND p.is_internal = 1 AND pg.status = 'complete'
  AND NOT EXISTS (SELECT 1 FROM briefs b WHERE b.page_id = pg.id AND b.kind = 'page');

UPDATE pages
SET brief_id = (SELECT b.id FROM briefs b WHERE b.page_id = pages.id AND b.kind = 'page' ORDER BY b.id DESC LIMIT 1)
WHERE project_id = (SELECT id FROM projects WHERE business_name = 'Shaun Carl Designs' AND is_internal = 1 LIMIT 1)
  AND brief_id IS NULL;

UPDATE projects
SET pages_built = (SELECT COUNT(*) FROM pages WHERE project_id = projects.id AND status = 'complete')
WHERE business_name = 'Shaun Carl Designs' AND is_internal = 1;

INSERT OR IGNORE INTO seo_snapshots (project_id, period, impressions, clicks, avg_position, ctr, pagespeed_desktop, pagespeed_mobile, visitors, pageviews, top_keywords, top_pages, exec_summary)
SELECT id, '2026-08', 2840, 126, 12.8, 0.044, 96, 88, 214, 386,
  '[{"query":"web design green bay","position":7.4,"impressions":840,"clicks":52},{"query":"local seo green bay","position":14.2,"impressions":610,"clicks":21},{"query":"web designer de pere","position":18.6,"impressions":330,"clicks":8}]',
  '[{"page":"/","impressions":1280,"clicks":71},{"page":"/services/web-design","impressions":760,"clicks":34},{"page":"/services/local-seo","impressions":510,"clicks":17}]',
  'Local demonstration snapshot showing an established foundation and clear geographic expansion opportunities.'
FROM projects WHERE business_name = 'Shaun Carl Designs' AND is_internal = 1;

INSERT OR IGNORE INTO growth_cycles (project_id, period, phase, status, due_date, generated_at, generated_by)
SELECT id, '2026-08', 'expansion', 'active', '2026-08-31', datetime('now'), 'local-seed'
FROM projects WHERE business_name = 'Shaun Carl Designs' AND is_internal = 1;

WITH seed(title, service, city, description) AS (VALUES
  ('Create Web Design in Green Bay', 'Web Design', 'Green Bay', 'Core service and home market; establish the strongest local landing-page foundation first.'),
  ('Create Local SEO in De Pere', 'Local SEO', 'De Pere', 'Existing local SEO visibility indicates an adjacent-market page is a reasonable expansion opportunity.'),
  ('Create Web Design in Appleton', 'Web Design', 'Appleton', 'Adds a distinct nearby market for the primary service without duplicating an existing page.')
)
INSERT INTO growth_work_items (cycle_id, category, title, description, status, recommended_page_type, recommended_service, recommended_city)
SELECT gc.id, 'created', seed.title, seed.description, 'planned', 'service-area', seed.service, seed.city
FROM growth_cycles gc
JOIN projects p ON p.id = gc.project_id
CROSS JOIN seed
WHERE p.business_name = 'Shaun Carl Designs' AND p.is_internal = 1 AND gc.period = '2026-08'
  AND NOT EXISTS (SELECT 1 FROM growth_work_items existing WHERE existing.cycle_id = gc.id AND existing.recommended_page_type = 'service-area' AND existing.recommended_service = seed.service AND existing.recommended_city = seed.city);
