-- Local-only demo data for the Research page, so the UI is viewable before
-- the Google Ads developer token is approved for Basic Access (real runs
-- currently fail with DEVELOPER_TOKEN_NOT_APPROVED, so no market has ever
-- rendered with data). Do NOT apply to prod (--remote).
--
-- EVERY NUMBER IN THIS FILE IS FICTIONAL — for UI preview only, never for
-- market decisions.
--
-- Demo markets are tagged with sentinel geo_target_ids 999000x (real Google
-- Ads city criteria IDs never look like this), so the file is safe to rerun:
-- the cleanup block below wipes exactly these markets and their children.
--
-- Rows are built with json_each() rather than UNION ALL chains because remote
-- D1 enforces a low compound-SELECT term limit. No BEGIN/COMMIT: remote D1
-- rejects explicit transactions; wrangler applies the file as one batch.
--
-- Apply:   npx wrangler d1 execute agency-os-v2 --local --file=src/db/seeds/market-research-demo.sql
-- Remove:  run just the DELETE block, or delete each market from the UI.

-- ---------------------------------------------------------------- cleanup --
DELETE FROM market_keywords  WHERE market_id IN (SELECT id FROM markets WHERE geo_target_id LIKE '999000%');
DELETE FROM map_pack_results WHERE market_id IN (SELECT id FROM markets WHERE geo_target_id LIKE '999000%');
DELETE FROM research_runs    WHERE market_id IN (SELECT id FROM markets WHERE geo_target_id LIKE '999000%');
DELETE FROM markets          WHERE geo_target_id LIKE '999000%';

-- ---------------------------------------------------------------- markets --
-- 1. Electrical × Appleton — the showcase: fully researched, complete runs.
-- 2. Roofing × Oshkosh — partial run (one map pack scrape timed out).
-- 3. Landscaping × De Pere — researched but paused (is_active = 0).
INSERT INTO markets (industry, location_label, geo_target_id, latitude, longitude, is_active, last_researched_at)
VALUES
  ('Electrical',  'Appleton, WI', '9990001', 44.2619, -88.4154, 1, '2026-08-06 15:42:00'),
  ('Roofing',     'Oshkosh, WI',  '9990002', 44.0247, -88.5426, 1, '2026-08-05 11:20:00'),
  ('Landscaping', 'De Pere, WI',  '9990003', 44.4489, -88.0604, 0, '2026-07-28 10:15:00');

-- ------------------------------------------------------------------- runs --
-- Electrical gets an older scheduled run + the latest manual run so the run
-- history panel shows more than one row. started_at values are unique across
-- this file — child inserts key on them to find their run_id.
INSERT INTO research_runs (market_id, "trigger", provider, status, keywords_count, error_detail, started_at, completed_at)
VALUES ((SELECT id FROM markets WHERE geo_target_id = '9990001'), 'scheduled', 'google_ads', 'complete', 7, NULL, '2026-08-01 09:03:00', '2026-08-01 09:04:41');
INSERT INTO research_runs (market_id, "trigger", provider, status, keywords_count, error_detail, started_at, completed_at)
VALUES ((SELECT id FROM markets WHERE geo_target_id = '9990001'), 'manual', 'google_ads', 'complete', 7, NULL, '2026-08-06 15:42:00', '2026-08-06 15:43:52');
INSERT INTO research_runs (market_id, "trigger", provider, status, keywords_count, error_detail, started_at, completed_at)
VALUES ((SELECT id FROM markets WHERE geo_target_id = '9990002'), 'manual', 'google_ads', 'partial', 7, '"roofer oshkosh": Outscraper task timed out after 120s', '2026-08-05 11:20:00', '2026-08-05 11:23:10');
INSERT INTO research_runs (market_id, "trigger", provider, status, keywords_count, error_detail, started_at, completed_at)
VALUES ((SELECT id FROM markets WHERE geo_target_id = '9990003'), 'manual', 'google_ads', 'complete', 7, NULL, '2026-07-28 10:15:00', '2026-07-28 10:16:35');

