import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const temporary = mkdtempSync(join(tmpdir(),'website-brief-tests-'));
const output = join(temporary,'routes.mjs');
await build({stdin:{contents:`export { websiteBriefsRouter } from './src/routes/websiteBriefs'; export { builderWorkerRouter } from './src/routes/builder'; export { designLibraryRouter } from './src/routes/designLibrary'; export {websiteUrl,websiteKey} from './src/services/websiteUrl';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,platform:'node',format:'esm',outfile:output});
const {websiteBriefsRouter:router,builderWorkerRouter,designLibraryRouter,websiteUrl,websiteKey} = await import(output);
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../src/db/schema.sql',import.meta.url),'utf8'));
const DB = {
  prepare(sql) {
    let args = [];
    const statement = {
      bind(...values) {args=values;return statement;},
      async first(column) {const row=sqlite.prepare(sql).get(...args) ?? null;return column ? row?.[column] ?? null : row;},
      async all() {return {results:sqlite.prepare(sql).all(...args)};},
      async run() {const result=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};},
    };return statement;
  },
  async batch(statements) {return Promise.all(statements.map(s=>s.run()));},
};
const env = {DB,CLAUDE_API_KEY:'test-only',BUILDER_API_TOKEN:'test-only'};
async function request(path,body,method='POST',target=router) {
  const response = await target.request(`http://localhost${path}`,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer test-only'},...(body===undefined ? {} : {body:JSON.stringify(body)})},env);
  return {status:response.status,body:await response.json()};
}
let modelPrompt=''; let failScan=false; let privateRedirect=false; const fetched=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async (input,options) => {
  const url=String(input);fetched.push(url);
  if (url==='https://api.anthropic.com/v1/messages') {
    const body=JSON.parse(options.body);modelPrompt=JSON.stringify(body);
    const extracting = body.messages[0].content.includes('Extract brand voice signals');
    return Response.json({content:[{type:'text',text:extracting ? JSON.stringify({tagline:'Reliable local service',positioning:'Local service team',owner_story:null,certifications:[],services_described:['Managed IT'],distinctive_phrases:[]}) : '# Redesign brief\nPreserve the reviewed palette and improve service navigation.'}],usage:{input_tokens:10,output_tokens:10}});
  }
  if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
  if (privateRedirect) return new Response('',{status:302,headers:{Location:'http://127.0.0.1/private'}});
  if (failScan) return new Response('Unavailable',{status:503});
  const response = new Response(`<html><body><h1>Reliable local service</h1><p>${'Managed IT and cloud services for local businesses. '.repeat(12)}</p><a href='/about'>About</a></body></html>`,{headers:{'Content-Type':'text/html'}});
  Object.defineProperty(response,'url',{value:url});return response;
};
try {
  assert.equal(websiteUrl('example.com'),'https://example.com/');
  assert.equal(websiteKey('https://www.example.com/about'),'example.com');
  for (const url of ['','file:///etc/passwd','http://127.1','http://169.254.169.254','http://localhost','http://[::1]','https://user:pass@example.com','https://example.com:8080','http://10.0.0.1']) assert.throws(()=>websiteUrl(url),url);
  let result=await request('/website-leads',{url:'http://127.0.0.1'});assert.equal(result.status,400);
  result=await request('/website-leads',{url:'example.com',company:'Example IT'});assert.equal(result.status,201);
  const lead=result.body.lead;assert.equal(lead.has_website,1);assert.equal(lead.outreach_enabled,0);assert.equal(lead.source,'website');
  result=await request('/website-leads',{url:'https://www.example.com/services',company:'Duplicate'});assert.equal(result.body.lead.id,lead.id);assert.equal(result.body.existing,true);
  const noSite=sqlite.prepare("INSERT INTO leads(company) VALUES('No website')").run();
  result=await request('/website-briefs',{leadId:Number(noSite.lastInsertRowid)});assert.equal(result.status,400);
  result=await request('/website-briefs',{leadId:lead.id});const id=result.body.brief.id;assert.equal(result.status,200);
  assert.equal((await request('/website-briefs',{leadId:lead.id})).body.brief.id,id);
  assert.equal((await request(`/website-briefs/${id}/generate`)).status,400);
  result=await request(`/website-briefs/${id}/scan`);assert.equal(result.status,200);assert.equal(result.body.pages,2);
  const previous=sqlite.prepare('SELECT scrape_data FROM website_briefs WHERE id=?').get(id).scrape_data;
  failScan=true;assert.equal((await request(`/website-briefs/${id}/scan`)).status,422);assert.equal(sqlite.prepare('SELECT scrape_data FROM website_briefs WHERE id=?').get(id).scrape_data,previous);failScan=false;
  privateRedirect=true;assert.equal((await request(`/website-briefs/${id}/scan`)).status,422);assert.ok(!fetched.some(u=>u.includes('127.0.0.1')));privateRedirect=false;
  assert.equal((await request(`/website-briefs/${id}`,{brand_colors:'#123456 primary',brand_fonts:'Inter',direction:'Improve navigation',brief:''},'PUT')).status,200);
  assert.equal((await request(`/website-briefs/${id}/capture`)).status,202);
  assert.equal((await request(`/website-briefs/${id}/capture`)).status,202);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM design_capture_jobs').get().n,1);
  const pausedCapture=await request('/capture-claim',undefined,'POST',builderWorkerRouter);assert.equal(pausedCapture.body.browserDisabled,true);assert.equal(pausedCapture.body.capture,null);
  sqlite.exec('UPDATE builder_control SET browser_enabled=1 WHERE id=1');
  const capture=await request('/capture-claim',undefined,'POST',builderWorkerRouter);assert.ok(capture.body.capture);
  const job=capture.body.capture;
  for (const kind of ['desktop_full','mobile_full']) sqlite.prepare('INSERT INTO design_reference_assets(design_reference_id,capture_job_id,kind,storage_key,viewport_width,viewport_height) VALUES(?,?,?,?,1440,1000)').run(job.designReferenceId,job.id,kind,kind);
  const tokens={colors:{backgrounds:[{value:'#123456',count:20}]},typography:{fontFamilies:[{value:'Inter',count:30}]}};
  result=await request('/capture-result',{jobId:job.id,lockToken:job.lockToken,success:true,technicalAudit:tokens},'POST',builderWorkerRouter);
  assert.equal(result.status,200);assert.equal(result.body.autoGenerate,false);
  result=await request(`/website-briefs/${id}/generate`);assert.equal(result.status,200);assert.match(result.body.brief,/Redesign brief/);assert.match(modelPrompt,/#123456/);assert.match(modelPrompt,/Improve navigation/);
  result=await request('/design-references',undefined,'GET',designLibraryRouter);assert.equal(result.status,200);assert.ok(result.body.designs.every(d=>d.purpose==='library'));
  result=await request('/website-briefs',undefined,'GET');assert.equal(result.body.briefs[0].capture_status,'completed');assert.equal(result.body.briefs[0].technical_tokens,JSON.stringify(tokens));
  // Reusing captures must preserve the normal library recipe-generation behavior.
  const libraryId=sqlite.prepare("SELECT id FROM design_references WHERE purpose='library' LIMIT 1").get().id;
  assert.equal((await request(`/design-references/${libraryId}`,{status:'draft'},'PUT',designLibraryRouter)).status,200);
  assert.equal((await request(`/design-references/${libraryId}/capture`,undefined,'POST',designLibraryRouter)).status,202);
  const libraryJob=(await request('/capture-claim',undefined,'POST',builderWorkerRouter)).body.capture;
  for (const kind of ['desktop_full','mobile_full']) sqlite.prepare('INSERT INTO design_reference_assets(design_reference_id,capture_job_id,kind,storage_key,viewport_width,viewport_height) VALUES(?,?,?,?,1440,1000)').run(libraryJob.designReferenceId,libraryJob.id,kind,`library-${kind}`);
  result=await request('/capture-result',{jobId:libraryJob.id,lockToken:libraryJob.lockToken,success:true,technicalAudit:tokens},'POST',builderWorkerRouter);
  assert.equal(result.body.autoGenerate,true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM projects').get().n,0);
  // Existing databases receive the same new structure through the additive migration.
  const legacy=new DatabaseSync(':memory:');legacy.exec('CREATE TABLE leads(id INTEGER PRIMARY KEY); CREATE TABLE design_references(id INTEGER PRIMARY KEY);');
  legacy.exec(readFileSync(new URL('../src/db/migrations/2026-11-04-website-briefs.sql',import.meta.url),'utf8'));
  assert.ok(legacy.prepare('PRAGMA table_info(website_briefs)').all().some(c=>c.name==='brand_colors'));legacy.close();
  console.log('Website briefs: import, duplicates, URL guards, eligibility, scan preservation, capture reuse, brand prompt, persistence, library isolation and migration checks passed.');
} finally {globalThis.fetch=originalFetch;sqlite.close();rmSync(temporary,{recursive:true,force:true});}
