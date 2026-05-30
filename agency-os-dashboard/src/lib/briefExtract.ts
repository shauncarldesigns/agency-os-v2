/**
 * Extract services and service areas from master brief markdown.
 *
 * The master brief format (see backend `prompts/masterBrief.ts` APEX_FORMAT_EXAMPLE)
 * looks like:
 *
 *   ## Services Offered
 *   1. **Roof Replacement** — desc...
 *   2. **Gutter Repair** — desc...
 *
 *   ## Service Areas (Wisconsin)
 *   - Madison (HQ)
 *   - Sun Prairie
 *
 * These helpers parse those sections leniently so we can diff against the
 * project's `services` / `service_areas` JSON columns and surface a
 * "brief mentions things not in your matrix" callout.
 */

export function extractServicesFromBrief(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  return parseSection(markdown, /^##\s+Services Offered\b.*$/im);
}

export function extractServiceAreasFromBrief(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  return parseSection(markdown, /^##\s+Service Areas\b.*$/im);
}

/**
 * Compute additions-only diff: items in `fromBrief` that are not in `inMatrix`,
 * matched case-insensitively after trimming. Returns the brief's original
 * casing so the callout shows the operator-readable form.
 */
export function diffAdditions(fromBrief: string[], inMatrix: string[]): string[] {
  const have = new Set(inMatrix.map(normalize));
  return fromBrief.filter((item) => !have.has(normalize(item)));
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function parseSection(markdown: string, headerPattern: RegExp): string[] {
  const headerMatch = markdown.match(headerPattern);
  if (!headerMatch || headerMatch.index === undefined) return [];

  // Slice everything after the header line.
  const afterHeader = markdown.slice(headerMatch.index + headerMatch[0].length);

  // Stop at the next `## ` (case-insensitive) heading or EOF.
  const nextHeaderIdx = afterHeader.search(/^##\s/m);
  const section = nextHeaderIdx === -1 ? afterHeader : afterHeader.slice(0, nextHeaderIdx);

  const items: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of section.split('\n')) {
    // Match a bullet (-, *) or numbered (1.) list item.
    const m = rawLine.match(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/);
    if (!m) continue;

    let text = m[1];

    // Strip bold markers (**Service**).
    text = text.replace(/\*\*/g, '');

    // Drop description suffix introduced by em-dash or " - " (services
    // section uses `**Service** — description`).
    text = text.split(/\s+(?:—|–|-)\s+/)[0];

    // Drop trailing parentheticals like "(HQ)" or "(Active)".
    text = text.replace(/\s*\([^)]*\)\s*$/, '');

    // Skip TBD placeholders so the callout doesn't suggest fake items.
    if (/^\[TBD/i.test(text)) continue;

    text = text.trim();
    if (!text) continue;

    const key = normalize(text);
    if (seen.has(key)) continue;
    seen.add(key);

    items.push(text);
  }

  return items;
}
