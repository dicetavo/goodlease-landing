import { trackEvent } from './marketing-consent.ts';
import { webAnalyticsHeaders, identifyWebAnalytics } from './web-analytics-context.ts';
import { webMarketingHeaders } from './web-marketing-context.ts';
import { catalogueImageUrl } from '../server/catalogue-image.ts';

type JsonRecord = Record<string, unknown>;

type Listing = {
  id: string | number;
  clientId?: number;
  title: string;
  category?: string;
  categoryId?: number;
  city?: string;
  distanceKm?: number;
  priceByPeriod?: number;
  bail?: number;
  caution?: number;
  averageRating?: number;
  reviewCount?: number;
  photoUrls?: string[];
  description?: string;
  quantity?: number;
  handoutOption?: string;
  condition?: string;
  identityVerified?: boolean;
  state?: string;
  available?: boolean;
  periodType?: string;
  createdAt?: string;
  likeCount?: number;
  address?: { city?: string };
  isDemo?: boolean;
};

type Session = {
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  username?: string;
  email?: string;
  roles?: string[];
  needsUsername?: boolean;
};

type Client = {
  id: number;
  username?: string;
  displayName?: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  vatNumber?: string;
  birthDate?: string;
  photoProfilUrl?: string;
  reviewsCount?: number;
  listingsCount?: number;
  averageRating?: number;
  identityVerified?: boolean;
  memberSince?: string;
};

type Chat = {
  id: number;
  leaseId?: number;
  otherParticipantId?: number;
  receiverId?: number;
  otherParticipantName?: string;
  receiverName?: string;
  lastMessage?: string;
  lastMessageTimestamp?: number;
  lastMessageTime?: string;
  unreadCount?: number;
};

type Message = {
  id?: number;
  content?: string;
  date?: string;
  expediteurId?: number;
  destinateurId?: number;
  chatId?: number;
};

const SITE_ORIGIN = 'https://goodlease.fr';
const APP_STORE_URL = 'https://apps.apple.com/fr/app/good-lease-location-mat%C3%A9riel/id6758953661';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.goodlease.app';
const protectedRoutes = new Set(['reservations', 'annonces', 'messages', 'portefeuille', 'notifications', 'profil']);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const JAVA_INTEGER_MAX = 2_147_483_647;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseListingInteger(value: unknown, label: string, minimum: number): number {
  const text = typeof value === 'string' ? value.trim() : '';
  const parsed = Number(text);
  if (!text || !Number.isSafeInteger(parsed) || parsed < minimum || parsed > JAVA_INTEGER_MAX) {
    throw new Error(`${label} doit être un nombre entier compris entre ${minimum} et ${JAVA_INTEGER_MAX}.`);
  }
  return parsed;
}

export function dateOnlyToUtcMidnight(value: unknown, label: string): string {
  const dateOnly = typeof value === 'string' ? value.trim() : '';
  if (!DATE_ONLY_PATTERN.test(dateOnly)) throw new Error(`${label} est invalide.`);
  const instant = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== dateOnly) {
    throw new Error(`${label} est invalide.`);
  }
  return instant.toISOString();
}

export function extractCreatedLeaseId(value: unknown): number | undefined {
  if (!isRecord(value) || value.success !== true || !isRecord(value.lease)) return undefined;
  const id = Number(value.lease.id);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

const asArray = (value: unknown): JsonRecord[] => {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.content)) return value.content.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.notifications)) return value.notifications.filter(isRecord);
  return [];
};

