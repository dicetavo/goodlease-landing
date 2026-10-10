import { routes, stores, pageHref } from '../config';
import { escapeHtml as esc } from './public-html';
import {
  catalogueGroups, categoryFor, cityName, cityPagePath, coverPhoto, formatMoney,
  leaseId, leasePath, leasePrice, leaseRating, photos, rentalPeriod, type PublicLease,
} from './public-catalogue';

const nameOf = (lease: PublicLease) => typeof lease.title === 'string' && lease.title.trim() ? lease.title : 'Matériel à louer';
const priceOf = (lease: PublicLease) => {
  const price = leasePrice(lease);
  return price === undefined ? 'Tarif à consulter' : `${formatMoney(price)} / ${rentalPeriod(lease).label}`;
};

export function listingCards(leases: PublicLease[], apiBase: string) {
  if (!leases.length) return '<p class="col-span-full rounded-card border border-line bg-canvas p-8 text-center text-muted">Aucune annonce publiée pour le moment.</p>';
  return leases.map((lease, index) => {
    const id = leaseId(lease);
    if (!id) return '';
    const name = nameOf(lease);
    const rating = leaseRating(lease);
    return `<article class="overflow-hidden rounded-card border border-line bg-surface shadow-soft">
      <a href="${leasePath(lease)}" class="block h-full text-ink">
        <img src="${esc(coverPhoto(lease, apiBase))}" alt="${esc(name)}" width="640" height="480" loading="${index < 4 ? 'eager' : 'lazy'}" class="aspect-[4/3] w-full object-cover bg-canvas" />
        <div class="p-5"><p class="text-xs text-muted">${esc(categoryFor(lease)?.name || 'Matériel')}</p>
          <h3 class="mt-2 text-base font-semibold break-words">${esc(name)}</h3>
          <p class="mt-2 text-sm text-muted">${esc(cityName(lease) || 'Ville non précisée')}</p>
          <p class="mt-3 text-sm font-semibold">${esc(priceOf(lease))}</p>
          ${rating ? `<p class="mt-2 text-xs text-muted">${rating.value.toLocaleString('fr-FR')} / 5 · ${rating.count} avis</p>` : ''}
        </div>
      </a></article>`;
  }).join('');
}

export function locationLinks(leases: PublicLease[], currentPath = '') {
  return catalogueGroups(leases).filter((group) => group.path !== currentPath && group.count >= 3).map((group) =>
    `<a class="rounded-full border border-line bg-surface px-4 py-2 text-sm text-primary hover:underline" href="${group.path}">${esc(group.category.name)} à ${esc(group.city)} (${group.count})</a>`,
  ).join('');
}

export function unavailableCatalogue() {
  return `<p class="col-span-full rounded-card border border-line bg-canvas p-8 text-center text-muted">Le catalogue est momentanément indisponible. Réessayez dans quelques instants ou <a class="font-semibold text-primary underline" href="${pageHref(routes.app)}">ouvrez l’application</a>.</p>`;
}

export function leaseBody(lease: PublicLease, apiBase: string) {
  const id = leaseId(lease)!;
  const name = nameOf(lease);
  const city = cityName(lease);
  const category = categoryFor(lease);
  const locationPath = cityPagePath(lease);
  const images = photos(lease, apiBase);
  const rating = leaseRating(lease);
  const description = typeof lease.description === 'string' ? lease.description : '';
  return `<section class="container-gl py-10 sm:py-16" data-track-item="${id}" data-track-category="${esc(category?.name || 'Matériel')}" data-track-city="${esc(city)}" data-track-price="${leasePrice(lease) ?? ''}">
    <nav aria-label="Fil d’Ariane" class="flex flex-wrap gap-2 text-sm text-muted"><a class="text-primary hover:underline" href="${routes.home}">Accueil</a><span aria-hidden="true">/</span><a class="text-primary hover:underline" href="/catalogue">Catalogue</a>
    ${locationPath ? `<span aria-hidden="true">/</span><a class="text-primary hover:underline" href="${locationPath}">${esc(category!.name)} à ${esc(city)}</a>` : ''}</nav>
    <div class="mt-8 grid gap-10 lg:grid-cols-2">
      <div>${images.length ? images.map((image, index) => `<img src="${esc(image)}" alt="${esc(name)}${index ? ` — photo ${index + 1}` : ''}" width="800" height="600" loading="${index ? 'lazy' : 'eager'}" class="mb-4 aspect-[4/3] w-full rounded-card bg-surface object-contain" />`).join('') : `<img src="${esc(coverPhoto(lease, apiBase))}" alt="GoodLease — matériel à louer" width="800" height="600" class="w-full rounded-card" />`}</div>
      <div class="min-w-0">
        <p class="eyebrow">${esc(category?.name || 'Matériel en location')}</p>
        <h1 class="mt-4 text-3xl sm:text-4xl break-words">${esc(name)}</h1>
        <p class="mt-3 text-muted">${esc(city || 'Ville non précisée')}</p>
        <p class="mt-6 text-2xl font-semibold">${esc(priceOf(lease))}</p>
        ${rating ? `<p class="mt-3 text-sm">Note : ${rating.value.toLocaleString('fr-FR')} / 5 (${rating.count} avis)</p>` : ''}
        <p class="mt-3 text-sm text-muted">Matériel proposé à la location. Les disponibilités pour vos dates sont à vérifier dans l’application.</p>
        <h2 class="mt-8 text-xl">Description du matériel</h2>
        <p class="mt-3 whitespace-pre-wrap break-words leading-relaxed text-muted">${esc(description || 'Contactez le loueur pour en savoir plus sur ce matériel.')}</p>
        <h2 class="mt-8 text-xl">Préparer votre location</h2>
        <p class="mt-3 leading-relaxed text-muted">Avant de réserver, confirmez les quantités, les accessoires et les disponibilités avec le loueur. Prévoyez le retrait et la restitution du matériel, puis consultez le dépôt de garantie et les conditions du bail dans GoodLease.</p>
        <div class="mt-8 flex flex-wrap gap-3">
          <a class="btn-primary" href="${pageHref(routes.app)}?open=annonce&amp;id=${id}&amp;web=1">Voir les disponibilités</a>
          <a class="btn-secondary" href="goodlease://annonce/${id}">Ouvrir dans l’app mobile</a>
        </div>
        <p class="mt-5 text-sm text-muted">Télécharger GoodLease : <a class="text-primary underline" href="${esc(stores.appStore)}">App Store</a> · <a class="text-primary underline" href="${esc(stores.playStore)}">Google Play</a></p>
      </div>
    </div>
  </section>`;
}

export function errorBody(status: number) {
  return `<section class="container-gl py-20"><h1 class="text-3xl">${status === 404 ? 'Annonce introuvable' : 'Annonce momentanément indisponible'}</h1>
    <p class="mt-4 text-muted">${status === 404 ? 'Cette annonce n’est pas ou plus publiée sur GoodLease.' : 'Le catalogue ne répond pas pour le moment. Réessayez dans quelques instants.'}</p>
    <a class="btn-primary mt-6" href="/catalogue">Explorer le catalogue</a></section>`;
}