-- --------------------------------------------------- Electrical × Appleton --
-- Keywords follow the default seed-template expansion for 'electrician'.
INSERT INTO market_keywords (market_id, run_id, keyword, monthly_volume, competition, competition_index, cpc_low, cpc_high, trend_json, is_near_me, fetched_at)
SELECT
  (SELECT id FROM markets WHERE geo_target_id = '9990001'),
  (SELECT id FROM research_runs WHERE started_at = '2026-08-06 15:42:00'),
  json_extract(j.value, '$.k'), json_extract(j.value, '$.v'),
  json_extract(j.value, '$.c'), json_extract(j.value, '$.ci'),
  json_extract(j.value, '$.lo'), json_extract(j.value, '$.hi'),
  json_extract(j.value, '$.t'), json_extract(j.value, '$.nm'),
  '2026-08-06 15:42:31'
FROM json_each('[
 {"k":"electrician near me","v":1900,"c":"HIGH","ci":78,"lo":9.84,"hi":31.50,"nm":1,
  "t":[{"year":2025,"month":9,"volume":1300},{"year":2025,"month":10,"volume":1300},{"year":2025,"month":11,"volume":1600},{"year":2025,"month":12,"volume":1600},{"year":2026,"month":1,"volume":1900},{"year":2026,"month":2,"volume":2400},{"year":2026,"month":3,"volume":2400},{"year":2026,"month":4,"volume":1900},{"year":2026,"month":5,"volume":1900},{"year":2026,"month":6,"volume":1600},{"year":2026,"month":7,"volume":1600},{"year":2026,"month":8,"volume":1900}]},
 {"k":"electrician appleton","v":720,"c":"MEDIUM","ci":52,"lo":7.10,"hi":22.40,"nm":0,
  "t":[{"year":2025,"month":9,"volume":590},{"year":2025,"month":10,"volume":590},{"year":2025,"month":11,"volume":720},{"year":2025,"month":12,"volume":720},{"year":2026,"month":1,"volume":880},{"year":2026,"month":2,"volume":880},{"year":2026,"month":3,"volume":880},{"year":2026,"month":4,"volume":720},{"year":2026,"month":5,"volume":720},{"year":2026,"month":6,"volume":590},{"year":2026,"month":7,"volume":590},{"year":2026,"month":8,"volume":720}]},
 {"k":"24 hour electrician","v":320,"c":"HIGH","ci":74,"lo":12.60,"hi":38.90,"nm":0,
  "t":[{"year":2025,"month":9,"volume":260},{"year":2025,"month":10,"volume":260},{"year":2025,"month":11,"volume":320},{"year":2025,"month":12,"volume":390},{"year":2026,"month":1,"volume":390},{"year":2026,"month":2,"volume":320},{"year":2026,"month":3,"volume":320},{"year":2026,"month":4,"volume":260},{"year":2026,"month":5,"volume":260},{"year":2026,"month":6,"volume":320},{"year":2026,"month":7,"volume":320},{"year":2026,"month":8,"volume":320}]},
 {"k":"emergency electrician appleton","v":210,"c":"HIGH","ci":81,"lo":14.20,"hi":44.75,"nm":0,
  "t":[{"year":2025,"month":9,"volume":170},{"year":2025,"month":10,"volume":170},{"year":2025,"month":11,"volume":210},{"year":2025,"month":12,"volume":260},{"year":2026,"month":1,"volume":260},{"year":2026,"month":2,"volume":210},{"year":2026,"month":3,"volume":210},{"year":2026,"month":4,"volume":170},{"year":2026,"month":5,"volume":170},{"year":2026,"month":6,"volume":210},{"year":2026,"month":7,"volume":210},{"year":2026,"month":8,"volume":260}]},
 {"k":"best electrician appleton","v":170,"c":"MEDIUM","ci":55,"lo":6.40,"hi":19.80,"nm":0,
  "t":[{"year":2025,"month":9,"volume":140},{"year":2025,"month":10,"volume":140},{"year":2025,"month":11,"volume":170},{"year":2025,"month":12,"volume":170},{"year":2026,"month":1,"volume":210},{"year":2026,"month":2,"volume":210},{"year":2026,"month":3,"volume":170},{"year":2026,"month":4,"volume":170},{"year":2026,"month":5,"volume":140},{"year":2026,"month":6,"volume":140},{"year":2026,"month":7,"volume":170},{"year":2026,"month":8,"volume":170}]},
 {"k":"electrician company appleton","v":90,"c":"MEDIUM","ci":44,"lo":5.20,"hi":16.30,"nm":0,
  "t":[{"year":2025,"month":9,"volume":70},{"year":2025,"month":10,"volume":70},{"year":2025,"month":11,"volume":90},{"year":2025,"month":12,"volume":90},{"year":2026,"month":1,"volume":110},{"year":2026,"month":2,"volume":90},{"year":2026,"month":3,"volume":90},{"year":2026,"month":4,"volume":70},{"year":2026,"month":5,"volume":70},{"year":2026,"month":6,"volume":90},{"year":2026,"month":7,"volume":90},{"year":2026,"month":8,"volume":110}]},
 {"k":"electrician repair appleton","v":50,"c":"LOW","ci":28,"lo":4.10,"hi":12.90,"nm":0,
  "t":[{"year":2025,"month":9,"volume":40},{"year":2025,"month":10,"volume":40},{"year":2025,"month":11,"volume":50},{"year":2025,"month":12,"volume":50},{"year":2026,"month":1,"volume":70},{"year":2026,"month":2,"volume":70},{"year":2026,"month":3,"volume":50},{"year":2026,"month":4,"volume":50},{"year":2026,"month":5,"volume":40},{"year":2026,"month":6,"volume":40},{"year":2026,"month":7,"volume":50},{"year":2026,"month":8,"volume":50}]}
]') j;

