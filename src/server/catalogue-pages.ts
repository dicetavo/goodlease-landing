import { site } from '../config';
import {
  apiBaseUrl, areasFor, catalogueGroups, categories, categoryBySlug, categoryMatches,
  fetchCatalogue, formatMoney, inArea, leaseLastmod, leasePath, leasePrice, type PublicLease,
} from './public-catalogue';
import { MIN_INDEXABLE_LISTINGS, type RentalCategory } from './catalogue-content';
import { listingCards, locationLinks, unavailableCatalogue } from './catalogue-html';
import { DEFAULT_IMAGE, escapeHtml as esc, renderPublicPage, type PublicPageContext, type PageMeta } from './public-html';

export const methodNotAllowed = () => new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
type Selection = { path: string; category?: RentalCategory; city?: string; wedding?: boolean };

export function catalogueSelection(rawPath: string): Selection | undefined {
  const path = rawPath.replace(/\/+$/, '');
  if (path === '/catalogue') return { path };
  if (path === '/location-materiel-mariage') return { path, wedding: true };
  const match = /^\/location-([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?$/.exec(path);
  if (!match) return undefined;
  if (match[1] === 'materiel' && match[2]) return { path, city: match[2] };
  const category = categoryBySlug(match[1]);
  return category ? { path: `/location-${category.slug}${match[2] ? `/${match[2]}` : ''}`, category, city: match[2] } : undefined;
}

const matchingLeases = (leases: PublicLease[], selection: Selection) => leases.filter((lease) =>
  (!selection.category || categoryMatches(lease, selection.category)) &&
  (!selection.city || inArea(lease, selection.city)) &&
  (!selection.wedding || [1, 2, 3, 4, 5, 6, 9].includes(Number(lease.categoryId))),
);

export const breadcrumbSchema = (items: { name: string; path: string }[]) => ({
  '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({
    '@type': 'ListItem', position: index + 1, name: item.name, item: `${site.url}${item.path}`,
  })),
});

function categoryEditorial(category: RentalCategory, leases: PublicLease[]) {
  const prices = leases.filter((lease) => lease.periodType === 'DAILY').map(leasePrice).filter((price): price is number => price !== undefined);
  const range = prices.length ? `Les tarifs à la journée des annonces de cette sélection vont de ${formatMoney(Math.min(...prices))} à ${formatMoney(Math.max(...prices))}. Le prix total dépend de la durée et des conditions de l’annonce.` : 'Les tarifs et leur période de facturation sont indiqués sur chaque annonce. Comparez le prix pour la durée dont vous avez besoin.';
  const questions = [
    { question: `Comment choisir votre location ${category.subject} ?`, answer: category.checks },
    { question: `Quel est le prix d’une location ${category.subject} ?`, answer: range },
    { question: 'Comment vérifier la disponibilité et réserver ?', answer: 'Ouvrez la fiche de l’annonce et choisissez vos dates dans GoodLease. Confirmez les accessoires, le retrait et la restitution avec le loueur. La réservation et le paiement se finalisent dans l’application mobile.' },
  ];
  return {
    html: `<section class="mt-14 max-w-3xl"><h2 class="text-2xl">Bien préparer votre location ${esc(category.subject)}</h2>
      <p class="mt-4 leading-relaxed text-muted">${esc(category.intro)} La location entre particuliers et professionnels vous permet de choisir ${esc(category.examples)} selon votre besoin et la durée de votre événement.</p>
      <p class="mt-4 leading-relaxed text-muted">${esc(category.checks)} Prévoyez suffisamment de temps pour le retrait, le montage et la restitution. Le contenu de chaque annonce fait foi pour les accessoires inclus ; vérifiez les quantités nécessaires avant de confirmer.</p>
      <p class="mt-4 leading-relaxed text-muted">${esc(range)} Les annonces présentes ici sont publiées dans le catalogue, mais les disponibilités exactes pour vos dates restent à vérifier. Consultez le dépôt de garantie et les conditions du bail avant de vous engager.</p>
      <h2 class="mt-10 text-2xl">Questions sur la location ${esc(category.subject)}</h2>
      ${questions.map((item) => `<details class="mt-4 rounded-card border border-line bg-surface p-5"><summary class="cursor-pointer font-semibold">${esc(item.question)}</summary><p class="mt-3 leading-relaxed text-muted">${esc(item.answer)}</p></details>`).join('')}</section>`,
    schema: { '@type': 'FAQPage', mainEntity: questions.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) },
  };
}

