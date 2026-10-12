import { updateWebAnalyticsConsent, webCampaign, webAnalyticsEnvironment } from './web-analytics-context.ts';
import { updateWebMarketingConsent } from './web-marketing-context.ts';
export type ConsentPreferences = { analytics: boolean; marketing: boolean; savedAt: number; version: string };
export type MarketingOptions = { gtmId: string; ga4Id: string; metaPixelId: string; consentVersion: string };
export const CONSENT_KEY = 'goodlease:consent:v1';
export const CONSENT_MAX_AGE = 183 * 24 * 60 * 60 * 1000;

export function validMarketingOptions(options: MarketingOptions): MarketingOptions {
  return {
    gtmId: /^GTM-[A-Z0-9]+$/.test(options.gtmId) ? options.gtmId : '',
    ga4Id: /^G-[A-Z0-9]+$/.test(options.ga4Id) ? options.ga4Id : '',
    metaPixelId: /^\d{5,25}$/.test(options.metaPixelId) ? options.metaPixelId : '',
    consentVersion: options.consentVersion,
  };
}

export const consentVersion = (options: MarketingOptions) =>
  [options.consentVersion, options.gtmId, options.ga4Id, options.metaPixelId].join(':');

export function readConsent(raw: string | null, version: string, now = Date.now()): ConsentPreferences | undefined {
  try {
    const value = JSON.parse(raw || 'null');
    return value && value.version === version && typeof value.analytics === 'boolean' && typeof value.marketing === 'boolean' &&
      typeof value.savedAt === 'number' && Number.isFinite(value.savedAt) && value.savedAt <= now && value.savedAt > now - CONSENT_MAX_AGE
      ? { analytics: value.analytics, marketing: value.marketing, savedAt: value.savedAt, version } : undefined;
  } catch { return undefined; }
}

export function googleConsent(preferences: Pick<ConsentPreferences, 'analytics' | 'marketing'>) {
  return {
    analytics_storage: preferences.analytics ? 'granted' : 'denied',
    ad_storage: preferences.marketing ? 'granted' : 'denied',
    ad_user_data: preferences.marketing ? 'granted' : 'denied',
    ad_personalization: preferences.marketing ? 'granted' : 'denied',
  };
}

const events = new Set(['view_item', 'search', 'sign_up', 'listing_published', 'app_store_click', 'booking_app_handoff']);
const publicText = (value: unknown, max = 100) => typeof value === 'string' && !/@|https?:|\b\d{5,}\b/i.test(value) ? value.trim().slice(0, max) : undefined;

/** Keep campaign attribution without collecting arbitrary query strings or fragments. */
export function measurementUrl(raw: string, advertising = false) {
  try {
    const original = new URL(raw);
    const url = new URL(original.origin + original.pathname);
    const keys: Record<string, string> = { source: 'utm_source', medium: 'utm_medium', name: 'utm_campaign', id: 'utm_id' };
    for (const [field, value] of Object.entries(webCampaign(raw))) {
      url.searchParams.set(keys[field], value);
    }
    if (advertising) for (const key of ['gclid', 'dclid', 'gbraid', 'wbraid', 'fbclid']) {
      const value = original.searchParams.get(key); if (value && /^[a-zA-Z0-9_-]{1,256}$/.test(value)) url.searchParams.set(key, value);
    }
    return url.href;
  } catch { return ''; }
}

/** Explicit event allowlist: no e-mail, account DTO, street, GPS or raw search input. */
export function eventParameters(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const key of ['currency', 'method', 'platform', 'destination_platform', 'item_category', 'city']) {
    const value = publicText(input[key]); if (value) output[key] = value;
  }
  for (const key of ['item_id', 'listing_id']) {
    if (/^[1-9]\d{0,18}$/.test(String(input[key] || ''))) output[key] = String(input[key]);
  }
  for (const key of ['value', 'results_count', 'category_id', 'quantity']) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key]) && input[key] >= 0) output[key] = input[key];
  }
  for (const key of ['has_search_term', 'has_city_filter']) if (typeof input[key] === 'boolean') output[key] = input[key];
  if (Array.isArray(input.items)) output.items = input.items.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== 'object' || !/^[1-9]\d{0,18}$/.test(String(item.item_id || ''))) return [];
    return [{ item_id: String(item.item_id), ...(publicText(item.item_category) ? { item_category: publicText(item.item_category) } : {}),
      ...(typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0 ? { price: item.price } : {}), quantity: 1 }];
  });
  return output;
}

