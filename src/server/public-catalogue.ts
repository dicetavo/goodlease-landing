import { sanitizePublicPayload } from './webapp-api-policy';
import { DEFAULT_API, DEFAULT_IMAGE } from './public-html';
import { catalogueImageUrl } from './catalogue-image';

export type PublicLease = Record<string, unknown>;

export { categories } from './catalogue-content';
import { categories, searchAreas, type RentalCategory } from './catalogue-content';

export function numeric(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function leaseId(lease: PublicLease): string | undefined {
  if (typeof lease.id === 'number' && !Number.isSafeInteger(lease.id)) return undefined;
  const id = String(lease.id ?? '');
  return /^[1-9]\d{0,18}$/.test(id) ? id : undefined;
}

export function cityName(lease: PublicLease): string {
  const address = lease.address as { city?: unknown } | undefined;
  return typeof address?.city === 'string' ? address.city.replace(/\s+/g, ' ').trim() : '';
}

export function citySlug(city: string): string {
  return city.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function categoryFor(lease: PublicLease) {
  return categories.find((category) => !category.keywords && categoryMatches(lease, category));
}

export function categoryMatches(lease: PublicLease, category: RentalCategory) {
  return category.id === numeric(lease.categoryId) && (!category.keywords || category.keywords.test(`${lease.title || ''} ${lease.description || ''}`));
}

export const categoryBySlug = (slug: string) => categories.find((category) => category.slug === slug || category.aliases?.includes(slug));

export function leasePath(lease: PublicLease) {
  const id = leaseId(lease);
  const label = citySlug(`${typeof lease.title === 'string' ? lease.title : 'materiel'} ${cityName(lease)}`).slice(0, 110).replace(/-$/, '') || 'materiel';
  return id ? `/materiel/${label}-${id}` : '/catalogue';
}

/** Seules les dates de modification réellement fournies par l'API sont publiées. */
export function leaseLastmod(lease: PublicLease): string | undefined {
  const raw = lease.updatedAt ?? lease.lastModifiedAt;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(raw)) return undefined;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) && date.getTime() <= Date.now() ? date.toISOString() : undefined;
}

export function areasFor(lease: PublicLease) {
  const slug = citySlug(cityName(lease));
  if (!slug) return [];
  const areas = new Map<string, { slug: string; name: string; label: string }>([
    [slug, { slug, name: cityName(lease), label: cityName(lease) }],
  ]);
  for (const area of searchAreas) {
    if ((area.cities as readonly string[]).includes(slug)) areas.set(area.slug, area);
  }
  return [...areas.values()];
}

export function inArea(lease: PublicLease, slug: string) {
  return areasFor(lease).some((area) => area.slug === slug);
}

export function cityPagePath(lease: PublicLease): string | undefined {
  const category = categoryFor(lease);
  const city = citySlug(cityName(lease));
  return category && city ? `/location-${category.slug}/${city}` : undefined;
}

export function catalogueGroups(leases: PublicLease[]) {
  const groups = new Map<string, { path: string; city: string; category: typeof categories[number]; count: number }>();
  for (const lease of leases) {
    for (const category of categories.filter((item) => categoryMatches(lease, item))) {
      for (const area of areasFor(lease)) {
        const path = `/location-${category.slug}/${area.slug}`;
        const previous = groups.get(path);
        if (previous) previous.count++;
        else groups.set(path, { path, city: area.name, category, count: 1 });
      }
    }
  }
  return [...groups.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function photos(lease: PublicLease, apiBase: string): string[] {
  if (!Array.isArray(lease.photoUrls)) return [];
  return lease.photoUrls.flatMap((photo) => {
    if (typeof photo !== 'string' || !photo.trim()) return [];
    try {
      const url = new URL(photo, `${apiBase}/`);
      return url.protocol === 'https:' && !url.username && !url.password ? [catalogueImageUrl(url)] : [];
    } catch { return []; }
  });
}

export function coverPhoto(lease: PublicLease, apiBase: string) {
  return photos(lease, apiBase)[0] || DEFAULT_IMAGE;
}

export function rentalPeriod(lease: PublicLease) {
  const periods: Record<string, { label: string; unit: string }> = {
    DAILY: { label: 'jour', unit: 'DAY' },
    HOURLY: { label: 'heure', unit: 'HUR' },
    WEEKLY: { label: 'semaine', unit: 'WEE' },
    MONTHLY: { label: 'mois', unit: 'MON' },
  };
  return periods[String(lease.periodType ?? '').toUpperCase()] || { label: 'période', unit: undefined };
}

export function leasePrice(lease: PublicLease) {
  const value = numeric(lease.priceByPeriod);
  return value !== undefined && value >= 0 ? value : undefined;
}

export function leaseRating(lease: PublicLease) {
  const value = numeric(lease.averageRating);
  const count = numeric(lease.reviewCount);
  return value !== undefined && value >= 1 && value <= 5 && count !== undefined && Number.isSafeInteger(count) && count > 0
    ? { value, count } : undefined;
}

export const formatMoney = (value: number) => new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);

export const apiBaseUrl = (env: { GOODLEASE_API_BASE_URL?: string }) =>
  (env.GOODLEASE_API_BASE_URL || DEFAULT_API).replace(/\/+$/, '');

/** Only allowlisted public data can enter rendered HTML. */
export async function fetchCatalogue(apiBase: string, limit?: number): Promise<PublicLease[]> {
  const leases = new Map<string, PublicLease>();
  const size = 100;
  let fetched = 0;
  const seenIds = new Set<string>();
  // Bound upstream work. Never pretend a truncated catalogue is complete.
  for (let page = 0; page < 40; page++) {
    const response = await fetch(`${apiBase}/api/leases?page=${page}&size=${size}`, {
      headers: { Accept: 'application/json', 'X-GoodLease-Client': 'web-public-catalogue' },
      redirect: 'manual', signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error('Catalogue unavailable');
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) throw new TypeError('Expected a lease array');
    // Count withdrawn records too: filtering them must not hide broken pagination.
    const items = sanitizePublicPayload(raw, 'account-lease-list') as PublicLease[];
    if (items.length !== raw.length) throw new Error('Invalid catalogue record');
    fetched += raw.length;
    for (const item of items) {
      const id = leaseId(item);
      if (!id || seenIds.has(id)) throw new Error('Catalogue pagination did not advance');
      seenIds.add(id);
      if (item.available === true) leases.set(id, item);
    }
    if (limit !== undefined && leases.size >= limit) return [...leases.values()].slice(0, limit);
    const pageCount = numeric(response.headers.get('X-Total-Pages'));
    const total = numeric(response.headers.get('X-Total-Count'));
    const morePages = pageCount !== undefined && Number.isInteger(pageCount) && pageCount > 0
      ? page + 1 < pageCount
      : total !== undefined && total >= 0 ? fetched < total : raw.length === size;
    if ((total !== undefined && (fetched > total || (!morePages && fetched !== total))) ||
        (morePages && (!raw.length || fetched === total))) {
      throw new Error('Catalogue pagination is inconsistent');
    }
    if (!morePages) return [...leases.values()];
  }
  throw new Error('Catalogue pagination limit reached');
}
