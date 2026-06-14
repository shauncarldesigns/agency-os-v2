// Landingsite.ai DNS records — same for every client site.
//
// Three records get created on every project's Cloudflare zone:
//   - Two A records at the apex pointing to landingsite's two ingress IPs
//   - One CNAME on `www` pointing to landingsite's SSL proxy
//
// All records MUST be created with proxy OFF (gray cloud). Landingsite issues
// the SSL cert directly; Cloudflare's orange-cloud proxy intercepts TLS and
// breaks their certificate. This is the most likely failure mode to introduce
// if you pattern-match to "default Cloudflare best practice." Don't.
//
// Single source of truth — if landingsite's ingress changes, edit this file
// and re-deploy. The /dns/retry endpoint will recover any project whose live
// zone records drift from this list.

export interface LandingsiteRecord {
  type: 'A' | 'CNAME';
  subdomain: string;       // '@' for apex, 'www' for www
  content: string;
  comment: string;
}

export const LANDINGSITE_DNS_RECORDS: ReadonlyArray<LandingsiteRecord> = [
  { type: 'A',     subdomain: '@',   content: '75.2.29.147',                comment: 'landingsite apex' },
  { type: 'A',     subdomain: '@',   content: '166.117.246.71',             comment: 'landingsite apex' },
  { type: 'CNAME', subdomain: 'www', content: 'proxy-ssl.getlandingsite.com', comment: 'landingsite www' },
];

// Cloudflare's DNS record API accepts the full hostname for `name`, e.g.
// "example.com" for the apex and "www.example.com" for the www subdomain.
// We always send the full form for unambiguous matching during /status checks.
export function expectedHostname(domain: string, subdomain: string): string {
  return subdomain === '@' ? domain : `${subdomain}.${domain}`;
}