/** Only map actions that the web can confirm. Paid conversions belong to the backend. */
export function metaEvent(event: string, parameters: Record<string, unknown>) {
  if (event === 'view_item') {
    const items = parameters.items as Array<{ item_id: string }> | undefined;
    const ids = items?.map((item) => item.item_id) || (parameters.item_id ? [parameters.item_id] : []);
    return { command: 'track', name: 'ViewContent', parameters: {
      content_type: 'product', content_ids: ids,
      ...(parameters.item_category ? { content_category: parameters.item_category } : {}),
      ...(parameters.currency ? { currency: parameters.currency } : {}),
      ...(typeof parameters.value === 'number' ? { value: parameters.value } : {}),
    } };
  }
  if (event === 'sign_up') return { command: 'track', name: 'CompleteRegistration', parameters: {} };
  return { command: 'trackCustom', name: event, parameters };
}

type MarketingWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown; callMethod?: (...args: unknown[]) => void };
  _fbq?: MarketingWindow['fbq'];
  [key: `ga-disable-${string}`]: boolean;
};
let send: ((event: string, parameters: Record<string, unknown>) => boolean) | undefined;
let currentItem: Record<string, unknown> | undefined;

export function trackEvent(event: string, parameters: Record<string, unknown> = {}) {
  if (!events.has(event)) return false;
  const safe = { ...eventParameters(parameters), platform: 'web' };
  if (event === 'view_item') currentItem = safe;
  return send?.(event, safe) || false;
}

