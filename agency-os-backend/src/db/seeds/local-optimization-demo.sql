-- Local-only, idempotent fixture for previewing a fully built site in Optimization.

INSERT INTO projects (
  name, slug, tier, business_name, industry, city, state, phone, email,
  services, service_areas, monthly_pages_target, landingsite_url, custom_domain,
  gsc_property_url, client_email, pages_planned, contract_start, contract_min_end,
  merchynt_active, status, is_internal, dns_status, domain
)
SELECT
  'Optimization Demo Plumbing', 'optimization-demo-plumbing-green-bay-wi', 3,
  'Optimization Demo Plumbing', 'Plumbing', 'Green Bay', 'WI', '9205550199', 'demo@example.com',
  '["Water Heater Repair","Drain Cleaning","Sump Pump Installation"]',
  '["Green Bay","De Pere","Ashwaubenon"]', 3,
  'https://optimization-demo.example.com', 'https://optimization-demo.example.com',
  'sc-domain:optimization-demo.example.com', 'demo@example.com', 19,
  '2026-01-01T12:00:00.000Z', '2026-07-01T12:00:00.000Z', 1, 'live', 1, 'active',
  'optimization-demo.example.com'
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE slug='optimization-demo-plumbing-green-bay-wi');

INSERT INTO briefs (project_id,kind,content_markdown,status,version,tbd_count,generated_by_model,generation_input,generated_at,updated_at)
SELECT id,'master','# Optimization Demo Plumbing\n\nLocal seeded master brief for a fully built site in the optimization phase.','saved',1,0,'local-seed','{"source":"optimization-demo"}','2026-01-01 12:00:00','2026-01-01 12:00:00'
FROM projects p WHERE p.slug='optimization-demo-plumbing-green-bay-wi'
AND NOT EXISTS (SELECT 1 FROM briefs b WHERE b.project_id=p.id AND b.kind='master' AND b.status!='archived');

WITH seed(type,service,city,slug,title) AS (VALUES
  ('homepage',NULL,NULL,'/','Plumber in Green Bay WI'),
  ('about',NULL,NULL,'/about','About Optimization Demo Plumbing'),
  ('services_overview',NULL,NULL,'/services','Plumbing Services'),
  ('service_areas_overview',NULL,NULL,'/service-areas','Plumbing Service Areas'),
  ('contact',NULL,NULL,'/contact','Contact Our Plumbers'),
  ('faq',NULL,NULL,'/faq','Plumbing Questions'),
  ('service','Water Heater Repair',NULL,'/services/water-heater-repair','Water Heater Repair'),
  ('service','Drain Cleaning',NULL,'/services/drain-cleaning','Drain Cleaning'),
  ('service','Sump Pump Installation',NULL,'/services/sump-pump-installation','Sump Pump Installation')
)
INSERT INTO pages (project_id,type,service,city,slug,url,title,status,billing_status,published_url,built_at,marked_complete_at,operator_notes)
SELECT p.id,s.type,s.service,s.city,s.slug,s.slug,s.title,'complete','included','https://optimization-demo.example.com'||CASE WHEN s.slug='/' THEN '' ELSE s.slug END,'2026-01-15 12:00:00','2026-01-15 12:00:00','Local optimization demo seed.'
FROM projects p CROSS JOIN seed s WHERE p.slug='optimization-demo-plumbing-green-bay-wi'
AND NOT EXISTS (SELECT 1 FROM pages pg WHERE pg.project_id=p.id AND pg.type=s.type AND COALESCE(pg.service,'')=COALESCE(s.service,'') AND COALESCE(pg.city,'')='');

INSERT INTO pages (project_id,type,service,city,slug,url,title,status,billing_status,published_url,built_at,marked_complete_at,operator_notes)
SELECT p.id,'service-area',svc.value,area.value,
  '/service-areas/'||lower(replace(svc.value,' ','-'))||'-'||lower(replace(area.value,' ','-'))||'-wi',
  '/service-areas/'||lower(replace(svc.value,' ','-'))||'-'||lower(replace(area.value,' ','-'))||'-wi',
  svc.value||' in '||area.value,'complete','included',
  'https://optimization-demo.example.com/service-areas/'||lower(replace(svc.value,' ','-'))||'-'||lower(replace(area.value,' ','-'))||'-wi',
  '2026-03-15 12:00:00','2026-03-15 12:00:00','Local optimization demo seed.'
FROM projects p, json_each(p.services) svc, json_each(p.service_areas) area
WHERE p.slug='optimization-demo-plumbing-green-bay-wi'
AND NOT EXISTS (SELECT 1 FROM pages pg WHERE pg.project_id=p.id AND pg.type='service-area' AND pg.service=svc.value AND pg.city=area.value);

