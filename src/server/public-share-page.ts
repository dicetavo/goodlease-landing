import { DEFAULT_API, DEFAULT_IMAGE, SITE_URL, renderPublicPage, type PublicShareEnv, type PageMeta } from './public-html';
import { sanitizePublicPayload } from './webapp-api-policy';
import { categoryFor, cityPagePath, formatMoney, leaseId, leasePath, leasePrice, leaseRating, photos, rentalPeriod } from './public-catalogue';
import { breadcrumbSchema } from './catalogue-pages';
import { leaseBody, errorBody } from './catalogue-html';
export type { PublicShareEnv } from './public-html';

type ShareKind = 'annonce' | 'profil';

type JsonRecord = Record<string, unknown>;

interface ShareContext {
  request: Request;
  params: Record<string, string | string[]>;
  env: PublicShareEnv;
}

interface EntityResult {
  data?: JsonRecord;
  status: number;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, fallback = '', max = 220) => {
  const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!clean) return fallback;
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
};

const number = (value: unknown) => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const publicImage = (value: unknown, apiBase: string) => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value, `${apiBase}/`);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
};

async function fetchEntity(apiBase: string, kind: ShareKind, id: string): Promise<EntityResult> {
  const endpoint = kind === 'annonce' ? `api/leases/${id}` : `api/client/${id}`;
  try {
    const response = await fetch(`${apiBase}/${endpoint}`, {
      headers: {
        Accept: 'application/json',
        'X-GoodLease-Client': 'web-share-preview',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) return { status: response.status === 404 ? 404 : 503 };
    const body: unknown = await response.json();
    const data = sanitizePublicPayload(body, kind === 'annonce' ? 'lease' : 'profile');
    if (!isRecord(data) || (kind === 'annonce' && leaseId(data) !== id)) return { status: 503 };
    return { data, status: 200 };
  } catch (error) {
    return { status: error instanceof RangeError ? 404 : 503 };
  }
}

function fallbackMeta(kind: ShareKind, id: string, status: number): PageMeta {
  const canonical = `${SITE_URL}/${kind}/${id}`;
  const label = kind === 'annonce' ? 'Annonce' : 'Profil';
  const missing = status === 404;
  const title = missing ? `${label} introuvable · GoodLease` : `${label} GoodLease`;
  const description = missing
    ? `Ce ${kind === 'annonce' ? 'matériel' : 'profil'} n’est plus disponible sur GoodLease.`
    : `Découvrez ce ${kind === 'annonce' ? 'matériel à louer' : 'loueur'} sur GoodLease.`;

  return {
    title,
    description,
    canonical,
    image: DEFAULT_IMAGE,
    imageAlt: 'GoodLease — location de matériel',
    ogType: 'website',
    robots: 'noindex,follow',
    schema: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      description,
      url: canonical,
    },
  };
}

function leaseMeta(data: JsonRecord, id: string, apiBase: string): PageMeta {
  const canonical = `${SITE_URL}${leasePath(data)}`;
  const name = text(data.title, 'Matériel à louer', 100);
  const rawDescription = text(data.description, '', 115);
  const price = leasePrice(data);
  const period = rentalPeriod(data);
  const rating = leaseRating(data);
  const address = isRecord(data.address) ? data.address : {};
  const city = text(address.city, '', 80);
  const summary = [
    price === undefined ? 'Matériel à louer' : `${formatMoney(price)} / ${period.label}`,
    city ? `à ${city}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const description = text(`${rawDescription || name} — ${summary} sur GoodLease.`, '', 155);
  const images = photos(data, apiBase).map((image) => new URL(image, SITE_URL).href);
  const image = images[0] || DEFAULT_IMAGE;

  return {
    title: `${name} à louer${city ? ` à ${city}` : ''}${price === undefined ? '' : ` — ${formatMoney(price)}/${period.label}`} · GoodLease`,
    description,
    canonical,
    appLink: `${SITE_URL}/annonce/${id}`,
    image,
    imageAlt: `${name}, matériel proposé à la location sur GoodLease`,
    ogType: 'product',
    robots: 'index,follow,max-image-preview:large',
    productPrice: price === undefined ? undefined : price.toFixed(2),
    schema: {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Product',
      name,
      description: typeof data.description === 'string' && data.description.trim() ? data.description : description,
      image: images.length ? images : [image],
      ...(rating ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: rating.value, reviewCount: rating.count, bestRating: 5, worstRating: 1 } } : {}),
      url: canonical,
      ...(price === undefined
        ? {}
        : {
            offers: {
              '@type': 'Offer',
              price: price.toFixed(2),
              priceCurrency: 'EUR',
              availability: 'https://schema.org/InStock',
              businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
              ...(period.unit ? { priceSpecification: {
                '@type': 'UnitPriceSpecification', price: price.toFixed(2), priceCurrency: 'EUR',
                referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: period.unit },
              } } : {}),
              url: canonical,
              ...(city ? { areaServed: { '@type': 'City', name: city } } : {}),
              ...(/^[1-9]\d{0,18}$/.test(String(data.clientId || '')) ? { seller: { '@type': 'Person', url: `${SITE_URL}/profil/${data.clientId}` } } : {}),
            },
          }),
      }, breadcrumbSchema([
        { name: 'Accueil', path: '/' }, { name: 'Catalogue', path: '/catalogue' },
        ...(cityPagePath(data) ? [{ name: `${categoryFor(data)!.name} à ${city}`, path: cityPagePath(data)! }] : []),
        { name, path: leasePath(data) },
      ])],
    },
  };
}

function profileMeta(data: JsonRecord, id: string, apiBase: string): PageMeta {
  const canonical = `${SITE_URL}/profil/${id}`;
  const username = text(data.username, 'Membre GoodLease', 80);
  const listingsCount = number(data.listingsCount);
  const reviewsCount = number(data.reviewsCount);
  const descriptionParts = [`Découvrez le profil de ${username} sur GoodLease.`];
  if (listingsCount !== undefined) {
    descriptionParts.push(`${listingsCount} annonce${listingsCount > 1 ? 's' : ''} publiée${listingsCount > 1 ? 's' : ''}.`);
  }
  if (reviewsCount !== undefined) {
    descriptionParts.push(`${reviewsCount} avis reçu${reviewsCount > 1 ? 's' : ''}.`);
  }
  const image = publicImage(data.photoProfilUrl, apiBase) || DEFAULT_IMAGE;
  const description = text(descriptionParts.join(' '), '', 210);

  return {
    title: `${username} sur GoodLease`,
    description,
    canonical,
    image,
    imageAlt: `Profil de ${username} sur GoodLease`,
    ogType: 'profile',
    robots: 'index,follow,max-image-preview:large',
    schema: {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      name: `${username} sur GoodLease`,
      description,
      url: canonical,
      mainEntity: {
        '@type': 'Person',
        name: username,
        url: canonical,
        ...(image === DEFAULT_IMAGE ? {} : { image }),
      },
    },
  };
}

export async function renderPublicSharePage(context: ShareContext, kind: ShareKind) {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const rawId = context.params.id;
  const id = Array.isArray(rawId) ? '' : String(rawId || '');
  const validId = /^[1-9]\d{0,18}$/.test(id);
  const apiBase = (context.env.GOODLEASE_API_BASE_URL || DEFAULT_API).replace(/\/$/, '');
  let status = validId ? 200 : 404;
  let meta = fallbackMeta(kind, id || 'inconnu', status);
  let data: JsonRecord | undefined;

  if (validId) {
    const entity = await fetchEntity(apiBase, kind, id);
    status = entity.status;
    data = entity.data;
    if (entity.data && kind === 'annonce' && entity.data.available !== true) status = 404;
    meta =
      status === 200 && entity.data
        ? kind === 'annonce'
          ? leaseMeta(entity.data, id, apiBase)
          : profileMeta(entity.data, id, apiBase)
        : fallbackMeta(kind, id, status);
  }

  if (status === 200 && data && kind === 'annonce') {
    const url = new URL(context.request.url);
    const targetPath = url.pathname.startsWith('/materiel/') ? leasePath(data) : `/annonce/${id}`;
    if (url.pathname !== targetPath) {
      url.pathname = targetPath;
      return new Response(null, { status: 301, headers: { Location: url.href } });
    }
  }

  const body = kind === 'annonce' ? (status === 200 && data ? leaseBody(data, apiBase) : errorBody(status)) : undefined;
  return renderPublicPage(context, meta, status, body);
}