-- Older capture (first run) for one keyword — proves append-only history; the
-- UI shows only the latest run per keyword.
INSERT INTO map_pack_results (market_id, run_id, keyword, position, place_id, company, has_website, website, google_rating, review_count, captured_at)
SELECT
  (SELECT id FROM markets WHERE geo_target_id = '9990001'),
  (SELECT id FROM research_runs WHERE started_at = '2026-08-01 09:03:00'),
  json_extract(j.value, '$.kw'), json_extract(j.value, '$.pos'), NULL,
  json_extract(j.value, '$.co'), json_extract(j.value, '$.ws'),
  json_extract(j.value, '$.url'), json_extract(j.value, '$.r'),
  json_extract(j.value, '$.rv'), '2026-08-01 09:04:12'
FROM json_each('[
 {"kw":"electrician near me","pos":1,"co":"Fox Valley Electric LLC","ws":1,"url":"https://foxvalleyelectricllc.com","r":4.8,"rv":214},
 {"kw":"electrician near me","pos":2,"co":"Badger State Electrical","ws":0,"url":null,"r":4.9,"rv":87},
 {"kw":"electrician near me","pos":3,"co":"Current Solutions WI","ws":1,"url":"https://currentsolutionswi.com","r":4.6,"rv":156}
]') j;

-- Latest capture (second run) — three keywords, mixed website presence. Rows
-- with ws = 0 are the amber "no website" targets the page exists to surface.
INSERT INTO map_pack_results (market_id, run_id, keyword, position, place_id, company, has_website, website, google_rating, review_count, captured_at)
SELECT
  (SELECT id FROM markets WHERE geo_target_id = '9990001'),
  (SELECT id FROM research_runs WHERE started_at = '2026-08-06 15:42:00'),
  json_extract(j.value, '$.kw'), json_extract(j.value, '$.pos'), NULL,
  json_extract(j.value, '$.co'), json_extract(j.value, '$.ws'),
  json_extract(j.value, '$.url'), json_extract(j.value, '$.r'),
  json_extract(j.value, '$.rv'), '2026-08-06 15:43:20'
