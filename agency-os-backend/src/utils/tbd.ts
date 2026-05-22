/**
 * Counts `[TBD: <field>]` tokens inside a brief's markdown.
 *
 * The Brief Studio editor surfaces this number as a chip and renders each
 * matching token as a clickable inline-fill input. Whenever a brief is saved
 * (POST master, POST page brief, PATCH brief content), routes call this to
 * keep `briefs.tbd_count` cached.
 */
const TBD_PATTERN = /\[TBD:[^\]]*\]/gi;

export function countTbds(markdown: string | null | undefined): number {
  if (!markdown) return 0;
  const matches = markdown.match(TBD_PATTERN);
  return matches ? matches.length : 0;
}
