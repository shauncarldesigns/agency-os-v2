import { log } from '../utils/errors';

const PLACES_BASE = 'https://places.googleapis.com/v1';

export interface GoogleReview {
  author: string;
  rating: number;
  text: string;
  relativeTime: string;
  publishTime: string;
}

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  lat: number | null;
  lng: number | null;
  types: string[];
  primaryType: string | null;
  // GBP signals
  hasHours: boolean;
  hasDescription: boolean;
  photoCount: number;
  claimed: boolean; // heuristic
  businessStatus: string | null;
}

export interface PlaceDetails extends PlaceResult {
  reviews: GoogleReview[];
  hours: string[] | null;
  description: string | null;
}

const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.types',
  'places.primaryType',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.editorialSummary',
  'places.photos',
  'places.businessStatus',
].join(',');

const DETAIL_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'addressComponents',
  'location',
  'rating',
  'userRatingCount',
  'websiteUri',
  'nationalPhoneNumber',
  'types',
  'primaryType',
  'regularOpeningHours.weekdayDescriptions',
  'editorialSummary',
  'photos',
  'businessStatus',
  'reviews',
].join(',');

function pickAddressPart(components: Array<Record<string, unknown>> | undefined, type: string): string | null {
  if (!components) return null;
  const match = components.find(c => Array.isArray(c.types) && (c.types as string[]).includes(type));
  return (match?.shortText as string | undefined) ?? (match?.longText as string | undefined) ?? null;
}

function mapPlace(p: Record<string, unknown>): PlaceResult {
  const components = p.addressComponents as Array<Record<string, unknown>> | undefined;
  const hasHours = !!(p.regularOpeningHours as { weekdayDescriptions?: string[] } | undefined)?.weekdayDescriptions?.length;
  const hasDescription = !!(p.editorialSummary as { text?: string } | undefined)?.text;
  const photoCount = ((p.photos as unknown[]) ?? []).length;
  const phone = (p.nationalPhoneNumber as string | null) ?? null;
  // Heuristic: claimed if hours filled in, or has phone AND photos
  const claimed = hasHours || (!!phone && photoCount > 0);

  return {
    placeId: p.id as string,
    name: (p.displayName as { text: string } | null)?.text ?? '',
    address: (p.formattedAddress as string) ?? '',
    city: pickAddressPart(components, 'locality'),
    state: pickAddressPart(components, 'administrative_area_level_1'),
    phone,
    website: (p.websiteUri as string | null) ?? null,
    rating: (p.rating as number | null) ?? null,
    reviewCount: (p.userRatingCount as number | null) ?? null,
    lat: (p.location as { latitude?: number } | null)?.latitude ?? null,
    lng: (p.location as { longitude?: number } | null)?.longitude ?? null,
    types: (p.types as string[]) ?? [],
    primaryType: (p.primaryType as string | null) ?? null,
    hasHours,
    hasDescription,
    photoCount,
    claimed,
    businessStatus: (p.businessStatus as string | null) ?? null,
  };
}

export interface SearchPlacesResult {
  places: PlaceResult[];
  /** Token to request the next page from Google. Empty when no more results. */
  nextPageToken: string | null;
  /** Number of upstream API pages we actually pulled this call. */
  pagesFetched: number;
}

/**
 * Search Google Places Text Search (New).
 *
 * Bug fix history (v2.1):
 *  - Removed broken locationBias circle anchored at (lat=0, lng=0) — text query
 *    "<industry> in <location>" handles location filtering on its own.
 *  - Paginates via pageToken up to MAX_PAGES (3 pages × 20 = up to 60 results).
 *  - Caller may pass `pageToken` to continue from where a previous call stopped.
 */
export async function searchPlaces(
  apiKey: string,
  query: string,
  location: string,
  options?: { pageToken?: string | null; maxPages?: number }
): Promise<SearchPlacesResult> {
  const MAX_PAGES = options?.maxPages ?? 3;
  let pageToken: string | null | undefined = options?.pageToken ?? null;
  let pagesFetched = 0;
  const all: PlaceResult[] = [];

  while (pagesFetched < MAX_PAGES) {
    const body: Record<string, unknown> = {
      textQuery: `${query} in ${location}`,
      maxResultCount: 20,
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': `${SEARCH_FIELD_MASK},nextPageToken`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      log('error', 'places', `searchText failed: ${res.status}`, { err, page: pagesFetched });
      throw new Error(`Google Places API error: ${res.status}`);
    }

    const data = (await res.json()) as {
      places?: Array<Record<string, unknown>>;
      nextPageToken?: string;
    };
    all.push(...(data.places ?? []).map(mapPlace));
    pagesFetched++;

    pageToken = data.nextPageToken ?? null;
    if (!pageToken) break;

    // Google requires a brief delay before the pageToken becomes valid.
    if (pagesFetched < MAX_PAGES) await sleep(2000);
  }

  return { places: all, nextPageToken: pageToken ?? null, pagesFetched };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getPlaceDetails(apiKey: string, placeId: string): Promise<PlaceDetails> {
  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': DETAIL_FIELD_MASK,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    log('error', 'places', `getDetails failed: ${res.status}`, { err, placeId });
    throw new Error(`Google Places detail fetch failed: ${res.status}`);
  }

  const p = await res.json() as Record<string, unknown>;
  const base = mapPlace(p);

  const rawReviews = (p.reviews as Array<Record<string, unknown>>) ?? [];
  const reviews: GoogleReview[] = rawReviews.map(r => ({
    author: ((r.authorAttribution as { displayName?: string } | null)?.displayName) ?? 'Anonymous',
    rating: (r.rating as number) ?? 0,
    text: ((r.text as { text?: string } | null)?.text) ?? '',
    relativeTime: (r.relativePublishTimeDescription as string) ?? '',
    publishTime: (r.publishTime as string) ?? '',
  }));

  const hours = (p.regularOpeningHours as { weekdayDescriptions?: string[] } | undefined)?.weekdayDescriptions ?? null;
  const description = (p.editorialSummary as { text?: string } | undefined)?.text ?? null;

  return { ...base, reviews, hours, description };
}