export function initMarketingConsent() {
  const config = document.querySelector<HTMLElement>('#goodlease-marketing-config');
  if (!config || config.dataset.mounted === 'true') return;
  config.dataset.mounted = 'true';
  let options: MarketingOptions;
  try { options = validMarketingOptions(JSON.parse(config.dataset.config || '{}')); } catch { return; }
  if (!options.gtmId && !options.ga4Id && !options.metaPixelId) return;
  const version = consentVersion(options);
  const win = window as MarketingWindow;
  const banner = document.querySelector<HTMLElement>('#marketing-consent-banner')!;
  const dialog = document.querySelector<HTMLDialogElement>('#marketing-consent-dialog')!;
  const form = document.querySelector<HTMLFormElement>('#marketing-consent-form')!;
  let preferences: ConsentPreferences | undefined;
  try { preferences = readConsent(localStorage.getItem(CONSENT_KEY), version); } catch { /* Storage may be unavailable. */ }
  let googleLoaded = false;
  let metaLoaded = false;
  win.dataLayer = win.dataLayer || [];
  win.gtag = win.gtag || function (..._args: unknown[]) { win.dataLayer!.push(arguments); };
  win.gtag('consent', 'default', googleConsent({ analytics: false, marketing: false }));
  win.gtag('set', 'ads_data_redaction', true);

  function script(src: string) {
    const element = document.createElement('script'); element.src = src; element.async = true; element.dataset.marketing = 'true';
    document.head.append(element);
  }
  const cleanUrl = (raw: string) => measurementUrl(raw, preferences?.marketing);

  function cleanBrowserUrl() {
    const original = new URL(location.href);
    const safeLocation = new URL(cleanUrl(location.href));
    for (const key of ['open', 'id', 'web', 'confirm']) {
      const value = original.searchParams.get(key);
      if (value && /^(?:annonce|profil|[1-9]\d{0,18})$/.test(value)) safeLocation.searchParams.set(key, value);
    }
    if (/^#(?:explorer|favoris|annonces|reservations|messages|portefeuille|notifications|profil)$/.test(original.hash)) safeLocation.hash = original.hash;
    win.history?.replaceState(win.history.state, '', safeLocation.href);
  }

  function loadTags() {
    if (!preferences) return;
    win.gtag!('consent', 'update', googleConsent(preferences));
    if (options.ga4Id) win[`ga-disable-${options.ga4Id}`] = !preferences.analytics;
    // A GTM container may contain arbitrary tags. Until it is reviewed, require both purposes.
    if (options.gtmId) {
      if (!googleLoaded && preferences.analytics && preferences.marketing) {
        googleLoaded = true;
        cleanBrowserUrl();
        const environment = webAnalyticsEnvironment(location.href);
        const accountType = environment === 'preview' ? 'test' : 'unknown';
        win.gtag!('set', { environment, account_type: accountType, user_type: 'guest',
          user_properties: { account_type: accountType, user_type: 'guest' }, ...(environment === 'preview' ? { debug_mode: true } : {}) });
        win.dataLayer!.push({ 'gtm.start': Date.now(), event: 'gtm.js', page_location: cleanUrl(location.href), page_referrer: cleanUrl(document.referrer) });
        script(`https://www.googletagmanager.com/gtm.js?id=${options.gtmId}`);
      }
    } else {
      if (!googleLoaded && options.ga4Id && preferences.analytics) {
        googleLoaded = true;
        cleanBrowserUrl();
        win.gtag!('js', new Date());
        win.gtag!('config', options.ga4Id, { send_page_view: false, page_location: cleanUrl(location.href), page_referrer: cleanUrl(document.referrer), cookie_expires: 390 * 24 * 60 * 60, cookie_update: false, allow_google_signals: preferences.marketing, allow_ad_personalization_signals: preferences.marketing });
        win.gtag!('event', 'page_view', { page_location: cleanUrl(location.href), page_referrer: cleanUrl(document.referrer), page_title: document.title });
        script(`https://www.googletagmanager.com/gtag/js?id=${options.ga4Id}`);
      }
      if (!metaLoaded && options.metaPixelId && preferences.marketing) {
        metaLoaded = true;
        cleanBrowserUrl();
        const fbq: NonNullable<MarketingWindow['fbq']> = function (...args) {
          if (fbq.callMethod) fbq.callMethod(...args); else fbq.queue!.push(args);
        };
        fbq.queue = []; fbq.loaded = true; fbq.version = '2.0'; fbq.push = fbq;
        win.fbq = fbq; win._fbq = fbq;
        fbq('consent', 'grant'); fbq('set', 'autoConfig', false, options.metaPixelId); fbq('init', options.metaPixelId);
        fbq('track', 'PageView');
        script('https://connect.facebook.net/en_US/fbevents.js');
      }
    }
  }

  send = (event, parameters) => {
    if (!preferences?.analytics && !preferences?.marketing) return false;
    if (options.gtmId) {
      if (!googleLoaded || !preferences.analytics || !preferences.marketing) return false;
      win.dataLayer!.push({ ecommerce: null });
      const { items, currency, value, ...rest } = parameters;
      win.dataLayer!.push({ event, ...rest, ...(items ? { ecommerce: { items, currency, value } } : {}) });
    } else {
      const audience = googleLoaded && preferences.analytics;
      const advertising = metaLoaded && preferences.marketing;
      // Durable backend hooks own these milestones, including retries after login.
      if (audience && !['sign_up', 'listing_published'].includes(event)) win.gtag!('event', event, { ...parameters, page_location: cleanUrl(location.href), page_referrer: cleanUrl(document.referrer) });
      if (advertising && !['sign_up', 'listing_published'].includes(event)) {
        const mapped = metaEvent(event, parameters);
        win.fbq?.(mapped.command, mapped.name, mapped.parameters);
      }
      return Boolean(audience || advertising);
    }
    return true;
  };

  function clearTrackingCookies() {
    const names = document.cookie.split(';').map((cookie) => cookie.trim().split('=')[0]).filter((name) => /^_ga(?:_|$)|^_gid$|^_gat|^_gcl_|^_fb[pc]$/.test(name));
    const host = location.hostname;
    const domains = ['', host, `.${host}`, ...(host.endsWith('.goodlease.fr') ? ['.goodlease.fr'] : [])];
    for (const name of names) for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/;${domain ? ` domain=${domain};` : ''} SameSite=Lax`;
  }

  function save(analytics: boolean, marketing: boolean) {
    const wasMeasuring = options.gtmId ? googleLoaded && preferences?.analytics && preferences.marketing
      : (googleLoaded && preferences?.analytics) || (metaLoaded && preferences?.marketing);
    const mustReload = googleLoaded || metaLoaded;
    const revoking = preferences && ((preferences.analytics && !analytics) || (preferences.marketing && !marketing));
    preferences = { analytics, marketing, savedAt: Date.now(), version };
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(preferences)); } catch { /* Choice applies to this page only. */ }
    updateWebAnalyticsConsent(analytics && !options.gtmId, options.ga4Id, win);
    updateWebMarketingConsent(marketing && !options.gtmId, options.metaPixelId, win);
    banner.hidden = true; dialog.close();
    if (revoking && mustReload) {
      win.gtag!('consent', 'update', googleConsent(preferences));
      if (options.ga4Id) win[`ga-disable-${options.ga4Id}`] = !analytics;
      win.fbq?.('consent', 'revoke'); clearTrackingCookies(); location.reload(); return;
    }
    loadTags();
    if (!wasMeasuring && currentItem) send?.('view_item', currentItem);
  }

  document.querySelectorAll<HTMLElement>('[data-consent-choice]').forEach((button) => button.addEventListener('click', () => {
    const accepted = button.dataset.consentChoice === 'accept'; save(accepted, accepted);
  }));
  document.querySelectorAll<HTMLElement>('[data-consent-open]').forEach((button) => {
    button.hidden = false;
    button.addEventListener('click', () => {
      (form.elements.namedItem('analytics') as HTMLInputElement).checked = preferences?.analytics || false;
      (form.elements.namedItem('marketing') as HTMLInputElement).checked = preferences?.marketing || false;
      dialog.showModal();
    });
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save((form.elements.namedItem('analytics') as HTMLInputElement).checked, (form.elements.namedItem('marketing') as HTMLInputElement).checked);
  });
  dialog.querySelector('[data-consent-close]')?.addEventListener('click', () => dialog.close());
  banner.hidden = Boolean(preferences);
  loadTags();
  updateWebAnalyticsConsent(Boolean(preferences?.analytics && !options.gtmId), options.ga4Id, win);
  updateWebMarketingConsent(Boolean(preferences?.marketing && !options.gtmId), options.metaPixelId, win);
  win.addEventListener?.('storage', (event: StorageEvent) => {
    if (event.key !== CONSENT_KEY) return;
    preferences = readConsent(event.newValue, version);
    updateWebAnalyticsConsent(Boolean(preferences?.analytics && !options.gtmId), options.ga4Id, win);
    updateWebMarketingConsent(Boolean(preferences?.marketing && !options.gtmId), options.metaPixelId, win);
    win.gtag?.('consent', 'update', googleConsent(preferences || { analytics: false, marketing: false }));
    if (!preferences?.marketing) win.fbq?.('consent', 'revoke');
    location.reload();
  });
  const item = document.querySelector<HTMLElement>('[data-track-item]');
  if (item) {
    const value = Number(item.dataset.trackPrice);
    trackEvent('view_item', { item_id: item.dataset.trackItem, item_category: item.dataset.trackCategory, city: item.dataset.trackCity,
      ...(item.dataset.trackPrice && Number.isFinite(value) ? { currency: 'EUR', value } : {}),
      items: [{ item_id: item.dataset.trackItem, item_category: item.dataset.trackCategory, ...(item.dataset.trackPrice ? { price: value } : {}) }],
    });
  }
  document.addEventListener('click', (event) => {
    const link = (event.target as Element)?.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    try {
      const url = new URL(link.href);
      const platform = url.hostname === 'apps.apple.com' ? 'ios' : url.hostname === 'play.google.com' ? 'android' : '';
      if (platform) trackEvent('app_store_click', { destination_platform: platform });
    } catch { /* Other link schemes are irrelevant. */ }
  });
}