function hubLinks(leases: PublicLease[]) {
  const categoryLinks = categories.filter((category) => leases.some((lease) => categoryMatches(lease, category))).map((category) =>
    `<a class="btn-secondary" href="/location-${category.slug}">${esc(category.name)}</a>`).join('');
  const areas = new Map(leases.flatMap(areasFor).map((area) => [area.slug, area]));
  const cityLinks = [...areas.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((area) =>
    `<a class="rounded-full border border-line bg-surface px-4 py-2 text-sm text-primary hover:underline" href="/location-materiel/${area.slug}">${esc(area.label)}</a>`).join('');
  return `<h2 class="mt-10 text-2xl">Louer par catégorie</h2><div class="mt-5 flex flex-wrap gap-3">${categoryLinks}</div>
    <h2 class="mt-10 text-2xl">Louer par ville et zone</h2><div class="mt-5 flex flex-wrap gap-3">${cityLinks}</div>
    <p class="mt-6"><a class="text-primary underline" href="/location-materiel-mariage">Matériel à louer pour un mariage</a></p>`;
}

export async function renderCataloguePage(context: PublicPageContext, rawPath = '/catalogue') {
  if (!['GET', 'HEAD'].includes(context.request.method)) return methodNotAllowed();
  const selection = catalogueSelection(rawPath);
  if (selection && new URL(context.request.url).pathname !== selection.path) {
    const target = new URL(context.request.url); target.pathname = selection.path;
    return new Response(null, { status: 301, headers: { Location: target.href } });
  }
  const path = selection?.path || rawPath.replace(/\/$/, '');
  const apiBase = apiBaseUrl(context.env);
  let status = 200;
  let title = 'Location de matériel événementiel par catégorie et ville';
  let heading = title;
  let description = 'Louez du matériel événementiel entre particuliers et pros : sonorisation, éclairage, tentes, décoration et mobilier. Explorez les annonces par ville.';
  let content = '';
  let matching: PublicLease[] = [];
  let faqSchema: Record<string, unknown> | undefined;
  let indexable = false;
  const crumbs = [{ name: 'Accueil', path: '/' }, { name: 'Catalogue', path: '/catalogue' }];
  try {
    const leases = await fetchCatalogue(apiBase);
    matching = selection ? matchingLeases(leases, selection) : [];
    if (!selection || (path !== '/catalogue' && !matching.length)) {
      status = 404; title = heading = 'Aucune page de location à cette adresse';
      description = 'Cette sélection ne correspond à aucune annonce publiée. Retrouvez le matériel disponible dans le catalogue GoodLease.';
      content = '<a class="btn-primary mt-8" href="/catalogue">Explorer le catalogue</a>';
    } else {
      indexable = path === '/catalogue' || matching.length >= MIN_INDEXABLE_LISTINGS;
      const area = selection.city ? leases.flatMap(areasFor).find((item) => item.slug === selection.city) : undefined;
      if (selection.category) {
        heading = `Location ${selection.category.subject}${area ? ` à ${area.name} et alentours` : ' entre particuliers et pros'}`;
        title = `${heading.replace(' et alentours', '')} : ${matching.length} annonce${matching.length > 1 ? 's' : ''}`;
        description = `${matching.length} annonce${matching.length > 1 ? 's' : ''} ${selection.category.subject} à louer${area ? ` à ${area.name} et alentours` : ' près de chez vous'}. Comparez les tarifs et réservez dans GoodLease.`;
        const editorial = categoryEditorial(selection.category, matching); faqSchema = editorial.schema;
        content = `<p class="mt-5 max-w-3xl leading-relaxed text-muted">${esc(selection.category.intro)}</p>`;
        if (selection.city) crumbs.push({ name: selection.category.name, path: `/location-${selection.category.slug}` });
        content += `<h2 class="mt-10 text-2xl">${matching.length} annonce${matching.length > 1 ? 's' : ''} ${area ? `à ${esc(area.name)} et alentours` : 'disponible' + (matching.length > 1 ? 's' : '')}</h2>
          <div class="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">${listingCards(matching, apiBase)}</div>${editorial.html}`;
      } else {
        if (area) {
          heading = title = `Location de matériel événementiel à ${area.name} et alentours`;
          description = `${matching.length} annonces de matériel à louer dans la zone ${area.label}. Sono, éclairage, décoration et mobilier : comparez les offres GoodLease.`;
          content = `<p class="mt-5 max-w-3xl leading-relaxed text-muted">Cette page regroupe les communes de la zone ${esc(area.label)}. Le lieu de retrait réel figure sur chaque annonce : confirmez-le avec le loueur.</p>`;
        } else if (selection.wedding) {
          heading = title = 'Location de matériel pour un mariage';
          description = 'Louez sono, éclairage, tentes, décoration, vaisselle et mobilier pour votre mariage. Comparez les annonces et confirmez vos dates avec les loueurs.';
          content = '<p class="mt-5 max-w-3xl leading-relaxed text-muted">Préparez la cérémonie, le repas et la soirée de votre mariage avec du matériel en location. Cette sélection regroupe les catégories utiles à une réception ; vérifiez les quantités, les accessoires et les disponibilités auprès de chaque loueur.</p>';
        }
        content += `${hubLinks(matching)}<h2 class="mt-12 text-2xl">Les annonces disponibles</h2><div class="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">${listingCards(matching, apiBase)}</div>`;
      }
      if (path !== '/catalogue') crumbs.push({ name: heading, path });
      content += `<h2 class="mt-12 text-xl">Explorer d’autres locations</h2><div class="mt-5 flex flex-wrap gap-3">${locationLinks(leases, path)}</div>`;
    }
  } catch {
    status = 503; title = heading = 'Catalogue momentanément indisponible';
    description = 'Le catalogue GoodLease ne répond pas pour le moment. Réessayez dans quelques instants.';
    content = `<div class="mt-8">${unavailableCatalogue()}</div>`;
  }
  const canonical = `${site.url}${path}`;
  const collection = { '@type': 'CollectionPage', name: heading, description, url: canonical,
    ...(status === 200 ? { mainEntity: { '@type': 'ItemList', numberOfItems: matching.length,
      itemListElement: matching.map((lease, index) => ({ '@type': 'ListItem', position: index + 1, url: `${site.url}${leasePath(lease)}` })),
    } } : {}),
  };
  const meta: PageMeta = {
    title: `${title} · GoodLease`, description, canonical, image: DEFAULT_IMAGE,
    imageAlt: 'GoodLease — location de matériel', ogType: 'website',
    robots: status === 200 && indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow',
    schema: { '@context': 'https://schema.org', '@graph': [collection, breadcrumbSchema(crumbs), ...(faqSchema ? [faqSchema] : [])] },
  };
  const body = `<section class="container-gl py-12 sm:py-16"><nav aria-label="Fil d’Ariane" class="flex flex-wrap gap-2 text-sm text-primary">${crumbs.map((crumb, index) => `${index ? '<span aria-hidden="true">/</span>' : ''}<a href="${crumb.path}">${esc(crumb.name)}</a>`).join('')}</nav>
    <h1 class="mt-6 text-3xl sm:text-4xl break-words">${esc(heading)}</h1><p class="mt-4 max-w-3xl text-muted">${esc(description)}</p>${content}</section>`;
  return renderPublicPage(context, meta, status, body);
}

export async function renderCatalogueSitemap(context: PublicPageContext) {
  if (!['GET', 'HEAD'].includes(context.request.method)) return methodNotAllowed();
  try {
    const leases = await fetchCatalogue(apiBaseUrl(context.env));
    const paths = new Map<string, PublicLease[]>([['/catalogue', leases]]);
    for (const lease of leases) paths.set(leasePath(lease), [lease]);
    const selections = new Set([
      ...categories.map((category) => `/location-${category.slug}`),
      ...catalogueGroups(leases).filter((group) => group.count >= MIN_INDEXABLE_LISTINGS).map((group) => group.path),
      ...leases.flatMap(areasFor).map((area) => `/location-materiel/${area.slug}`), '/location-materiel-mariage',
    ]);
    for (const path of selections) {
      const matching = matchingLeases(leases, catalogueSelection(path)!);
      if (matching.length >= MIN_INDEXABLE_LISTINGS) paths.set(path, matching);
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...paths].map(([path, items]) => {
      const dates = items.map(leaseLastmod).filter((date): date is string => Boolean(date)).sort();
      const lastmod = dates.length === items.length && dates.length ? dates.at(-1) : undefined;
      return `<url><loc>${esc(`${site.url}${path}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
    }).join('')}</urlset>`;
    return new Response(context.request.method === 'HEAD' ? null : xml, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300, must-revalidate', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return new Response(context.request.method === 'HEAD' ? null : 'Catalogue temporairement indisponible.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' },
    });
  }
}

export async function renderCatalogueHome(context: PublicPageContext) {
  if (!['GET', 'HEAD'].includes(context.request.method)) return methodNotAllowed();
  const apiBase = apiBaseUrl(context.env);
  const shell = await context.env.ASSETS.fetch(new Request(new URL('/', context.request.url)));
  if (!shell.ok) return shell;
  let cards: string; let links = ''; let failed = false;
  try {
    const leases = await fetchCatalogue(apiBase);
    cards = listingCards(leases.slice(0, 8), apiBase); links = locationLinks(leases);
  } catch { cards = unavailableCatalogue(); failed = true; }
  const headers = new Headers(shell.headers);
  headers.delete('Content-Length'); headers.delete('ETag'); headers.delete('Last-Modified');
  headers.set('Cache-Control', failed ? 'no-store' : 'public, max-age=30, s-maxage=60, must-revalidate');
  headers.set('Content-Type', 'text/html; charset=utf-8'); headers.set('Content-Language', 'fr');
  interface Element { setInnerContent(html: string, options: { html: boolean }): void }
  interface HtmlRewriter { on(selector: string, handlers: { element(element: Element): void }): HtmlRewriter; transform(response: Response): Response }
  const Rewriter = (globalThis as unknown as { HTMLRewriter: new () => HtmlRewriter }).HTMLRewriter;
  const response = new Rewriter()
    .on('#landing-live-listings', { element(element: Element) { element.setInnerContent(cards, { html: true }); } })
    .on('#landing-location-links', { element(element: Element) { element.setInnerContent(links, { html: true }); } })
    .transform(new Response(shell.body, { headers }));
  return context.request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response;
}
