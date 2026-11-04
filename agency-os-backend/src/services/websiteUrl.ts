/** Public website URLs shared by imports and the existing-site scraper. */
export function websiteUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('A published website URL is required');
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const parts = host.split('.').map(Number);
  const ipv4 = parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
  const [a,b] = parts;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (url.port && !['80','443'].includes(url.port)) || !host.includes('.')
    || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    || host.includes(':')
    || (ipv4 && (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)))) {
    throw new Error('Enter a public HTTP or HTTPS website URL');
  }
  url.hash = ''; url.search = '';
  return url.href;
}
export function websiteKey(input: string): string {
  return new URL(websiteUrl(input)).hostname.replace(/^www\./, '');
}