export function mountGoodLeaseWebApp() {
  const root = document.querySelector<HTMLElement>('.webapp');
  if (!root || root.dataset.mounted === 'true') return;
  root.dataset.mounted = 'true';

  const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector);
  const googleClientId = root.dataset.googleClientId || '';
  const fallbackListings: Listing[] = JSON.parse(root.dataset.demoListings || '[]').map((item: Listing) => ({
    ...item,
    isDemo: true,
  }));
  const listingGrid = $<HTMLElement>('#listing-grid')!;
  const resultsLabel = $<HTMLElement>('#results-label')!;
  const dataMode = $<HTMLElement>('#data-mode')!;
  let listings: Listing[] = [];
  let filteredListings: Listing[] = [];
  let catalogBase: Listing[] = [];
  let hasLiveCatalogBase = false;
  let wizardStep = 1;
  let selectedListing: Listing | null = null;
  let currentClient: Client | null = null;
  let chats: Chat[] = [];
  let activeChat: Chat | null = null;
  let accountLoading: Promise<void> | null = null;
  let pendingRegistrationEmail = '';
  let geo: { latitude: number; longitude: number } | null = null;
  let activeProfileListings: Listing[] = [];
  const favorites = new Set<string>(JSON.parse(localStorage.getItem('goodlease:favorites') || '[]'));
  let session: Session = JSON.parse(sessionStorage.getItem('goodlease:session') || '{}');
  const profileCache = new Map<string, { profile: JsonRecord; listings: Listing[]; markup: string }>();
  const catalogCache = new Map<string, Listing[]>();
  let catalogRequestId = 0;
  const CATALOG_STORAGE_KEY = 'goodlease:catalog:v1';
  const CATALOG_STORAGE_MAX_AGE = 10 * 60 * 1000;

  const money = (value = 0) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
  const categoryNames: Record<number, string> = { 1: 'Sonorisation', 2: 'Éclairage', 3: 'Tentes et barnums', 4: 'Photo & vidéo', 5: 'Décoration et réception', 6: 'Nappes et linge de table', 7: 'Transport', 8: 'Divers', 9: 'Mobilier' };
  const categoryRefs: Record<number, [string, string]> = { 1: ['sound', 'Son'], 2: ['light', 'Lumieres'], 3: ['struc', 'Structures'], 4: ['video', 'Video'], 5: ['place', 'Reception'], 6: ['clothe', 'Textile'], 7: ['whip', 'Transport'], 8: ['divers', 'Divers'], 9: ['furnit', 'Mobilier'] };
  const categoryOf = (listing: Listing) => listing.category || categoryNames[listing.categoryId || 0] || 'Matériel';
  const depositOf = (listing: Listing | null | undefined) => listing?.caution ?? listing?.bail ?? 0;
  const esc = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
  const token = () => session.accessToken || session.token;
  const cityOf = (listing: Listing) => listing.city || listing.address?.city || 'À proximité';
  const clientName = (client: Client | JsonRecord | null | undefined) => String(client?.username || client?.displayName || client?.name || 'Membre GoodLease');
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'GL';
  const iconMarkup = (name: string, className = '') => `<span class="app-icon icon-${name}${className ? ` ${className}` : ''}" aria-hidden="true"></span>`;
  const formatDate = (value: unknown) => {
    const date = new Date(String(value || ''));
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  };
  const formatMonthYear = (value: unknown) => {
    const date = new Date(String(value || ''));
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date);
  };
  const humanize = (value: unknown) => {
    const text = String(value || '').trim().replaceAll('_', ' ').replace(/\s+/g, ' ');
    return text ? text.charAt(0).toLocaleUpperCase('fr') + text.slice(1) : '';
  };
  const publicImageUrl = (raw: unknown, fallback = '') => {
    if (!raw) return fallback;
    try {
      const url = new URL(String(raw), location.origin);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? catalogueImageUrl(url) : fallback;
    } catch {
      return fallback;
    }
  };
  const imageOf = (listing: Listing) => publicImageUrl(listing.photoUrls?.[0], '/og-default.png');
  const profileAvatarMarkup = (profile: Client | JsonRecord | null | undefined, name: string, eager = false) => {
    const photo = publicImageUrl(profile?.photoProfilUrl, '');
    return `<span class="public-profile-avatar">${photo ? `<img src="${esc(photo)}" alt="Photo de ${esc(name)}" loading="${eager ? 'eager' : 'lazy'}"${eager ? ' fetchpriority="high"' : ''} />` : `<span class="profile-avatar">${esc(initials(name))}</span>`}</span>`;
  };

  function restoreCatalog() {
    try {
      const stored = JSON.parse(localStorage.getItem(CATALOG_STORAGE_KEY) || 'null');
      if (!isRecord(stored) || !Array.isArray(stored.items) || typeof stored.savedAt !== 'number') return;
      if (Date.now() - stored.savedAt > CATALOG_STORAGE_MAX_AGE) return;
      catalogBase = stored.items as Listing[];
      listings = catalogBase;
      filteredListings = catalogBase;
      hasLiveCatalogBase = catalogBase.length > 0;
    } catch { /* Le catalogue réseau prendra le relais. */ }
  }

  function persistCatalog(items: Listing[]) {
    try {
      localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
    } catch { /* Le cache navigateur est facultatif. */ }
  }

  function saveSession() {
    if (token()) sessionStorage.setItem('goodlease:session', JSON.stringify(session));
    else sessionStorage.removeItem('goodlease:session');
  }

  async function rawApi(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (options.method && options.method !== 'GET') {
      const analytics = await webAnalyticsHeaders();
      for (const [name, value] of Object.entries({ ...analytics, ...webMarketingHeaders() })) headers.set(name, value);
    }
    if (!(options.body instanceof FormData) && options.body !== undefined) headers.set('Content-Type', 'application/json');
    const anonymousAuthRoute = /^auth\/(?:login|refresh|forgot-password|register\/|google\/login)/.test(path);
    if (token() && !anonymousAuthRoute) headers.set('Authorization', `Bearer ${token()}`);
    const response = await fetch(`/api/app/${path.replace(/^\//, '')}`, { ...options, headers });
    const raw = await response.text();
    const contentType = response.headers.get('content-type') || '';
    let body: unknown = raw;
    if (raw && contentType.includes('json')) {
      try { body = JSON.parse(raw); } catch { body = raw; }
    } else if (!raw) body = null;
    return { response, body };
  }

  async function api(path: string, options: RequestInit = {}, retry = true): Promise<any> {
    let result = await rawApi(path, options);
    if (result.response.status === 401 && retry && session.refreshToken && path !== 'auth/refresh') {
      const refresh = await rawApi('auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (refresh.response.ok && isRecord(refresh.body)) {
        session = { ...session, ...(refresh.body as Session) };
        saveSession();
        result = await rawApi(path, options);
      }
    }
    if (!result.response.ok) {
      if (result.response.status === 401) clearSession(false);
      const body = result.body;
      const message = isRecord(body) ? body.error || body.message : body;
      throw new Error(typeof message === 'string' && message ? message : 'Une erreur est survenue.');
    }
    return result.body;
  }

  function toast(message: string, kind: 'success' | 'error' = 'success') {
    const element = $<HTMLElement>('#toast')!;
    element.textContent = message;
    element.dataset.kind = kind;
    element.classList.add('is-visible');
    window.setTimeout(() => element.classList.remove('is-visible'), 3400);
  }

  function cardMarkup(listing: Listing, showProfileLink = true) {
    const id = String(listing.id);
    const liked = favorites.has(id);
    const rating = typeof listing.averageRating === 'number'
      ? `<span class="card-rating">${iconMarkup('star', 'inline')} ${esc(listing.averageRating.toFixed(1))}${typeof listing.reviewCount === 'number' ? ` (${esc(listing.reviewCount)})` : ''}</span>`
      : '<span>Nouveau</span>';
    const badge = listing.isDemo
      ? '<span class="verified-pill">Aperçu hors ligne</span>'
      : listing.identityVerified === true
        ? '<span class="verified-pill">✓ Identité vérifiée</span>'
        : '';
    const href = listing.isDemo ? '/app#explorer' : `/annonce/${encodeURIComponent(id)}`;
    const profileLink = showProfileLink && !listing.isDemo && listing.clientId
      ? `<a href="/profil/${encodeURIComponent(listing.clientId)}" class="card-profile-link" data-profile="${esc(listing.clientId)}">${iconMarkup('account')}<span>Profil du loueur</span>${iconMarkup('chevron-right')}</a>`
      : '';
    return `<article class="market-card" data-id="${esc(id)}"><a href="${href}" class="market-card-link" data-detail="${esc(id)}" aria-label="Voir l’annonce ${esc(listing.title)}"><div class="market-card-image"><img src="${esc(imageOf(listing))}" alt="${esc(listing.title)}" loading="lazy" />${badge}</div><div class="card-body"><div class="card-meta"><span>${esc(categoryOf(listing))}</span>${rating}</div><h3>${esc(listing.title)}</h3><p>${iconMarkup('location', 'inline')} ${esc(cityOf(listing))}${listing.distanceKm != null ? ` · ${esc(listing.distanceKm)} km` : ''}</p><strong>${money(listing.priceByPeriod || 0)} <small>/ jour</small></strong></div></a><button type="button" class="favorite-button ${liked ? 'is-liked' : ''}" data-favorite="${esc(id)}" aria-label="${liked ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${iconMarkup(liked ? 'favorite' : 'favorite-border')}</button>${profileLink}</article>`;
  }

  function profileListingMarkup(listing: Listing) {
    // Les annonces d’un loueur reprennent exactement la carte de l’Explorer
    // pour garder le même langage visuel sur toute l’application.
    return cardMarkup(listing, false).replace('<article class="market-card"', '<article class="market-card profile-market-card"');
  }

  function renderProfileListings() {
    const container = $<HTMLElement>('#public-profile-listings');
    if (!container) return;
    container.innerHTML = activeProfileListings.map(profileListingMarkup).join('') || '<div class="profile-listings-empty"><span aria-hidden="true">＋</span><h3>Aucune annonce en ligne</h3><p>Ce membre n’a pas de matériel disponible pour le moment.</p></div>';
  }

  function renderListings(target = listingGrid, source = filteredListings) {
    target.innerHTML = source.map((listing) => cardMarkup(listing)).join('');
    if (target === listingGrid) {
      resultsLabel.textContent = `${source.length} annonce${source.length > 1 ? 's' : ''} disponible${source.length > 1 ? 's' : ''}`;
      $<HTMLElement>('#listing-empty')!.hidden = source.length > 0;
    }
  }

  function renderFavorites() {
    const selected = listings.filter((listing) => favorites.has(String(listing.id)));
    renderListings($<HTMLElement>('#favorites-grid')!, selected);
    $<HTMLElement>('#favorites-empty')!.hidden = selected.length > 0;
    $<HTMLElement>('#favorite-count')!.textContent = String(favorites.size);
  }

  function navigate(route: string, updateLocation = true) {
    document.querySelectorAll('.app-view').forEach((element) => element.classList.toggle('is-active', (element as HTMLElement).dataset.view === route));
    root.dataset.activeView = route;
    document.querySelectorAll<HTMLElement>('[data-route]').forEach((element) => {
      const active = element.dataset.route === route;
      if (element.classList.contains('app-nav-item') || element.closest('.mobile-tabbar')) element.classList.toggle('is-active', active);
      if (element.classList.contains('app-nav-item')) active ? element.setAttribute('aria-current', 'page') : element.removeAttribute('aria-current');
    });
    if (route === 'favoris') renderFavorites();
    if (protectedRoutes.has(route)) {
      if (token()) void loadAccountData();
      else openDialog('#auth-dialog');
    }
    if (updateLocation) {
      const sharedPath = /^\/(?:annonce|profil)\/[1-9]\d*\/?$/.test(location.pathname);
      history.replaceState(null, '', sharedPath ? `/app#${encodeURIComponent(route)}` : `#${encodeURIComponent(route)}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openDialog(selector: string) {
    const dialog = $<HTMLDialogElement>(selector);
    if (dialog && !dialog.open) dialog.showModal();
  }
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) => {
    dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
    if (dialog.id === 'social-profile-dialog') dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && dialog.id !== 'social-profile-dialog') dialog.close();
    });
    if (dialog.id === 'generic-dialog') dialog.addEventListener('close', () => dialog.classList.remove('profile-dialog'));
  });

  function generic(title: string, body: string, button = 'Fermer') {
    $<HTMLDialogElement>('#generic-dialog')?.classList.remove('profile-dialog');
    $<HTMLElement>('#generic-content')!.innerHTML = `<div class="generic-icon">✓</div><h2>${esc(title)}</h2><p>${esc(body)}</p><button class="app-primary wide" data-close-generic>${esc(button)}</button>`;
    openDialog('#generic-dialog');
    $('[data-close-generic]')?.addEventListener('click', () => $<HTMLDialogElement>('#generic-dialog')?.close(), { once: true });
  }

  function nativeOnly(title: string, body: string, kind?: 'annonce' | 'profil', id?: string) {
    $<HTMLDialogElement>('#generic-dialog')?.classList.remove('profile-dialog');
    const openButton = kind && id ? `<button class="app-primary wide" data-open-native="${kind}" data-open-id="${esc(id)}">Ouvrir dans l’app GoodLease</button>` : '';
    $<HTMLElement>('#generic-content')!.innerHTML = `<div class="generic-icon">${iconMarkup('share')}</div><h2>${esc(title)}</h2><p>${esc(body)}</p>${openButton}<div class="store-links"><a class="app-secondary" href="${APP_STORE_URL}">App Store</a><a class="app-secondary" href="${PLAY_STORE_URL}">Google Play</a></div><button class="text-button" data-close-generic>Fermer</button>`;
    openDialog('#generic-dialog');
    $('[data-close-generic]')?.addEventListener('click', () => $<HTMLDialogElement>('#generic-dialog')?.close(), { once: true });
  }

  const isMobileBrowser = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  function openNativeApp(kind: 'annonce' | 'profil', id: string, fallback?: () => void) {
    const canonical = `${SITE_ORIGIN}/${kind}/${encodeURIComponent(id)}`;
    if (/Android/i.test(navigator.userAgent)) {
      const browserFallback = `${canonical}?web=1`;
      location.href = `intent://${kind}/${encodeURIComponent(id)}#Intent;scheme=goodlease;package=com.goodlease.app;S.browser_fallback_url=${encodeURIComponent(browserFallback)};end`;
      return;
    }
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.src = `goodlease://${kind}/${encodeURIComponent(id)}`;
    document.body.append(frame);
    window.setTimeout(() => {
      frame.remove();
      if (document.visibilityState === 'visible') {
        fallback?.();
        if (!fallback) toast('Installez l’app GoodLease pour ouvrir ce parcours.', 'error');
      }
    }, 1100);
  }

  async function share(kind: 'annonce' | 'profil', id: string, title: string) {
    const url = `${SITE_ORIGIN}/${kind}/${encodeURIComponent(id)}`;
    const text = kind === 'profil'
      ? `Découvrez le profil et les annonces de ${title} sur GoodLease`
      : `Découvrez ${title} sur GoodLease`;
    try {
      if (navigator.share) await navigator.share({ title, text, url });
      else { await navigator.clipboard.writeText(url); toast('Lien copié'); }
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') toast('Partage impossible', 'error');
    }
  }

  async function showDetail(id: string) {
    selectedListing = listings.find((listing) => String(listing.id) === id) || null;
    if (!selectedListing && /^\d+$/.test(id)) {
      try {
        const live = await api(`leases/${encodeURIComponent(id)}`);
        if (isRecord(live) && live.available === true) {
          selectedListing = live as unknown as Listing;
          listings.unshift(selectedListing);
        }
      } catch {
        selectedListing = null;
      }
    }
    if (!selectedListing) { toast('Cette annonce n’est plus disponible.', 'error'); return; }
    const listing = selectedListing;
    if (listing.isDemo) {
      $<HTMLElement>('#detail-content')!.innerHTML = `<div class="detail-image"><img src="${esc(imageOf(listing))}" alt="${esc(listing.title)}" /></div><div class="detail-copy"><div class="detail-meta"><span class="verified-pill static">Aperçu hors ligne</span></div><h2>${esc(listing.title)}</h2><p class="detail-place">${iconMarkup('location', 'inline')} ${esc(cityOf(listing))}</p><p>${esc(listing.description || '')}</p><div class="detail-book"><div><strong>${money(listing.priceByPeriod || 0)}</strong><small> / jour</small></div><button class="app-primary" data-close-detail>Fermer</button></div></div>`;
      openDialog('#detail-dialog');
      $('[data-close-detail]')?.addEventListener('click', () => $<HTMLDialogElement>('#detail-dialog')?.close(), { once: true });
      return;
    }
    trackEvent('view_item', { item_id: String(listing.id), item_category: categoryOf(listing), city: cityOf(listing),
      currency: 'EUR', value: listing.priceByPeriod, items: [{ item_id: String(listing.id), item_category: categoryOf(listing), price: listing.priceByPeriod }],
    });
    let owner: JsonRecord | null = null;
    if (listing.clientId) {
      try { owner = await api(`client/${encodeURIComponent(listing.clientId)}`); } catch { owner = null; }
    }
    const ownerName = clientName(owner);
    const ownerVerified = owner?.identityVerified === true;
    const rating = typeof listing.averageRating === 'number'
      ? `<span>${iconMarkup('star', 'inline')} ${esc(listing.averageRating.toFixed(1))}${typeof listing.reviewCount === 'number' ? ` · ${esc(listing.reviewCount)} avis` : ''}</span>`
      : '<span>Nouvelle annonce</span>';
    const ownerRating = typeof owner?.averageRating === 'number' ? `${iconMarkup('star', 'inline')} ${esc(owner.averageRating)}` : '';
    const ownerReviews = typeof owner?.reviewsCount === 'number' ? `${esc(owner.reviewsCount)} avis` : '';
    const ownerListings = typeof owner?.listingsCount === 'number' ? `${esc(owner.listingsCount)} annonce${owner.listingsCount > 1 ? 's' : ''}` : '';
    const ownerCard = listing.clientId
      ? `<section class="owner-card"><div class="owner-card-heading"><span>Le loueur</span><button type="button" class="owner-share" data-share-kind="profil" data-share-id="${esc(listing.clientId)}" data-share-title="${esc(ownerName)}">${iconMarkup('share')}<span>Partager le profil</span></button></div><a class="owner-main" href="/profil/${esc(listing.clientId)}" data-profile="${esc(listing.clientId)}">${profileAvatarMarkup(owner, ownerName)}<div><strong>${esc(ownerName)}${ownerVerified ? ' · Identité vérifiée' : ''}</strong><small>Voir le profil public et toutes ses annonces</small><span class="owner-metrics">${[ownerRating, ownerReviews, ownerListings].filter(Boolean).join('<span aria-hidden="true">•</span>')}</span></div>${iconMarkup('chevron-right')}</a></section>`
      : '';
    $<HTMLElement>('#detail-content')!.innerHTML = `<div class="detail-image"><img src="${esc(imageOf(listing))}" alt="${esc(listing.title)}" /></div><div class="detail-copy"><div class="detail-meta">${ownerVerified ? `<span class="verified-pill static">${iconMarkup('verified', 'inline')} Identité vérifiée</span>` : '<span></span>'}${rating}</div><div class="detail-title-row"><h2>${esc(listing.title)}</h2><button class="icon-button" data-share-kind="annonce" data-share-id="${esc(listing.id)}" data-share-title="${esc(listing.title)}" aria-label="Partager l’annonce">${iconMarkup('share')}</button></div><button class="open-native-button" data-open-native="annonce" data-open-id="${esc(listing.id)}">Ouvrir cette annonce dans l’app ${iconMarkup('chevron-right')}</button><p class="detail-place">${iconMarkup('location', 'inline')} ${esc(cityOf(listing))}${listing.distanceKm != null ? ` · ${esc(listing.distanceKm)} km` : ''}</p><p>${esc(listing.description || 'Consultez les informations de cette annonce GoodLease.')}</p><div class="detail-features"><span>${iconMarkup('inventory', 'inline')} ${esc(listing.quantity || 1)} disponible${(listing.quantity || 1) > 1 ? 's' : ''}</span><span>${iconMarkup('swap', 'inline')} ${esc(listing.handoutOption || 'Retrait')}</span><span>${iconMarkup('payment', 'inline')} Paiement sécurisé</span></div>${ownerCard}<div class="detail-book"><div><strong>${money(listing.priceByPeriod || 0)}</strong><small> / jour</small><p>Dépôt de garantie : ${money(depositOf(listing))}</p></div><button class="app-primary" data-action="book">Vérifier les disponibilités</button></div></div>`;
    openDialog('#detail-dialog');
  }

  async function showProfile(id: string) {
    $<HTMLDialogElement>('#detail-dialog')?.close();
    const profileView = $<HTMLElement>('#public-profile-view')!;
    const profileContent = $<HTMLElement>('#public-profile-content')!;
    navigate('profil-public', false);
    profileView.setAttribute('aria-busy', 'true');
    const cached = profileCache.get(id);
    if (cached) {
      activeProfileListings = cached.listings;
      profileContent.innerHTML = cached.markup;
      renderProfileListings();
      profileView.removeAttribute('aria-busy');
      return;
    }
    profileContent.innerHTML = `<div class="public-profile-loading" role="status"><span class="public-profile-loading-avatar" aria-hidden="true"></span><div><strong>Chargement du profil…</strong><small>Nous récupérons ses informations et ses annonces publiques.</small></div></div>`;
    try {
      const [rawProfile, rawListings] = await Promise.all([api(`client/${encodeURIComponent(id)}`), api(`leases/client/${encodeURIComponent(id)}`)]);
      if (!isRecord(rawProfile)) throw new Error('Profil indisponible.');
      const profileListings = asArray(rawListings) as unknown as Listing[];
      const name = clientName(rawProfile);
      const verified = rawProfile.identityVerified === true;
      const company = typeof rawProfile.company === 'string' ? rawProfile.company.trim() : '';
      const memberSince = formatMonthYear(rawProfile.memberSince);
      const publicListingCount = typeof rawProfile.listingsCount === 'number'
        ? Math.max(rawProfile.listingsCount, profileListings.length)
        : profileListings.length;
      const listingReviewCount = profileListings.reduce((total, listing) => total + (typeof listing.reviewCount === 'number' ? Math.max(0, listing.reviewCount) : 0), 0);
      const profileReviewCount = Math.max(typeof rawProfile.reviewsCount === 'number' ? Math.max(0, rawProfile.reviewsCount) : 0, listingReviewCount);
      const weightedRatings = profileListings.filter((listing) => typeof listing.averageRating === 'number' && listing.averageRating > 0 && typeof listing.reviewCount === 'number' && listing.reviewCount > 0);
      const weightedReviewCount = weightedRatings.reduce((total, listing) => total + (listing.reviewCount || 0), 0);
      const derivedAverageRating = weightedReviewCount > 0
        ? weightedRatings.reduce((total, listing) => total + (listing.averageRating || 0) * (listing.reviewCount || 0), 0) / weightedReviewCount
        : undefined;
      const averageRating = typeof rawProfile.averageRating === 'number' && rawProfile.averageRating > 0
        ? rawProfile.averageRating
        : derivedAverageRating;
      const ratingLabel = averageRating
        ? averageRating.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
        : 'Nouveau';
      const cities = [...new Set(profileListings.map(cityOf).filter((city) => city && city !== 'À proximité'))];
      const areaLabel = cities.length > 2 ? `${cities.slice(0, 2).join(' · ')} + ${cities.length - 2}` : cities.join(' · ');
      const coverPhotos = profileListings
        .flatMap((listing) => listing.photoUrls || [])
        .map((photo) => publicImageUrl(photo, ''))
        .filter(Boolean)
        .slice(0, 3);
      const coverMarkup = coverPhotos.map((photo, index) => `<img src="${esc(photo)}" alt="" loading="${index === 0 ? 'eager' : 'lazy'}" />`).join('');
      const headerMeta = [
        company ? `<span>${iconMarkup('inventory', 'inline')} Entreprise · ${esc(company)}</span>` : '',
        memberSince ? `<span>${iconMarkup('calendar', 'inline')} Membre depuis ${esc(memberSince)}</span>` : '',
        areaLabel ? `<span>${iconMarkup('location', 'inline')} ${esc(areaLabel)}</span>` : '',
      ].filter(Boolean).join('');
      const aboutDetails = [
        company ? `<div><dt>Entreprise</dt><dd>${esc(company)}</dd></div>` : '',
        memberSince ? `<div><dt>Membre depuis</dt><dd>${esc(memberSince)}</dd></div>` : '',
        areaLabel ? `<div><dt>Zones d’activité</dt><dd>${esc(areaLabel)}</dd></div>` : '',
      ].filter(Boolean).join('');
      activeProfileListings = profileListings;
      profileContent.innerHTML = `<div class="social-profile-page"><nav class="social-profile-toolbar" aria-label="Navigation du profil"><a href="/app#explorer" class="profile-back-link"><span aria-hidden="true">←</span> Retour aux annonces</a><button type="button" class="profile-toolbar-share" data-share-kind="profil" data-share-id="${esc(id)}" data-share-title="${esc(name)}">${iconMarkup('share')}<span>Partager le profil</span></button></nav><article class="social-profile-hero"><div class="social-profile-cover social-profile-cover-${coverPhotos.length}">${coverMarkup}<span class="social-profile-cover-shade" aria-hidden="true"></span><span class="social-profile-cover-brand">GoodLease</span></div><div class="social-profile-summary"><div class="social-profile-avatar-wrap">${profileAvatarMarkup(rawProfile, name, true)}</div><div class="social-profile-identity"><div class="social-profile-name-row"><h1 id="public-profile-name" tabindex="-1">${esc(name)}</h1>${verified ? `<span class="profile-identity-badge">${iconMarkup('verified', 'inline')} Identité vérifiée</span>` : ''}</div><p class="social-profile-role">Loueur sur GoodLease</p>${headerMeta ? `<div class="social-profile-meta">${headerMeta}</div>` : ''}</div><div class="social-profile-actions"><button type="button" class="app-primary" data-open-native="profil" data-open-id="${esc(id)}">Ouvrir dans l’app</button><button type="button" class="app-secondary" data-share-kind="profil" data-share-id="${esc(id)}" data-share-title="${esc(name)}">${iconMarkup('share')} Partager</button></div></div><dl class="social-profile-stats"><div><dt>${profileReviewCount} avis</dt><dd>${averageRating ? `${iconMarkup('star', 'inline')} ` : ''}${esc(ratingLabel)}</dd></div><div><dt>Annonce${publicListingCount > 1 ? 's' : ''}</dt><dd>${esc(publicListingCount)}</dd></div><div><dt>${verified ? 'Identité' : 'Profil GoodLease'}</dt><dd>${verified ? 'Vérifiée' : 'Public'}</dd></div></dl></article><div class="social-profile-layout"><aside class="social-profile-sidebar"><section class="profile-about-card"><h2>À propos</h2>${aboutDetails ? `<dl class="profile-about-list">${aboutDetails}</dl>` : `<p>${esc(name)} partage son matériel disponible à la location sur GoodLease.</p>`}</section><section class="profile-trust-card"><h2>Confiance et sécurité</h2><ul><li>${iconMarkup(verified ? 'verified' : 'account')}<span><strong>${verified ? 'Identité vérifiée' : 'Profil public GoodLease'}</strong><small>${verified ? 'Vérification effectuée pour ce compte.' : 'Les informations privées ne sont jamais affichées.'}</small></span></li><li>${iconMarkup('payment')}<span><strong>Paiement protégé</strong><small>Les réservations et paiements passent par GoodLease.</small></span></li><li>${iconMarkup('location')}<span><strong>Localisation maîtrisée</strong><small>Seule la ville de l’annonce est rendue publique.</small></span></li></ul></section><section class="profile-reputation-card"><span>${averageRating ? `${iconMarkup('star')}<strong>${esc(ratingLabel)} / 5</strong>` : `${iconMarkup('star')}<strong>Nouveau profil</strong>`}</span><p>${profileReviewCount > 0 ? `${profileReviewCount} avis reçu${profileReviewCount > 1 ? 's' : ''} après location.` : 'Pas encore d’avis sur ce profil.'}</p></section></aside><section class="social-profile-feed" aria-labelledby="profile-listings-heading"><header class="profile-listings-heading"><div><p class="app-kicker">Son matériel</p><h2 id="profile-listings-heading">Annonces disponibles</h2></div><span>${profileListings.length}</span></header><div id="public-profile-listings" class="profile-listings"></div></section></div></div>`;
      profileCache.set(id, { profile: rawProfile, listings: profileListings, markup: profileContent.innerHTML });
      renderProfileListings();
    } catch (error) {
      activeProfileListings = [];
      profileContent.innerHTML = `<div class="public-profile-error"><span class="generic-icon" aria-hidden="true">!</span><p class="app-kicker">Profil indisponible</p><h1 id="public-profile-name">Impossible de charger ce profil</h1><p>${esc(error instanceof Error ? error.message : 'Ce profil ne peut pas être chargé.')}</p><div><a class="app-primary" href="/profil/${encodeURIComponent(id)}?web=1">Réessayer</a><a class="app-secondary" href="/app#explorer">Retour aux annonces</a></div></div>`;
    } finally {
      profileView.removeAttribute('aria-busy');
    }
  }

  function requireAuth(): boolean {
    if (token()) return true;
    openDialog('#auth-dialog');
    toast('Connectez-vous pour continuer', 'error');
    return false;
  }

  function statusLabel(value: unknown) {
    const labels: Record<string, string> = {
      PENDING_ACCEPTANCE: 'À confirmer', PENDING_VALIDATION: 'À valider', PENDING_DELIVERY: 'Remise à préparer',
      DELIVERY_CONFIRMED: 'En cours', VALIDATED: 'Validée', IN_PROGRESS: 'En cours', PENDING_RETURN: 'Retour attendu',
      COMPLETED: 'Terminée', DISPUTED: 'Litige', REFUNDED: 'Remboursée', CANCELLED: 'Annulée',
    };
    return labels[String(value || '').toUpperCase()] || String(value || 'En cours').replaceAll('_', ' ');
  }

  function renderClient(client: Client) {
    const name = clientName(client);
    const avatar = $<HTMLElement>('#profile-avatar')!;
    const photo = publicImageUrl(client.photoProfilUrl, '');
    avatar.innerHTML = photo ? `<img src="${esc(photo)}" alt="Photo de ${esc(name)}" />` : esc(initials(name));
    $<HTMLElement>('#profile-name')!.textContent = name;
    $<HTMLElement>('#profile-caption')!.textContent = client.company || client.email || 'Compte GoodLease';
    $<HTMLElement>('#profile-verified')!.textContent = client.identityVerified ? '✓ Identité vérifiée' : 'Profil GoodLease';
    $<HTMLElement>('#profile-rating')!.textContent = String(client.reviewsCount ?? 0);
    $<HTMLElement>('#profile-listings')!.textContent = String(client.listingsCount ?? 0);
    $<HTMLElement>('#profile-identity')!.textContent = client.identityVerified ? 'Vérifiée' : 'À compléter';
    $<HTMLButtonElement>('#share-profile-button')!.hidden = false;
    const form = $<HTMLFormElement>('#profile-form')!;
    const set = (field: string, value: unknown) => { const input = form.elements.namedItem(field) as HTMLInputElement | null; if (input) input.value = String(value ?? ''); };
    set('username', client.username); set('email', client.email); set('phone', client.phone);
    set('birthDate', client.birthDate); set('company', client.company); set('vatNumber', client.vatNumber);
  }

  function renderBookings(raw: unknown) {
    const bookings = asArray(raw);
    $<HTMLElement>('#listing-stat-bookings')!.textContent = String(bookings.length);
    const container = $<HTMLElement>('#booking-list')!;
    if (!bookings.length) {
      container.innerHTML = `<div class="empty-state"><span>${iconMarkup('my-ads')}</span><h3>Aucune location</h3><p>Vos prochaines réservations apparaîtront ici.</p><button class="app-secondary" data-route="explorer">Explorer le catalogue</button></div>`;
      return;
    }
    container.innerHTML = bookings.map((booking) => {
      const transaction = isRecord(booking.transaction) ? booking.transaction : {};
      const transactionId = Number(booking.transactionId || booking.id || transaction.id || 0);
      const leaseId = Number(booking.leaseId || transaction.leaseId || 0);
      const title = String(booking.leaseTitle || transaction.leaseTitle || transaction.leaseName || 'Location GoodLease');
      const photo = String(booking.leasePhotoUrl || booking.photoUrl || booking.imageUrl || transaction.leasePhotoUrl || '/og-default.png');
      const from = formatDate(booking.startDate || transaction.startDate || transaction.leaseStartDate);
      const to = formatDate(booking.endDate || transaction.endDate || transaction.leaseEndDate);
      const range = [from, to].filter(Boolean).join(' – ');
      return `<article class="booking-card"><img src="${esc(photo)}" alt="${esc(title)}" /><div class="grow"><div class="status status-confirmed">${esc(statusLabel(booking.transactionStatus || booking.status || transaction.status))}</div><h3>${esc(title)}</h3><p>${esc(range || 'Dates à consulter')}</p><small>Réservation n° ${esc(transactionId)}</small></div><div class="booking-actions"><strong>${money(Number(booking.amount || transaction.amount || 0))}</strong>${transactionId ? `<button class="app-secondary" data-contract-id="${esc(transactionId)}">Voir le contrat</button>` : ''}${leaseId ? `<button class="app-primary" data-open-native="annonce" data-open-id="${esc(leaseId)}">Continuer dans l’app</button>` : '<button class="app-primary" data-action="native-feature">Continuer dans l’app</button>'}</div></article>`;
    }).join('');
  }

  function renderOwnerListings(raw: unknown) {
    const ownListings = asArray(raw) as unknown as Listing[];
    $<HTMLElement>('#listing-stat-total')!.textContent = String(ownListings.length);
    $<HTMLElement>('#listing-stat-active')!.textContent = String(ownListings.filter((listing) => listing.available !== false && String(listing.state || '').toUpperCase() !== 'INACTIVE').length);
    const container = $<HTMLElement>('#owner-listings')!;
    if (!ownListings.length) {
      container.innerHTML = '<div class="empty-state"><span>＋</span><h3>Publiez votre premier matériel</h3><p>Créez une annonce avec vos photos, votre tarif et vos conditions de remise.</p><button class="app-primary" data-action="new-listing">Déposer une annonce</button></div>';
      return;
    }
    container.innerHTML = ownListings.map((listing) => `<article class="owner-listing"><img src="${esc(imageOf(listing))}" alt="${esc(listing.title)}" /><div class="grow"><div class="status ${listing.available === false ? 'status-draft' : 'status-live'}">${listing.available === false ? 'Indisponible' : 'Publiée'}</div><h3>${esc(listing.title)}</h3><p>${money(listing.priceByPeriod || 0)} / jour · ${esc(cityOf(listing))}</p></div><button class="app-secondary" data-detail="${esc(listing.id)}">Voir</button><button class="icon-button" data-share-kind="annonce" data-share-id="${esc(listing.id)}" data-share-title="${esc(listing.title)}" aria-label="Partager">${iconMarkup('share')}</button></article>`).join('');
  }

  function renderChats(raw: unknown) {
    chats = asArray(raw) as unknown as Chat[];
    const unread = chats.reduce((total, chat) => total + Number(chat.unreadCount || 0), 0);
    const badge = $<HTMLElement>('#message-count')!;
    badge.textContent = String(unread);
    badge.hidden = unread === 0;
    renderChatList(chats);
  }

  function renderChatList(source: Chat[]) {
    const container = $<HTMLElement>('#conversation-list')!;
    if (!source.length) {
      container.innerHTML = '<div class="account-placeholder compact"><div><strong>Aucune conversation</strong><small>Une conversation est créée lorsqu’un membre vous contacte à propos d’une annonce.</small></div></div>';
      return;
    }
    container.innerHTML = source.map((chat) => {
      const name = String(chat.otherParticipantName || chat.receiverName || 'Membre GoodLease');
      const time = chat.lastMessageTimestamp || chat.lastMessageTime;
      return `<button class="conversation ${activeChat?.id === chat.id ? 'is-active' : ''}" data-chat-id="${esc(chat.id)}"><span class="person-avatar">${esc(initials(name))}</span><span><strong>${esc(name)}</strong><small>${esc(chat.lastMessage || 'Ouvrir la conversation')}</small></span><time>${esc(time ? formatDate(time) : '')}</time></button>`;
    }).join('');
  }

  async function openChat(chatId: number) {
    const chat = chats.find((item) => Number(item.id) === chatId);
    if (!chat || !currentClient) return;
    activeChat = chat;
    $<HTMLElement>('.messages-view')?.classList.add('has-active-chat');
    renderChatList(chats);
    const name = String(chat.otherParticipantName || chat.receiverName || 'Membre GoodLease');
    $<HTMLElement>('#chat-header')!.hidden = false;
    $<HTMLElement>('#chat-avatar')!.textContent = initials(name);
    $<HTMLElement>('#chat-name')!.textContent = name;
    $<HTMLFormElement>('#message-form')!.hidden = false;
    const container = $<HTMLElement>('#chat-messages')!;
    container.innerHTML = '<div class="day-separator">Chargement…</div>';
    try {
      const messages = asArray(await api(`chats/${chatId}/messages`)) as unknown as Message[];
      container.innerHTML = messages.length ? messages.map((message) => {
        const mine = Number(message.expediteurId) === Number(currentClient?.id);
        const content = String(message.content || '');
        const displayed = content.startsWith('[img]') ? '📷 Photo partagée — ouvrez l’app pour l’afficher' : content;
        return `<div class="message ${mine ? 'outgoing' : 'incoming'}">${esc(displayed)}</div>`;
      }).join('') : `<div class="empty-state"><span>${iconMarkup('messages')}</span><h3>Aucun message</h3><p>Envoyez le premier message de cette conversation.</p></div>`;
      container.scrollTop = container.scrollHeight;
    } catch (error) {
      container.innerHTML = `<div class="empty-state"><span>!</span><h3>Messages indisponibles</h3><p>${esc(error instanceof Error ? error.message : 'Réessayez plus tard.')}</p></div>`;
    }
  }

  function renderWallet(balanceRaw: unknown, historyRaw: unknown) {
    const balance = Number(isRecord(balanceRaw) ? balanceRaw.balance : balanceRaw || 0);
    $<HTMLElement>('#wallet-balance')!.textContent = money(Number.isFinite(balance) ? balance : 0);
    $<HTMLElement>('#wallet-caption')!.textContent = 'Solde confirmé par GoodLease';
    $<HTMLElement>('#listing-stat-balance')!.textContent = money(Number.isFinite(balance) ? balance : 0);
    const history = asArray(historyRaw);
    const container = $<HTMLElement>('#transaction-list')!;
    if (!history.length) {
      container.innerHTML = '<div class="account-placeholder"><span class="transaction-icon payout">€</span><div><strong>Aucun virement demandé</strong><small>Vos demandes de retrait apparaîtront ici.</small></div></div>';
      return;
    }
    container.innerHTML = history.map((item) => `<div><span class="transaction-icon payout">€</span><div><strong>Virement ${esc(statusLabel(item.status))}</strong><small>${esc(formatDate(item.createdAt))}${item.iban ? ` · vers ${esc(item.iban)}` : ''}</small></div><strong>− ${money(Number(item.amount || 0))}</strong></div>`).join('');
  }

  function renderNotifications(raw: unknown) {
    const notifications = asArray(raw);
    const unread = notifications.filter((item) => item.isRead !== true).length;
    const badge = $<HTMLElement>('#notification-count')!;
    badge.textContent = String(unread);
    badge.hidden = unread === 0;
    const container = $<HTMLElement>('#notification-list')!;
    if (!notifications.length) {
      container.innerHTML = '<div class="empty-state"><span>✓</span><h3>Vous êtes à jour</h3><p>Aucune notification pour le moment.</p></div>';
      return;
    }
    container.innerHTML = notifications.map((item) => `<article class="${item.isRead === true ? '' : 'unread'}"><span class="notice-icon blue">${iconMarkup('notifications')}</span><div><h3>${esc(item.title || 'Notification GoodLease')}</h3><p>${esc(item.body || '')}</p><time>${esc(formatDate(item.createdAt))}</time></div>${item.isRead === true ? '' : `<button data-notification-id="${esc(item.id)}">Marquer comme lu</button>`}</article>`).join('');
  }

  function renderAccountError(selector: string, title: string) {
    const container = $<HTMLElement>(selector);
    if (container) container.innerHTML = `<div class="empty-state"><span>!</span><h3>${esc(title)}</h3><p>Impossible de charger ces données. Réessayez dans quelques instants.</p></div>`;
  }

  async function loadAccountData(force = false) {
    if (!token()) return;
    if (accountLoading && !force) return accountLoading;
    accountLoading = (async () => {
      try {
        const rawClient = await api('client/me');
        if (!isRecord(rawClient) || !Number(rawClient.id)) throw new Error('Compte introuvable.');
        currentClient = rawClient as unknown as Client;
        void synchronizeAnalytics();
        void synchronizeMarketing();
        renderClient(currentClient);
        const id = currentClient.id;
        const [bookings, ownListings, chatResult, balance, history, notifications] = await Promise.allSettled([
          api(`transactions/bookings-with-details/${id}`),
          api(`account/leases/${id}`),
          api('chats/user'),
          api(`wallet/balance/${id}`),
          api(`cashout/history/${id}`),
          api(`notifications/client/${id}?page=0&size=50`),
        ]);
        if (bookings.status === 'fulfilled') renderBookings(bookings.value); else renderAccountError('#booking-list', 'Locations indisponibles');
        if (ownListings.status === 'fulfilled') renderOwnerListings(ownListings.value); else renderAccountError('#owner-listings', 'Annonces indisponibles');
        if (chatResult.status === 'fulfilled') renderChats(chatResult.value); else renderAccountError('#conversation-list', 'Messages indisponibles');
        if (balance.status === 'fulfilled') renderWallet(balance.value, history.status === 'fulfilled' ? history.value : []);
        if (notifications.status === 'fulfilled') renderNotifications(notifications.value); else renderAccountError('#notification-list', 'Notifications indisponibles');
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Impossible de charger votre compte.', 'error');
      } finally {
        accountLoading = null;
      }
    })();
    return accountLoading;
  }

  function resetAccountViews() {
    currentClient = null; chats = []; activeChat = null;
    $<HTMLElement>('.messages-view')?.classList.remove('has-active-chat');
    $<HTMLElement>('#wallet-balance')!.textContent = '—';
    $<HTMLElement>('#wallet-caption')!.textContent = 'Connectez-vous pour afficher votre solde';
    for (const id of ['#listing-stat-total', '#listing-stat-active', '#listing-stat-bookings', '#listing-stat-balance', '#profile-rating', '#profile-listings', '#profile-identity']) $<HTMLElement>(id)!.textContent = '—';
    $<HTMLButtonElement>('#share-profile-button')!.hidden = true;
    $<HTMLElement>('#profile-avatar')!.textContent = 'GL';
    $<HTMLElement>('#profile-name')!.textContent = 'Votre profil';
    $<HTMLElement>('#profile-caption')!.textContent = 'Connectez-vous pour retrouver votre compte';
    $<HTMLElement>('#profile-verified')!.textContent = 'Profil GoodLease';
    const signedOut = (label: string) => `<div class="account-placeholder"><div><strong>${esc(label)}</strong><small>Connectez-vous pour charger les données réelles de votre compte.</small></div><button class="app-secondary" data-action="login">Se connecter</button></div>`;
    $<HTMLElement>('#booking-list')!.innerHTML = signedOut('Vos locations apparaîtront ici');
    $<HTMLElement>('#owner-listings')!.innerHTML = signedOut('Vos annonces apparaîtront ici');
    $<HTMLElement>('#conversation-list')!.innerHTML = signedOut('Vos conversations apparaîtront ici');
    $<HTMLElement>('#transaction-list')!.innerHTML = signedOut('Vos virements apparaîtront ici');
    $<HTMLElement>('#notification-list')!.innerHTML = signedOut('Vos notifications apparaîtront ici');
    $<HTMLFormElement>('#message-form')!.hidden = true;
    $<HTMLElement>('#chat-header')!.hidden = true;
    $<HTMLElement>('#message-count')!.hidden = true;
    $<HTMLElement>('#notification-count')!.hidden = true;
  }

  function clearSession(notify = true) {
    identifyWebAnalytics();
    session = {};
    saveSession();
    resetAccountViews();
    updateAuth();
    if (notify) toast('Vous êtes déconnecté');
  }

  function updateAuth() {
    const button = $<HTMLButtonElement>('#auth-button')!;
    $<HTMLElement>('#auth-button-label')!.textContent = token()
      ? session.username || currentClient?.username || 'Mon compte'
      : 'Se connecter';
    button.setAttribute('aria-label', token() ? 'Se déconnecter' : 'Se connecter');
  }

  async function synchronizeAnalytics() {
    if (!token()) return;
    const headers = await webAnalyticsHeaders();
    if (!headers['X-GoodLease-Analytics']) return;
    try {
      const { response, body } = await rawApi('analytics/context', { method: 'POST', headers });
      if (response.ok && isRecord(body)) identifyWebAnalytics(body as { user_id: string; account_type: string; user_type: string });
    } catch { /* Analytics cannot block account screens. */ }
  }
  window.addEventListener('goodlease:analytics-consent', () => { void synchronizeAnalytics(); });
  async function synchronizeMarketing() {
    if (!token()) return;
    const headers = webMarketingHeaders();
    if (!headers['X-GoodLease-Marketing']) return;
    try { await rawApi('marketing/context', { method: 'POST', headers }); } catch { /* Advertising cannot block account screens. */ }
  }
  window.addEventListener('goodlease:marketing-consent', () => { void synchronizeMarketing(); });

  async function logout() {
    try {
      await api('auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken || null }) }, false);
    } catch {
      // La session locale est toujours supprimée, même si la révocation distante échoue.
    }
    clearSession();
  }

  async function downloadContract(transactionId: number) {
    if (!requireAuth()) return;
    try {
      let response = await fetch(`/api/app/bookings/${transactionId}/contract.pdf`, { headers: { Authorization: `Bearer ${token()}` } });
      if (response.status === 401 && session.refreshToken) {
        await api('client/me');
        response = await fetch(`/api/app/bookings/${transactionId}/contract.pdf`, { headers: { Authorization: `Bearer ${token()}` } });
      }
      if (!response.ok) throw new Error('Le contrat n’est pas encore disponible.');
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl; link.download = `contrat-goodlease-${transactionId}.pdf`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Contrat indisponible.', 'error');
    }
  }

  async function openCashout() {
    if (!requireAuth()) return;
    if (!currentClient) await loadAccountData();
    if (!currentClient) return;
    const summary = $<HTMLElement>('#bank-summary')!;
    summary.textContent = 'Chargement du compte bancaire…';
    openDialog('#cashout-dialog');
    try {
      const info = await api(`cashout/bank-info/${currentClient.id}`);
      if (!isRecord(info) || info.hasBank !== true) {
        summary.innerHTML = 'Aucun compte bancaire configuré. <button type="button" class="text-button" data-action="stripe">Configurer via Stripe</button>';
        $<HTMLButtonElement>('#cashout-form button[type=submit]')!.disabled = true;
        return;
      }
      summary.innerHTML = `<div><span>Compte bancaire</span><strong>${esc(info.bankName || 'Banque')} ···· ${esc(info.last4 || '')}</strong></div><small>${info.payoutsEnabled === true ? 'Versements activés' : 'Vérification Stripe en cours'}</small>`;
      $<HTMLButtonElement>('#cashout-form button[type=submit]')!.disabled = info.payoutsEnabled !== true;
    } catch (error) {
      summary.textContent = error instanceof Error ? error.message : 'Compte bancaire indisponible.';
      $<HTMLButtonElement>('#cashout-form button[type=submit]')!.disabled = true;
    }
  }

  async function openStripe() {
    if (!requireAuth()) return;
    if (!currentClient) await loadAccountData();
    if (!currentClient) return;
    try {
      const result = await api(`stripe/account-link/${currentClient.id}`);
      const url = isRecord(result) ? String(result.url || '') : '';
      const target = new URL(url);
      if (target.protocol !== 'https:' || !(target.hostname === 'stripe.com' || target.hostname.endsWith('.stripe.com'))) throw new Error('Lien Stripe invalide.');
      location.assign(target.href);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Impossible d’ouvrir Stripe.', 'error');
    }
  }

  async function forgotPassword() {
    const identifier = window.prompt('Adresse e-mail ou identifiant du compte :', currentClient?.email || '');
    if (!identifier?.trim()) return;
    try {
      await api('auth/forgot-password', { method: 'POST', body: JSON.stringify({ identifier: identifier.trim() }) });
      nativeOnly('Code envoyé', 'Un code de vérification vous a été envoyé. Pour choisir le nouveau mot de passe, poursuivez dans l’app GoodLease.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Demande impossible.', 'error');
    }
  }

  function handleAction(action: string) {
    if (action === 'new-listing') { if (!requireAuth()) return; wizardStep = 1; updateWizard(); openDialog('#listing-dialog'); }
    if (action === 'book') {
      $<HTMLDialogElement>('#detail-dialog')?.close();
      if (!selectedListing || selectedListing.isDemo) return;
      const form = $<HTMLFormElement>('#booking-form')!;
      (form.elements.namedItem('listingId') as HTMLInputElement).value = String(selectedListing.id);
      updateBookingSummary(); openDialog('#booking-dialog');
    }
    if (action === 'stripe') void openStripe();
    if (action === 'cashout') void openCashout();
    if (action === 'forgot') void forgotPassword();
    if (action === 'login') openDialog('#auth-dialog');
    if (action === 'register') { $<HTMLDialogElement>('#auth-dialog')?.close(); openDialog('#register-dialog'); }
    if (action === 'share-profile' && currentClient) void share('profil', String(currentClient.id), clientName(currentClient));
    if (action === 'logout') void logout();
    if (action === 'native-feature') nativeOnly('Disponible dans l’app mobile', 'Ce parcours utilise les fonctions sécurisées du téléphone et reste accessible dans l’app GoodLease.');
  }

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const routeElement = target.closest<HTMLElement>('[data-route]');
    if (routeElement?.dataset.route) { event.preventDefault(); navigate(routeElement.dataset.route); return; }
    const favoriteElement = target.closest<HTMLElement>('[data-favorite]');
    if (favoriteElement) {
      event.preventDefault();
      event.stopPropagation();
      const id = favoriteElement.dataset.favorite!;
      favorites.has(id) ? favorites.delete(id) : favorites.add(id);
      localStorage.setItem('goodlease:favorites', JSON.stringify([...favorites]));
      renderListings(); renderFavorites(); toast(favorites.has(id) ? 'Ajouté aux favoris' : 'Retiré des favoris'); return;
    }
    const detailElement = target.closest<HTMLElement>('[data-detail]');
    if (detailElement?.dataset.detail) {
      event.preventDefault();
      const id = detailElement.dataset.detail;
      if (isMobileBrowser() && /^\d+$/.test(id)) openNativeApp('annonce', id, () => void showDetail(id));
      else void showDetail(id);
      return;
    }
    const nativeElement = target.closest<HTMLElement>('[data-open-native]');
    if (nativeElement?.dataset.openNative && nativeElement.dataset.openId) {
      event.preventDefault();
      openNativeApp(nativeElement.dataset.openNative as 'annonce' | 'profil', nativeElement.dataset.openId);
      return;
    }
    const shareElement = target.closest<HTMLElement>('[data-share-kind]');
    if (shareElement?.dataset.shareKind && shareElement.dataset.shareId) {
      event.preventDefault();
      void share(shareElement.dataset.shareKind as 'annonce' | 'profil', shareElement.dataset.shareId, shareElement.dataset.shareTitle || selectedListing?.title || 'ce contenu');
      return;
    }
    const chatElement = target.closest<HTMLElement>('[data-chat-id]');
    if (chatElement?.dataset.chatId) { void openChat(Number(chatElement.dataset.chatId)); return; }
    const contractElement = target.closest<HTMLElement>('[data-contract-id]');
    if (contractElement?.dataset.contractId) { void downloadContract(Number(contractElement.dataset.contractId)); return; }
    const notificationElement = target.closest<HTMLElement>('[data-notification-id]');
    if (notificationElement?.dataset.notificationId && currentClient) {
      void api(`notifications/${notificationElement.dataset.notificationId}/read?clientId=${currentClient.id}`, { method: 'POST' })
        .then(() => loadAccountData(true)).catch((error) => toast(error.message, 'error'));
      return;
    }
    const actionElement = target.closest<HTMLElement>('[data-action]');
    if (actionElement?.dataset.action) handleAction(actionElement.dataset.action);
  });

  $<HTMLButtonElement>('#auth-button')!.addEventListener('click', () => { if (token()) navigate('profil'); else openDialog('#auth-dialog'); });

  type GoogleIdentityApi = {
    accounts: {
      id: {
        initialize(options: { client_id: string; callback(response: { credential?: string }): void; ux_mode: 'popup' }): void;
        renderButton(element: HTMLElement, options: Record<string, string | number>): void;
      };
    };
  };

  const googleIdentity = () => (window as unknown as { google?: GoogleIdentityApi }).google;

  async function handleGoogleCredential(credential?: string) {
    const container = $<HTMLElement>('#google-signin-button')!;
    const error = $<HTMLElement>('#auth-error')!;
    if (!credential) { error.textContent = 'Google n’a pas transmis de justificatif de connexion.'; error.hidden = false; return; }
    container.setAttribute('aria-busy', 'true'); error.hidden = true;
    try {
      const result = await api('auth/google/login', { method: 'POST', body: JSON.stringify({ idToken: credential }) }, false);
      if (!isRecord(result) || typeof result.token !== 'string') throw new Error('Réponse de connexion Google invalide.');
      session = result as Session; saveSession(); updateAuth();
      $<HTMLDialogElement>('#auth-dialog')!.close();
      if (session.needsUsername === true) openDialog('#social-profile-dialog');
      else { toast('Connexion Google réussie'); await loadAccountData(true); }
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : 'Connexion Google impossible.';
      error.hidden = false; openDialog('#auth-dialog');
    } finally {
      container.removeAttribute('aria-busy');
    }
  }

  function setupGoogleSignIn() {
    const container = $<HTMLElement>('#google-signin-button')!;
    const showUnavailable = () => {
      container.dataset.initialized = 'error';
      container.removeAttribute('aria-busy');
      container.innerHTML = '<span>Connexion Google momentanément indisponible</span>';
    };
    if (!googleClientId) { showUnavailable(); return; }
    const initialize = () => {
      const google = googleIdentity();
      if (!google || container.dataset.initialized === 'true') return;
      try {
        container.setAttribute('aria-busy', 'true');
        google.accounts.id.initialize({ client_id: googleClientId, callback: (response) => void handleGoogleCredential(response.credential), ux_mode: 'popup' });
        container.textContent = '';
        const buttonWidth = Math.min(400, Math.max(240, window.innerWidth - 80));
        google.accounts.id.renderButton(container, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: buttonWidth, locale: 'fr_FR' });
        container.dataset.initialized = 'true';
        container.removeAttribute('aria-busy');
        window.setTimeout(() => { if (!container.querySelector('iframe')) showUnavailable(); }, 4000);
      } catch {
        showUnavailable();
      }
    };
    if (googleIdentity()) initialize();
    else {
      const script = $<HTMLScriptElement>('#google-identity-services');
      script?.addEventListener('load', initialize, { once: true });
      script?.addEventListener('error', showUnavailable, { once: true });
    }
  }

  $<HTMLFormElement>('#auth-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const error = $<HTMLElement>('#auth-error')!;
    submit.disabled = true; submit.textContent = 'Connexion…'; error.hidden = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      const result = await api('auth/login', { method: 'POST', body: JSON.stringify(values) }, false);
      if (!isRecord(result) || typeof result.token !== 'string') throw new Error('Réponse de connexion invalide.');
      session = result as Session; saveSession(); updateAuth();
      $<HTMLDialogElement>('#auth-dialog')!.close(); toast('Connexion réussie'); await loadAccountData(true);
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : 'Connexion impossible.'; error.hidden = false;
    } finally { submit.disabled = false; submit.textContent = 'Se connecter'; }
  });

  $<HTMLFormElement>('#register-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const error = $<HTMLElement>('#register-error')!;
    submit.disabled = true; submit.textContent = 'Envoi…'; error.hidden = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      pendingRegistrationEmail = String(values.email || '').trim();
      await api('auth/register/request', { method: 'POST', body: JSON.stringify(values) }, false);
      $<HTMLElement>('#verify-email')!.textContent = pendingRegistrationEmail;
      $<HTMLDialogElement>('#register-dialog')!.close(); openDialog('#verify-dialog');
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : 'Inscription impossible.'; error.hidden = false;
    } finally { submit.disabled = false; submit.textContent = 'Recevoir mon code'; }
  });

  $<HTMLFormElement>('#verify-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const error = $<HTMLElement>('#verify-error')!;
    submit.disabled = true; submit.textContent = 'Activation…'; error.hidden = true;
    try {
      const code = String(new FormData(form).get('code') || '');
      const result = await api(`auth/register/verify?email=${encodeURIComponent(pendingRegistrationEmail)}&code=${encodeURIComponent(code)}`, { method: 'POST', body: '{}' }, false);
      if (!isRecord(result) || typeof result.token !== 'string') throw new Error('Réponse d’activation invalide.');
      session = result as Session; saveSession(); updateAuth();
      trackEvent('sign_up', { method: 'email' });
      $<HTMLDialogElement>('#verify-dialog')!.close(); toast('Votre compte est activé'); await loadAccountData(true);
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : 'Code invalide ou expiré.'; error.hidden = false;
    } finally { submit.disabled = false; submit.textContent = 'Activer mon compte'; }
  });

  $<HTMLFormElement>('#social-profile-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const error = $<HTMLElement>('#social-profile-error')!;
    const username = String(new FormData(form).get('username') || '').trim();
    submit.disabled = true; submit.textContent = 'Enregistrement…'; error.hidden = true;
    try {
      const result = await api('auth/complete-profile', { method: 'POST', body: JSON.stringify({ username }) });
      session.username = isRecord(result) && typeof result.username === 'string' ? result.username : username;
      session.needsUsername = false; saveSession(); updateAuth();
      $<HTMLDialogElement>('#social-profile-dialog')!.close(); toast('Connexion Google réussie'); await loadAccountData(true);
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : 'Ce nom d’utilisateur ne peut pas être utilisé.';
      error.hidden = false;
    } finally { submit.disabled = false; submit.textContent = 'Terminer mon inscription'; }
  });

  $<HTMLFormElement>('#message-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentClient || !activeChat) return;
    const form = event.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem('message') as HTMLInputElement;
    const content = input.value.trim();
    if (!content) return;
    const receiverId = Number(activeChat.otherParticipantId || activeChat.receiverId || 0);
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    submit.disabled = true;
    try {
      await api(`chats/${activeChat.id}/sendmessages`, { method: 'POST', body: JSON.stringify({ id: 0, content, date: new Date().toISOString().slice(0, 10), expediteurId: currentClient.id, destinateurId: receiverId, chatId: activeChat.id }) });
      input.value = ''; await openChat(activeChat.id);
    } catch (error) { toast(error instanceof Error ? error.message : 'Message non envoyé.', 'error'); }
    finally { submit.disabled = false; }
  });

  $<HTMLInputElement>('#conversation-search')!.addEventListener('input', (event) => {
    const query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase('fr');
    renderChatList(chats.filter((chat) => !query || `${chat.otherParticipantName || chat.receiverName || ''} ${chat.lastMessage || ''}`.toLocaleLowerCase('fr').includes(query)));
  });

  $<HTMLButtonElement>('#chat-back')!.addEventListener('click', () => {
    $<HTMLElement>('.messages-view')?.classList.remove('has-active-chat');
  });

  $<HTMLFormElement>('#profile-form')!.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!requireAuth()) return;
    if (!currentClient) await loadAccountData();
    if (!currentClient) return;
    const form = event.currentTarget as HTMLFormElement;
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const data = Object.fromEntries(new FormData(form));
    delete data.username;
    delete data.email;
    submit.disabled = true; submit.textContent = 'Enregistrement…';
    try {
      const result = await api(`client/${currentClient.id}`, { method: 'PUT', body: JSON.stringify(data) });
      if (isRecord(result)) currentClient = result as unknown as Client;
      renderClient(currentClient); toast('Profil enregistré');
    } catch (error) { toast(error instanceof Error ? error.message : 'Profil non enregistré.', 'error'); }
    finally { submit.disabled = false; submit.textContent = 'Enregistrer'; }
  });

  $<HTMLButtonElement>('#read-all')!.addEventListener('click', async () => {
    if (!requireAuth()) return;
    if (!currentClient) await loadAccountData();
    if (!currentClient) return;
    try { await api(`notifications/client/${currentClient.id}/read-all`, { method: 'POST' }); await loadAccountData(true); toast('Toutes les notifications sont lues'); }
    catch (error) { toast(error instanceof Error ? error.message : 'Action impossible.', 'error'); }
  });

  const wizardNext = $<HTMLButtonElement>('#wizard-next')!;
  const wizardBack = $<HTMLButtonElement>('#wizard-back')!;
  const availabilityStart = $<HTMLInputElement>('#listing-form input[name="availabilityStart"]')!;
  const availabilityEnd = $<HTMLInputElement>('#listing-form input[name="availabilityEnd"]')!;

  function validateListingAvailability(report = false) {
    availabilityEnd.setCustomValidity('');
    if (availabilityStart.value) availabilityEnd.min = availabilityStart.value;
    if (availabilityStart.value && availabilityEnd.value && availabilityEnd.value < availabilityStart.value) {
      availabilityEnd.setCustomValidity('La date de fin doit être égale ou postérieure à la date de début.');
    }
    return !report || availabilityEnd.reportValidity();
  }

  availabilityStart.addEventListener('change', () => validateListingAvailability());
  availabilityEnd.addEventListener('change', () => validateListingAvailability(true));
  wizardNext.addEventListener('click', () => {
    const step = $<HTMLElement>(`.wizard-step[data-step="${wizardStep}"]`)!;
    if (wizardStep === 2 && !validateListingAvailability(true)) return;
    const required = [...step.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[required]')];
    if (!required.every((field) => field.reportValidity())) return;
    wizardStep = Math.min(4, wizardStep + 1); updateWizard();
  });
  wizardBack.addEventListener('click', () => { wizardStep = Math.max(1, wizardStep - 1); updateWizard(); });
  function updateWizard() {
    document.querySelectorAll<HTMLElement>('.wizard-step').forEach((element) => element.classList.toggle('is-active', Number(element.dataset.step) === wizardStep));
    document.querySelectorAll<HTMLElement>('.wizard-progress span').forEach((element, index) => element.classList.toggle('is-active', index < wizardStep));
    wizardBack.hidden = wizardStep === 1; wizardNext.hidden = wizardStep === 4;
    $<HTMLButtonElement>('#wizard-submit')!.hidden = wizardStep !== 4;
  }

  $<HTMLFormElement>('#listing-form')!.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!requireAuth()) return;
    const form = event.currentTarget as HTMLFormElement;
    const submit = $<HTMLButtonElement>('#wizard-submit')!;
    const formData = new FormData(form);
    submit.disabled = true; submit.textContent = 'Publication…';
    try {
      if (!validateListingAvailability(true)) return;
      const categoryId = parseListingInteger(String(formData.get('categoryId') || ''), 'La catégorie', 1);
      const [codeRef, legacyType] = categoryRefs[categoryId] || [];
      if (!codeRef || !legacyType) throw new Error('La catégorie sélectionnée est invalide.');
      const priceByPeriod = parseListingInteger(formData.get('priceByPeriod'), 'Le prix par jour', 1);
      const caution = parseListingInteger(String(formData.get('caution') || '0'), 'Le dépôt de garantie', 0);
      const quantity = parseListingInteger(formData.get('quantity'), 'La quantité', 1);
      const startDate = dateOnlyToUtcMidnight(formData.get('availabilityStart'), 'La date de début');
      const endDate = dateOnlyToUtcMidnight(formData.get('availabilityEnd'), 'La date de fin');
      if (endDate < startDate) throw new Error('La date de fin doit être égale ou postérieure à la date de début.');

      const region = String(formData.get('region') || '');
      if (!region) throw new Error('Sélectionnez une région.');
      const createLease = {
        titleLease: String(formData.get('title') || ''), description: String(formData.get('description') || ''),
        priceByPeriod, caution,
        idCategorie: categoryId, coderefCategorie: codeRef, typeCategorie: legacyType,
        region, street: String(formData.get('street') || ''), postalCode: String(formData.get('postalCode') || ''), city: String(formData.get('city') || ''),
        quantity, condition: 'Bon état', codeRefStatus: 'ACTIVE', status: 'Disponible',
        handoutOption: String(formData.get('handoutOption') || 'Retrait sur place'), advice: 'Manipulation soigneuse recommandée',
      };
      const upload = new FormData();
      for (const photo of formData.getAll('photos')) if (photo instanceof File && photo.size) upload.append('photos', photo, photo.name);
      const result = await api(`leases/newcommands?createLease=${encodeURIComponent(JSON.stringify(createLease))}`, { method: 'POST', body: upload });
      if (isRecord(result) && result.success === false) throw new Error(String(result.message || result.error || 'Publication refusée.'));
      const leaseId = extractCreatedLeaseId(result);
      if (!leaseId) {
        if (isRecord(result) && result.success === true) {
          $<HTMLDialogElement>('#listing-dialog')!.close(); form.reset(); navigate('annonces');
          $<HTMLElement>('#generic-content')!.innerHTML = '<div class="generic-icon">!</div><h2>Annonce créée, disponibilité à compléter</h2><p>L’annonce a été créée, mais le serveur n’a pas renvoyé son identifiant. Elle n’a pas pu être rendue disponible. Ne créez pas une nouvelle annonce : complétez sa disponibilité depuis l’app mobile.</p><button class="app-primary wide" data-close-generic>Fermer</button>';
          openDialog('#generic-dialog');
          $('[data-close-generic]')?.addEventListener('click', () => $<HTMLDialogElement>('#generic-dialog')?.close(), { once: true });
          return;
        }
        throw new Error('La création de l’annonce n’a pas été confirmée par le serveur.');
      }

      try {
        await api('booking-periods', {
          method: 'POST',
          body: JSON.stringify({ leaseId, startDate, endDate }),
        });
      } catch {
        $<HTMLDialogElement>('#listing-dialog')!.close(); form.reset(); navigate('annonces');
        $<HTMLElement>('#generic-content')!.innerHTML = `<div class="generic-icon">!</div><h2>Annonce créée, mais non publiée</h2><p>L’annonce n° ${esc(leaseId)} a bien été créée, mais sa période de disponibilité n’a pas pu être enregistrée. Elle reste invisible dans le catalogue. Ne créez pas une nouvelle annonce : complétez sa disponibilité depuis l’app mobile.</p><button class="app-primary wide" data-close-generic>Fermer</button>`;
        openDialog('#generic-dialog');
        $('[data-close-generic]')?.addEventListener('click', () => $<HTMLDialogElement>('#generic-dialog')?.close(), { once: true });
        return;
      }

      trackEvent('listing_published', { listing_id: String(leaseId), item_id: String(leaseId), category_id: categoryId });
      toast('Annonce publiée avec sa période de disponibilité');
      $<HTMLDialogElement>('#listing-dialog')!.close(); form.reset(); await loadAccountData(true); navigate('annonces');
    } catch (error) { toast(error instanceof Error ? error.message : 'Annonce non publiée.', 'error'); }
    finally { submit.disabled = false; submit.textContent = 'Publier l’annonce'; }
  });

  function updateBookingSummary() {
    const form = $<HTMLFormElement>('#booking-form')!;
    const from = new Date((form.elements.namedItem('from') as HTMLInputElement).value);
    const to = new Date((form.elements.namedItem('to') as HTMLInputElement).value);
    const days = Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) ? Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1) : 1;
    const rent = days * (selectedListing?.priceByPeriod || 0);
    $<HTMLElement>('#booking-summary')!.innerHTML = `<div><span>${days} jour${days > 1 ? 's' : ''} × ${money(selectedListing?.priceByPeriod || 0)}</span><strong>${money(rent)}</strong></div><div><span>Frais de service (5 %)</span><strong>${money(rent * .05)}</strong></div><hr><div class="total"><span>Total</span><strong>${money(rent * 1.05)}</strong></div><small>Dépôt de garantie autorisé séparément : ${money(depositOf(selectedListing))}</small>`;
  }
  document.querySelectorAll<HTMLInputElement>('#booking-form input[type=date]').forEach((input) => input.addEventListener('change', updateBookingSummary));
  $<HTMLFormElement>('#booking-form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    $<HTMLDialogElement>('#booking-dialog')!.close();
    if (!selectedListing) return;
    if (!selectedListing.isDemo) trackEvent('booking_app_handoff', { item_id: String(selectedListing.id) });
    nativeOnly('Finaliser dans l’app mobile', 'La réservation et l’autorisation de paiement Stripe doivent être confirmées dans l’app GoodLease. Aucun créneau n’a été bloqué sur le web.', 'annonce', String(selectedListing.id));
  });

  $<HTMLFormElement>('#cashout-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentClient) return;
    const form = event.currentTarget as HTMLFormElement;
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const error = $<HTMLElement>('#cashout-error')!;
    const amount = Number(new FormData(form).get('amount') || 0);
    error.hidden = true; submit.disabled = true; submit.textContent = 'Envoi…';
    try {
      const result = await api('cashout/request', { method: 'POST', body: JSON.stringify({ clientId: currentClient.id, amount }) });
      if (isRecord(result) && String(result.status || '').toUpperCase() === 'FAILED') throw new Error(String(result.failureReason || 'Virement refusé.'));
      $<HTMLDialogElement>('#cashout-dialog')!.close(); form.reset(); generic('Demande envoyée', `Votre demande de virement de ${money(amount)} a bien été transmise.`); await loadAccountData(true);
    } catch (caught) { error.textContent = caught instanceof Error ? caught.message : 'Virement impossible.'; error.hidden = false; }
    finally { submit.disabled = false; submit.textContent = 'Confirmer le virement'; }
  });

  async function searchCatalog(categoryId?: number) {
    const form = $<HTMLFormElement>('#search-form')!;
    const values = Object.fromEntries(new FormData(form));
    const params = new URLSearchParams({ size: '48' });
    const search = String(values.search || '').trim();
    const city = String(values.city || '').trim().toLocaleLowerCase('fr');
    if (search) params.set('search', search);
    if (categoryId) params.set('categoryId', String(categoryId));
    if (values.from) params.set('availableFrom', new Date(`${values.from}T00:00:00`).toISOString());
    if (values.to) params.set('availableTo', new Date(`${values.to}T23:59:59`).toISOString());
    if (geo) { params.set('latitude', String(geo.latitude)); params.set('longitude', String(geo.longitude)); params.set('radiusKm', '50'); params.set('sort', 'distance'); }
    const cacheKey = params.toString();
    const requestId = ++catalogRequestId;
    const unfilteredRequest = !search && !city && !values.from && !values.to && !geo;
    const applyCatalog = (source: Listing[], mode: string) => {
      listings = source;
      filteredListings = city ? source.filter((listing) => cityOf(listing).toLocaleLowerCase('fr').includes(city)) : source;
      renderListings(); renderFavorites(); dataMode.textContent = mode;
    };
    if (categoryId && unfilteredRequest && hasLiveCatalogBase) {
      const localResults = catalogBase.filter((listing) => listing.categoryId === categoryId || listing.category === categoryNames[categoryId]);
      catalogCache.set(cacheKey, localResults);
      applyCatalog(localResults, 'Catalogue GoodLease en direct');
      return;
    }
    const cached = catalogCache.get(cacheKey);
    if (cached) {
      applyCatalog(cached, 'Catalogue GoodLease en direct');
      return;
    }
    // Affiche immédiatement le catalogue déjà présent pendant que la requête réseau arrive.
    const previewSource = catalogBase.length ? catalogBase : listings;
    if (previewSource.length) {
      const preview = categoryId ? previewSource.filter((listing) => listing.categoryId === categoryId || listing.category === categoryNames[categoryId]) : previewSource;
      applyCatalog(preview, 'Mise à jour du catalogue…');
    }
    dataMode.textContent = 'Recherche en cours…';
    try {
      const live: Listing[] = [];
      const seenIds = new Set<string>();
      const fetchPage = async (page: number) => {
        const pageParams = new URLSearchParams(params);
        pageParams.set('page', String(page));
        return asArray(await api(`leases?${pageParams}`)) as unknown as Listing[];
      };
      const appendPage = (chunk: Listing[]) => {
        let added = 0;
        for (const listing of chunk) {
          const id = String(listing.id);
          if (seenIds.has(id)) continue;
          seenIds.add(id); live.push(listing); added += 1;
        }
        return added;
      };
      // Les deux premières pages sont demandées en parallèle. Le catalogue
      // actuel tient sur ces pages, ce qui divise presque par deux l’attente.
      const firstPages = await Promise.all([fetchPage(0), fetchPage(1)]);
      appendPage(firstPages[0]);
      appendPage(firstPages[1]);
      let previousChunk = firstPages[1];
      for (let page = 2; page < 20 && previousChunk.length === 48; page += 1) {
        const chunk = await fetchPage(page);
        if (!chunk.length) break;
        const added = appendPage(chunk);
        if (chunk.length < 48 || added === 0) break;
        previousChunk = chunk;
      }
      if (requestId !== catalogRequestId) return;
      catalogCache.set(cacheKey, live);
      if (!categoryId && unfilteredRequest) {
        catalogBase = live;
        hasLiveCatalogBase = true;
        persistCatalog(live);
      }
      applyCatalog(live, 'Catalogue GoodLease en direct');
    } catch {
      if (requestId !== catalogRequestId) return;
      if (!listings.length) applyCatalog(fallbackListings, 'Aperçu hors ligne · réservation indisponible');
      else dataMode.textContent = 'Catalogue GoodLease · dernière version affichée';
    }
  }

  $<HTMLFormElement>('#search-form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const selectedCategory = Number($<HTMLElement>('.category-chip.is-active')?.dataset.categoryId || 0);
    const values = new FormData(event.currentTarget as HTMLFormElement);
    trackEvent('search', { category_id: selectedCategory, has_search_term: Boolean(String(values.get('search') || '').trim()), has_city_filter: Boolean(String(values.get('city') || '').trim()) });
    void searchCatalog(selectedCategory);
    listingGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $<HTMLInputElement>('#global-search')!.addEventListener('input', (event) => {
    const query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase('fr');
    filteredListings = listings.filter((listing) => !query || `${listing.title} ${listing.description || ''} ${categoryOf(listing)}`.toLocaleLowerCase('fr').includes(query));
    renderListings();
  });
  document.querySelectorAll<HTMLButtonElement>('.category-chip').forEach((chip) => chip.addEventListener('click', () => {
    document.querySelectorAll('.category-chip').forEach((element) => element.classList.remove('is-active'));
    chip.classList.add('is-active'); void searchCatalog(Number(chip.dataset.categoryId || 0));
  }));

  $<HTMLButtonElement>('#location-button')!.addEventListener('click', () => {
    if (!navigator.geolocation) { toast('La géolocalisation n’est pas disponible.', 'error'); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      geo = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      $<HTMLButtonElement>('#location-button')!.querySelector('span:last-child')!.textContent = 'Autour de moi';
      ($<HTMLInputElement>('#search-form input[name=city]')!).value = '';
      void searchCatalog(Number($<HTMLElement>('.category-chip.is-active')?.dataset.categoryId || 0));
    }, () => toast('Position non partagée. Saisissez une ville.', 'error'), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  });

  async function openSharedLink() {
    const pathMatch = location.pathname.match(/^\/(annonce|profil)\/(\d+)\/?$/);
    const query = new URLSearchParams(location.search);
    const kind = pathMatch?.[1] || query.get('open');
    const id = pathMatch?.[2] || query.get('id');
    if (!id || !/^[1-9]\d{0,18}$/.test(id) || (kind !== 'annonce' && kind !== 'profil')) return;
    const shouldOpenNative = isMobileBrowser() && query.get('web') !== '1';
    if (kind === 'profil') {
      await showProfile(id);
      return;
    }
    let listing = listings.find((item) => String(item.id) === id);
    if (!listing) {
      try {
        const live = await api(`leases/${encodeURIComponent(id)}`);
        if (isRecord(live) && live.available === true) { listing = live as unknown as Listing; listings.unshift(listing); }
        else throw new Error('Annonce indisponible.');
      } catch { toast('Cette annonce n’est plus disponible.', 'error'); return; }
    }
    if (shouldOpenNative) openNativeApp('annonce', id, () => void showDetail(id));
    else await showDetail(id);
  }

  async function initialize() {
    listingGrid.innerHTML = '<div class="account-placeholder"><div><strong>Chargement du catalogue…</strong><small>Connexion à GoodLease en cours.</small></div></div>';
    restoreCatalog();
    if (hasLiveCatalogBase) {
      renderListings();
      dataMode.textContent = 'Catalogue GoodLease · mise à jour en arrière-plan';
    }
    const today = new Date().toISOString().slice(0, 10);
    document.querySelectorAll<HTMLInputElement>('#booking-form input[type=date], #search-form input[type=date], #listing-form input[type=date]').forEach((input) => { if (!input.min) input.min = today; });
    const adultLimit = new Date();
    adultLimit.setFullYear(adultLimit.getFullYear() - 18);
    document.querySelectorAll<HTMLInputElement>('input[name=birthDate]').forEach((input) => { input.max = adultLimit.toISOString().slice(0, 10); });
    updateAuth(); updateWizard(); renderFavorites(); setupGoogleSignIn();
    const hasSharedPath = /^\/(?:annonce|profil)\/[1-9]\d*\/?$/.test(location.pathname);
    const query = new URLSearchParams(location.search);
    const hasSharedQuery = ['annonce', 'profil'].includes(query.get('open') || '') && /^[1-9]\d{0,18}$/.test(query.get('id') || '');
    if (hasSharedPath || hasSharedQuery) {
      await openSharedLink();
      void searchCatalog();
    } else {
      await searchCatalog();
    }
    if (token() && session.needsUsername === true) { openDialog('#social-profile-dialog'); return; }
    if (token()) await loadAccountData();
  }

  const initialRoute = location.hash.slice(1);
  if (initialRoute && $(`[data-view="${CSS.escape(initialRoute)}"]`)) navigate(initialRoute);
  void initialize();
}