FROM json_each('[
 {"kw":"electrician near me","pos":1,"co":"Badger State Electrical","ws":0,"url":null,"r":4.9,"rv":91},
 {"kw":"electrician near me","pos":2,"co":"Fox Valley Electric LLC","ws":1,"url":"https://foxvalleyelectricllc.com","r":4.8,"rv":219},
 {"kw":"electrician near me","pos":3,"co":"Current Solutions WI","ws":1,"url":"https://currentsolutionswi.com","r":4.6,"rv":158},
 {"kw":"electrician near me","pos":4,"co":"Sparky Bros Electric","ws":0,"url":null,"r":4.7,"rv":43},
 {"kw":"electrician near me","pos":5,"co":"Appleton Wiring Pros","ws":1,"url":"https://appletonwiringpros.com","r":4.3,"rv":67},
 {"kw":"electrician appleton","pos":1,"co":"Fox Valley Electric LLC","ws":1,"url":"https://foxvalleyelectricllc.com","r":4.8,"rv":219},
 {"kw":"electrician appleton","pos":2,"co":"Appleton Wiring Pros","ws":1,"url":"https://appletonwiringpros.com","r":4.3,"rv":67},
 {"kw":"electrician appleton","pos":3,"co":"Lamers Electric Service","ws":0,"url":null,"r":5.0,"rv":28},
 {"kw":"electrician appleton","pos":4,"co":"Badger State Electrical","ws":0,"url":null,"r":4.9,"rv":91},
 {"kw":"emergency electrician appleton","pos":1,"co":"Current Solutions WI","ws":1,"url":"https://currentsolutionswi.com","r":4.6,"rv":158},
 {"kw":"emergency electrician appleton","pos":2,"co":"Sparky Bros Electric","ws":0,"url":null,"r":4.7,"rv":43},
 {"kw":"emergency electrician appleton","pos":3,"co":"Fox Valley Electric LLC","ws":1,"url":"https://foxvalleyelectricllc.com","r":4.8,"rv":219}
]') j;

-- ------------------------------------------------------ Roofing × Oshkosh --
INSERT INTO market_keywords (market_id, run_id, keyword, monthly_volume, competition, competition_index, cpc_low, cpc_high, trend_json, is_near_me, fetched_at)
SELECT
  (SELECT id FROM markets WHERE geo_target_id = '9990002'),
  (SELECT id FROM research_runs WHERE started_at = '2026-08-05 11:20:00'),
  json_extract(j.value, '$.k'), json_extract(j.value, '$.v'),
  json_extract(j.value, '$.c'), json_extract(j.value, '$.ci'),
  json_extract(j.value, '$.lo'), json_extract(j.value, '$.hi'),
  json_extract(j.value, '$.t'), json_extract(j.value, '$.nm'),
  '2026-08-05 11:20:44'
