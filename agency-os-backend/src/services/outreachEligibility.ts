export type OutreachChannel = 'text' | 'email';

// These predicates are the source of truth for the two outreach audiences.
// Keep the channel split here so the Text board, Email board, and Builder
// queue cannot silently drift into different lead pools.
function activeOutreachLeadSql(alias: string): string {
  return `
    ${alias}.deleted_at IS NULL
    AND ${alias}.status IN ('cold','contacted')
    AND ${alias}.pipeline_status NOT IN ('booked','archived')
    AND ${alias}.enrichment_status='enriched'
    AND COALESCE(${alias}.has_website,0)=0
    AND lower(COALESCE(${alias}.outcome,'')) NOT LIKE '%not interested%'
    AND NOT EXISTS (SELECT 1 FROM projects outreach_project WHERE outreach_project.lead_id=${alias}.id)
    AND NOT EXISTS (
      SELECT 1 FROM demos outreach_demo
      WHERE outreach_demo.lead_id=${alias}.id
        AND outreach_demo.status IN ('booked','held','rescheduled')
    )
  `;
}

export function outreachLeadSql(alias: string, channel: OutreachChannel): string {
  const route = channel === 'text'
    ? `COALESCE(${alias}.phone_route,'unknown') IN ('unknown','text')`
    : `${alias}.phone_route='call'`;
  return `(${activeOutreachLeadSql(alias)} AND ${route})`;
}

export function builderEligibleLeadSql(alias = 'l'): string {
  return `
    ${alias}.pipeline_status='awaiting_build'
    AND (${outreachLeadSql(alias, 'text')} OR ${outreachLeadSql(alias, 'email')})
    AND COALESCE(trim(${alias}.site_url),'')=''
    AND COALESCE(trim(${alias}.site_url_raw),'')=''
  `;
}