INSERT INTO briefs (project_id,kind,page_id,content_markdown,status,version,tbd_count,generated_by_model,generation_input,generated_at,updated_at,completed_at)
SELECT pg.project_id,'page',pg.id,'# '||pg.title||'\n\nSeeded completed page brief for the local optimization preview.','complete',1,0,'local-seed','{"source":"optimization-demo"}',pg.built_at,pg.built_at,pg.marked_complete_at
FROM pages pg JOIN projects p ON p.id=pg.project_id
WHERE p.slug='optimization-demo-plumbing-green-bay-wi'
AND NOT EXISTS (SELECT 1 FROM briefs b WHERE b.page_id=pg.id AND b.kind='page');

UPDATE pages SET brief_id=(SELECT b.id FROM briefs b WHERE b.page_id=pages.id AND b.kind='page' ORDER BY b.id DESC LIMIT 1)
WHERE project_id=(SELECT id FROM projects WHERE slug='optimization-demo-plumbing-green-bay-wi') AND brief_id IS NULL;

UPDATE projects SET pages_built=(SELECT COUNT(*) FROM pages WHERE project_id=projects.id AND status='complete')
WHERE slug='optimization-demo-plumbing-green-bay-wi';

INSERT OR IGNORE INTO seo_snapshots (project_id,period,impressions,clicks,avg_position,ctr,pagespeed_desktop,pagespeed_mobile,visitors,pageviews,top_keywords,top_pages,exec_summary)
SELECT id,'2026-07',10420,371,9.8,0.0356,94,82,612,1040,
  '[{"query":"water heater repair green bay","position":8.2,"impressions":2100,"clicks":94},{"query":"drain cleaning de pere","position":11.6,"impressions":1720,"clicks":43},{"query":"sump pump installation ashwaubenon","position":15.3,"impressions":940,"clicks":18}]',
  '[{"page":"/services/water-heater-repair","impressions":2900,"clicks":126,"position":8.2},{"page":"/service-areas/drain-cleaning-de-pere-wi","impressions":1720,"clicks":43,"position":11.6},{"page":"/service-areas/sump-pump-installation-ashwaubenon-wi","impressions":940,"clicks":18,"position":15.3}]',
  'Established footprint with several pages close to stronger first-page visibility.'
FROM projects WHERE slug='optimization-demo-plumbing-green-bay-wi';

INSERT OR IGNORE INTO seo_snapshots (project_id,period,impressions,clicks,avg_position,ctr,pagespeed_desktop,pagespeed_mobile,visitors,pageviews,top_keywords,top_pages,exec_summary)
SELECT id,'2026-08',12880,462,8.9,0.0359,95,84,748,1286,
  '[{"query":"water heater repair green bay","position":6.9,"impressions":2580,"clicks":132},{"query":"drain cleaning de pere","position":10.8,"impressions":2140,"clicks":61},{"query":"sump pump installation ashwaubenon","position":13.7,"impressions":1210,"clicks":24}]',
  '[{"page":"/services/water-heater-repair","impressions":3440,"clicks":164,"position":6.9},{"page":"/service-areas/drain-cleaning-de-pere-wi","impressions":2140,"clicks":61,"position":10.8},{"page":"/service-areas/sump-pump-installation-ashwaubenon-wi","impressions":1210,"clicks":24,"position":13.7}]',
  'Visibility is growing; the best next work is improving pages already within striking distance.'
FROM projects WHERE slug='optimization-demo-plumbing-green-bay-wi';

INSERT OR IGNORE INTO growth_cycles (project_id,period,phase,status,due_date,generated_at,generated_by)
SELECT id,'2026-08','optimization','active','2026-08-31','2026-08-01 08:00:00','local-seed'
FROM projects WHERE slug='optimization-demo-plumbing-green-bay-wi';

WITH s(category,title,description,page_type,service,city) AS (VALUES
  ('improved','Improve Drain Cleaning in De Pere','This page has 2,140 impressions and an average position near 10.8. Strengthen service proof, internal links, and title alignment.','service-area','Drain Cleaning','De Pere'),
  ('conversion','Improve the Water Heater Repair call to action','The page attracts the most organic clicks. Tighten the primary CTA and add financing and response-time proof.','service','Water Heater Repair',NULL),
  ('proof','Add recent sump-pump project proof','Add a completed-project photo, customer quote, and installation details to support the page ranking near position 13.7.','service-area','Sump Pump Installation','Ashwaubenon')
)
INSERT INTO growth_work_items (cycle_id,category,title,description,status,page_id,evidence_url)
SELECT gc.id,s.category,s.title,s.description,'planned',pg.id,pg.published_url
FROM growth_cycles gc JOIN projects p ON p.id=gc.project_id
CROSS JOIN s
JOIN pages pg ON pg.project_id=p.id AND pg.type=s.page_type AND pg.service=s.service AND COALESCE(pg.city,'')=COALESCE(s.city,'')
WHERE p.slug='optimization-demo-plumbing-green-bay-wi' AND gc.period='2026-08'
AND NOT EXISTS (SELECT 1 FROM growth_work_items wi WHERE wi.cycle_id=gc.id AND wi.title=s.title);