FROM json_each('[
 {"k":"roofer near me","v":880,"c":"HIGH","ci":84,"lo":11.20,"hi":36.40,"nm":1,
  "t":[{"year":2025,"month":9,"volume":720},{"year":2025,"month":10,"volume":590},{"year":2025,"month":11,"volume":480},{"year":2025,"month":12,"volume":390},{"year":2026,"month":1,"volume":390},{"year":2026,"month":2,"volume":480},{"year":2026,"month":3,"volume":720},{"year":2026,"month":4,"volume":1000},{"year":2026,"month":5,"volume":1300},{"year":2026,"month":6,"volume":1300},{"year":2026,"month":7,"volume":1000},{"year":2026,"month":8,"volume":880}]},
 {"k":"roofer oshkosh","v":480,"c":"MEDIUM","ci":61,"lo":8.90,"hi":27.10,"nm":0,
  "t":[{"year":2025,"month":9,"volume":390},{"year":2025,"month":10,"volume":320},{"year":2025,"month":11,"volume":260},{"year":2025,"month":12,"volume":210},{"year":2026,"month":1,"volume":210},{"year":2026,"month":2,"volume":260},{"year":2026,"month":3,"volume":390},{"year":2026,"month":4,"volume":590},{"year":2026,"month":5,"volume":720},{"year":2026,"month":6,"volume":720},{"year":2026,"month":7,"volume":590},{"year":2026,"month":8,"volume":480}]},
 {"k":"emergency roofer oshkosh","v":110,"c":"HIGH","ci":76,"lo":13.50,"hi":41.20,"nm":0,
  "t":[{"year":2025,"month":9,"volume":90},{"year":2025,"month":10,"volume":70},{"year":2025,"month":11,"volume":50},{"year":2025,"month":12,"volume":50},{"year":2026,"month":1,"volume":50},{"year":2026,"month":2,"volume":70},{"year":2026,"month":3,"volume":110},{"year":2026,"month":4,"volume":140},{"year":2026,"month":5,"volume":170},{"year":2026,"month":6,"volume":170},{"year":2026,"month":7,"volume":140},{"year":2026,"month":8,"volume":110}]},
 {"k":"roofer company oshkosh","v":70,"c":"MEDIUM","ci":49,"lo":6.80,"hi":20.50,"nm":0,
  "t":[{"year":2025,"month":9,"volume":50},{"year":2025,"month":10,"volume":50},{"year":2025,"month":11,"volume":40},{"year":2025,"month":12,"volume":30},{"year":2026,"month":1,"volume":30},{"year":2026,"month":2,"volume":40},{"year":2026,"month":3,"volume":50},{"year":2026,"month":4,"volume":90},{"year":2026,"month":5,"volume":110},{"year":2026,"month":6,"volume":110},{"year":2026,"month":7,"volume":90},{"year":2026,"month":8,"volume":70}]},
 {"k":"best roofer oshkosh","v":50,"c":"MEDIUM","ci":45,"lo":5.90,"hi":18.20,"nm":0,
  "t":[{"year":2025,"month":9,"volume":40},{"year":2025,"month":10,"volume":30},{"year":2025,"month":11,"volume":30},{"year":2025,"month":12,"volume":20},{"year":2026,"month":1,"volume":20},{"year":2026,"month":2,"volume":30},{"year":2026,"month":3,"volume":40},{"year":2026,"month":4,"volume":70},{"year":2026,"month":5,"volume":90},{"year":2026,"month":6,"volume":90},{"year":2026,"month":7,"volume":70},{"year":2026,"month":8,"volume":50}]},
 {"k":"24 hour roofer","v":40,"c":"HIGH","ci":70,"lo":10.10,"hi":31.80,"nm":0,
  "t":[{"year":2025,"month":9,"volume":30},{"year":2025,"month":10,"volume":30},{"year":2025,"month":11,"volume":20},{"year":2025,"month":12,"volume":20},{"year":2026,"month":1,"volume":20},{"year":2026,"month":2,"volume":20},{"year":2026,"month":3,"volume":30},{"year":2026,"month":4,"volume":50},{"year":2026,"month":5,"volume":70},{"year":2026,"month":6,"volume":70},{"year":2026,"month":7,"volume":50},{"year":2026,"month":8,"volume":40}]},
 {"k":"roofer repair oshkosh","v":30,"c":"LOW","ci":24,"lo":4.60,"hi":14.70,"nm":0,
  "t":[{"year":2025,"month":9,"volume":20},{"year":2025,"month":10,"volume":20},{"year":2025,"month":11,"volume":10},{"year":2025,"month":12,"volume":10},{"year":2026,"month":1,"volume":10},{"year":2026,"month":2,"volume":20},{"year":2026,"month":3,"volume":20},{"year":2026,"month":4,"volume":40},{"year":2026,"month":5,"volume":50},{"year":2026,"month":6,"volume":50},{"year":2026,"month":7,"volume":40},{"year":2026,"month":8,"volume":30}]}
]') j;

-- Partial run: only the near-me keyword's map pack landed before the second
-- scrape timed out.
INSERT INTO map_pack_results (market_id, run_id, keyword, position, place_id, company, has_website, website, google_rating, review_count, captured_at)
SELECT
  (SELECT id FROM markets WHERE geo_target_id = '9990002'),
  (SELECT id FROM research_runs WHERE started_at = '2026-08-05 11:20:00'),
  json_extract(j.value, '$.kw'), json_extract(j.value, '$.pos'), NULL,
  json_extract(j.value, '$.co'), json_extract(j.value, '$.ws'),
  json_extract(j.value, '$.url'), json_extract(j.value, '$.r'),
  json_extract(j.value, '$.rv'), '2026-08-05 11:22:05'
FROM json_each('[
 {"kw":"roofer near me","pos":1,"co":"Winnebago Roofing Co","ws":1,"url":"https://winnebagoroofing.com","r":4.7,"rv":132},
 {"kw":"roofer near me","pos":2,"co":"Lakeside Exteriors","ws":0,"url":null,"r":4.9,"rv":56},
 {"kw":"roofer near me","pos":3,"co":"Oshkosh Roof Care","ws":0,"url":null,"r":4.5,"rv":38},
 {"kw":"roofer near me","pos":4,"co":"Titan Shingle and Siding","ws":1,"url":"https://titanshingle.com","r":4.4,"rv":201},
 {"kw":"roofer near me","pos":5,"co":"Fox Cities Storm Repair","ws":1,"url":"https://foxcitiesstormrepair.com","r":4.2,"rv":89}
]') j;

-- --------------------------------------------------- Landscaping × De Pere --
-- Paused market with an older complete run — exercises the dimmed list row +
-- Paused badge, the Resume flow, and null CPC / missing trend rendering.
INSERT INTO market_keywords (market_id, run_id, keyword, monthly_volume, competition, competition_index, cpc_low, cpc_high, trend_json, is_near_me, fetched_at)
SELECT
  (SELECT id FROM markets WHERE geo_target_id = '9990003'),
  (SELECT id FROM research_runs WHERE started_at = '2026-07-28 10:15:00'),
  json_extract(j.value, '$.k'), json_extract(j.value, '$.v'),
  json_extract(j.value, '$.c'), json_extract(j.value, '$.ci'),
  json_extract(j.value, '$.lo'), json_extract(j.value, '$.hi'),
  json_extract(j.value, '$.t'), json_extract(j.value, '$.nm'),
  '2026-07-28 10:15:38'
FROM json_each('[
 {"k":"landscaper near me","v":590,"c":"MEDIUM","ci":58,"lo":3.40,"hi":12.60,"nm":1,
  "t":[{"year":2025,"month":9,"volume":480},{"year":2025,"month":10,"volume":390},{"year":2025,"month":11,"volume":210},{"year":2025,"month":12,"volume":140},{"year":2026,"month":1,"volume":140},{"year":2026,"month":2,"volume":210},{"year":2026,"month":3,"volume":480},{"year":2026,"month":4,"volume":880},{"year":2026,"month":5,"volume":1000},{"year":2026,"month":6,"volume":880},{"year":2026,"month":7,"volume":720},{"year":2026,"month":8,"volume":590}]},
 {"k":"landscaper de pere","v":210,"c":"LOW","ci":32,"lo":2.80,"hi":9.40,"nm":0,
  "t":[{"year":2025,"month":9,"volume":170},{"year":2025,"month":10,"volume":140},{"year":2025,"month":11,"volume":70},{"year":2025,"month":12,"volume":50},{"year":2026,"month":1,"volume":50},{"year":2026,"month":2,"volume":70},{"year":2026,"month":3,"volume":170},{"year":2026,"month":4,"volume":320},{"year":2026,"month":5,"volume":390},{"year":2026,"month":6,"volume":320},{"year":2026,"month":7,"volume":260},{"year":2026,"month":8,"volume":210}]},
 {"k":"best landscaper de pere","v":50,"c":"LOW","ci":21,"lo":2.10,"hi":7.80,"nm":0,
  "t":[{"year":2025,"month":9,"volume":40},{"year":2025,"month":10,"volume":30},{"year":2025,"month":11,"volume":20},{"year":2025,"month":12,"volume":10},{"year":2026,"month":1,"volume":10},{"year":2026,"month":2,"volume":20},{"year":2026,"month":3,"volume":40},{"year":2026,"month":4,"volume":70},{"year":2026,"month":5,"volume":90},{"year":2026,"month":6,"volume":70},{"year":2026,"month":7,"volume":50},{"year":2026,"month":8,"volume":50}]},
 {"k":"landscaper company de pere","v":30,"c":"LOW","ci":18,"lo":1.90,"hi":6.50,"nm":0},
 {"k":"emergency landscaper de pere","v":10,"c":"LOW","ci":8,"nm":0}
]') j;

INSERT INTO map_pack_results (market_id, run_id, keyword, position, place_id, company, has_website, website, google_rating, review_count, captured_at)
SELECT
  (SELECT id FROM markets WHERE geo_target_id = '9990003'),
  (SELECT id FROM research_runs WHERE started_at = '2026-07-28 10:15:00'),
  json_extract(j.value, '$.kw'), json_extract(j.value, '$.pos'), NULL,
  json_extract(j.value, '$.co'), json_extract(j.value, '$.ws'),
  json_extract(j.value, '$.url'), json_extract(j.value, '$.r'),
  json_extract(j.value, '$.rv'), '2026-07-28 10:16:02'
FROM json_each('[
 {"kw":"landscaper near me","pos":1,"co":"Green Horizons Landscaping","ws":1,"url":"https://greenhorizonswi.com","r":4.8,"rv":174},
 {"kw":"landscaper near me","pos":2,"co":"De Pere Lawn and Stone","ws":0,"url":null,"r":4.6,"rv":62},
 {"kw":"landscaper near me","pos":3,"co":"Voyageur Outdoor Services","ws":0,"url":null,"r":5.0,"rv":19}
]') j;
