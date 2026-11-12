import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { readConsent, consentVersion, googleConsent, eventParameters, measurementUrl, validMarketingOptions, CONSENT_MAX_AGE } from '../src/scripts/marketing-consent.ts';
import { ATTRIBUTION_KEYS, ATTRIBUTION_TTL } from '../src/scripts/marketing-attribution.ts';

const options = { gtmId: '', ga4Id: 'G-TEST123', metaPixelId: '123456789012345', consentVersion: 'test-v1' };
const compiled = (await build({ entryPoints: ['src/scripts/marketing-consent.ts'], bundle: true, write: false, format: 'cjs', platform: 'browser' })).outputFiles[0].text;
const copy = (value) => JSON.parse(JSON.stringify(value));

function browser(config = options, stored, context = {}) {
  const listeners = new Map();
  const node = (name, dataset = {}) => ({ dataset, hidden: true, addEventListener(event, handler) { listeners.set(`${name}:${event}`, handler); } });
  const banner = node('banner');
  const inputs = { analytics: { checked: false }, marketing: { checked: false } };
  const form = { ...node('form'), elements: { namedItem: (name) => inputs[name] } };
  const dialog = { ...node('dialog'), close() {}, showModal() {}, querySelector() { return null; } };
  const configNode = node('config', { config: JSON.stringify(config) });
  const choices = [node('accept', { consentChoice: 'accept' }), node('refuse', { consentChoice: 'refuse' })];
  const scripts = []; const writes = []; let reloads = 0; let reads = 0;
  let now = context.now ?? Date.now(); const timers = new Map(); let timerId = 0;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const session = context.session || new Map();
  const sessionStorage = {
    getItem(key) { return session.get(key) || null; }, setItem(key, value) { session.set(key, value); }, removeItem(key) { session.delete(key); },
  };
  const location = { href: context.href || 'https://goodlease.fr/app/?email=private@example.invalid#profil', hostname: 'goodlease.fr', reload() { reloads++; } };
  const document = {
    title: 'GoodLease', referrer: context.referrer ?? 'https://example.invalid/start?secret=PRIVATE', cookie: '',
    head: { append(element) { scripts.push(element.src); } },
    createElement() { return { dataset: {} }; },
    querySelector(selector) { return ({ '#goodlease-marketing-config': configNode, '#marketing-consent-banner': banner, '#marketing-consent-dialog': dialog, '#marketing-consent-form': form })[selector] || null; },
    querySelectorAll(selector) { return selector === '[data-consent-choice]' ? choices : []; },
    addEventListener(event, handler) { listeners.set(`document:${event}`, handler); },
  };
  const storage = { getItem(key) { reads++; return key === 'goodlease:consent:v1' ? stored || null : null; },
    setItem(key, value) { writes.push({ key, value }); }, removeItem() {} };
  const win = { localStorage: storage, crypto: webcrypto, location, document, dispatchEvent() {},
    get sessionStorage() { if (context.storageBlocked) throw new Error('sessionStorage unavailable'); return sessionStorage; },
    history: { state: null, replaceState(state, title, url) { this.state = state; location.href = new URL(url, location.href).href; } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, handler) { listeners.set(`window:${name}`, handler); },
    fetch() { return Promise.resolve({ status: 204 }); } };
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, window: win, document, location, URL, Date: ClockDate, Event, Uint8Array, btoa, localStorage: storage });
  module.exports.initMarketingConsent();
  return { api: module.exports, scripts, writes, win, document, session, banner, inputs, listeners, get reloads() { return reloads; }, get reads() { return reads; }, get now() { return now; },
    click(choice) { listeners.get(`${choice}:click`)(); },
    save(analytics, marketing) { inputs.analytics.checked = analytics; inputs.marketing.checked = marketing; listeners.get('form:submit')({ preventDefault() {} }); },
    navigate(url) { win.history.replaceState(null, '', url); },
    storeClick(href = 'https://apps.apple.com/fr/app/good-lease-location-mat%C3%A9riel/id6758953661') {
      const link = { href }; listeners.get('document:click')({ target: { closest: () => link } }); return link;
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timers.has(id) && timer.at <= now) { timers.delete(id); timer.callback(); }
      }
    },
  };
}

test('consentement absent, invalide, périmé ou ancienne version : refus par défaut', () => {
  const now = Date.now(); const version = consentVersion(options);
  for (const raw of [null, '{', '[]', JSON.stringify({ analytics: true, marketing: true }),
    JSON.stringify({ analytics: true, marketing: true, savedAt: now - CONSENT_MAX_AGE, version }),
    JSON.stringify({ analytics: true, marketing: true, savedAt: now + 1, version }),
    JSON.stringify({ analytics: 'true', marketing: true, savedAt: now, version }),
    JSON.stringify({ analytics: true, marketing: true, savedAt: now, version: 'old' })]) assert.equal(readConsent(raw, version, now), undefined);
  assert.equal(readConsent(JSON.stringify({ analytics: false, marketing: false, savedAt: now, version }), version, now).analytics, false);
  assert.deepEqual(googleConsent({ analytics: false, marketing: false }), { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
});

test('aucun chargement ni événement marketing avant consentement et après un refus', () => {
  const app = browser();
  assert.equal(app.banner.hidden, false); assert.equal(app.scripts.length, 0);
  assert.equal(app.api.trackEvent('sign_up', { method: 'email' }), false);
  assert.ok(!app.win.dataLayer.some((entry) => entry[0] === 'event'));
  app.click('refuse'); assert.equal(app.scripts.length, 0); assert.equal(app.banner.hidden, true);
  assert.equal(JSON.parse(app.writes[0].value).analytics, false);
  const returning = browser(options, app.writes[0].value);
  assert.equal(returning.banner.hidden, true); assert.equal(returning.scripts.length, 0);
});

test('la personnalisation ne charge que les fournisseurs autorisés', () => {
  const audience = browser(); audience.save(true, false);
  assert.deepEqual(audience.scripts, ['https://www.googletagmanager.com/gtag/js?id=G-TEST123']);
  assert.ok(audience.win.dataLayer.some((entry) => entry[0] === 'consent' && entry[1] === 'update' && entry[2].ad_storage === 'denied'));
  assert.ok(audience.win.dataLayer.some((entry) => entry[0] === 'event' && entry[1] === 'page_view' && entry[2].page_location === 'https://goodlease.fr/app/'));
  const ads = browser(); ads.save(false, true);
  assert.deepEqual(ads.scripts, ['https://connect.facebook.net/en_US/fbevents.js']);
  assert.equal(ads.win.dataLayer.filter((entry) => entry[0] === 'event').length, 0);
  const gtm = browser({ ...options, gtmId: 'GTM-TEST123' });
  gtm.save(true, false); assert.deepEqual(gtm.scripts, ['https://www.googletagmanager.com/gtm.js?id=GTM-TEST123']);
  gtm.save(true, true); assert.equal(gtm.scripts.length, 1, 'Un seul conteneur après modification du choix');
});

test('acceptation puis retrait : consent mode mis à jour et nouvelle page sans traceur', () => {
  const app = browser(); app.click('accept'); assert.equal(app.scripts.length, 2);
  const gtag = app.win.gtag;
  app.win.gtag = (...args) => {
    if (args[0] === 'consent' && args[1] === 'update' && args[2].analytics_storage === 'denied') {
      assert.equal(app.win['ga-disable-G-TEST123'], true, 'La collecte est bloquée avant que Google traite le retrait');
    }
    gtag(...args);
  };
  assert.equal(app.api.trackEvent('listing_published', { listing_id: '42' }), true);
  app.save(false, false); assert.equal(app.reloads, 1);
  assert.equal(app.api.trackEvent('sign_up', { method: 'email' }), false);
  assert.equal(app.win['ga-disable-G-TEST123'], true);
  assert.ok(app.win.fbq.queue.some((entry) => entry[0] === 'consent' && entry[1] === 'revoke'));
  const returning = browser(options, app.writes.findLast(write => write.key === 'goodlease:consent:v1').value);
  assert.equal(returning.scripts.length, 0); assert.equal(returning.banner.hidden, true);
});

test('les identifiants absents désactivent même la lecture du consentement', () => {
  const app = browser({ ...options, ga4Id: '', metaPixelId: '' });
  assert.equal(app.scripts.length, 0); assert.equal(app.reads, 0); assert.equal(app.win.dataLayer, undefined);
  assert.equal(validMarketingOptions({ ...options, gtmId: 'GTM-TEST<script>', ga4Id: 'https://evil.invalid', metaPixelId: 'not-an-id' }).ga4Id, '');
});
test('un retrait dans un autre onglet bloque immédiatement les événements puis recharge les préférences', () => {
  const app = browser(); app.click('accept');
  const gtag = app.win.gtag;
  app.win.gtag = (...args) => {
    if (args[0] === 'consent' && args[1] === 'update') assert.equal(app.win['ga-disable-G-TEST123'], true);
    gtag(...args);
  };
  app.listeners.get('window:storage')({ key: 'unrelated', newValue: null });
  assert.equal(app.reloads, 0);
  app.listeners.get('window:storage')({ key: 'goodlease:consent:v1',
    newValue: JSON.stringify({ analytics: false, marketing: false, savedAt: Date.now(), version: consentVersion(options) }) });
  assert.equal(app.reloads, 1);
  assert.equal(app.api.trackEvent('view_item', { item_id: '42' }), false);
  assert.ok(app.win.fbq.queue.some(entry => entry[0] === 'consent' && entry[1] === 'revoke'));
});

test('les événements autorisent uniquement les informations publiques prévues', () => {
  const page = 'https://goodlease.fr/app/?utm_source=meta&utm_campaign=rentree&email=private@example.invalid&token=PRIVATE&gclid=Ads123#profil';
  assert.equal(measurementUrl(page), 'https://goodlease.fr/app/?utm_source=meta&utm_campaign=rentree');
  assert.equal(measurementUrl(page, true), 'https://goodlease.fr/app/?utm_source=meta&utm_campaign=rentree&gclid=Ads123');
  assert.deepEqual(eventParameters({ email: 'private@example.invalid', token: 'PRIVATE', street: 'PRIVATE', latitude: 50.123456,
    search_term: 'private@example.invalid', city: 'private@example.invalid', value: Infinity,
    item_id: '42', item_category: 'Sonorisation', has_search_term: true, items: [{ item_id: '42', item_name: 'PRIVATE', client: { email: 'PRIVATE' }, price: 12.5 }],
  }), { item_id: '42', item_category: 'Sonorisation', has_search_term: true, items: [{ item_id: '42', price: 12.5, quantity: 1 }] });
  const app = browser(); app.click('accept');
  assert.equal(app.api.trackEvent('purchase', { value: 100 }), false, 'Un clic ou une simulation ne doit jamais déclarer un paiement');
  assert.equal(app.api.trackEvent('sign_up', { method: 'email', email: 'private@example.invalid' }), true);
  const event = app.win.dataLayer.find((entry) => entry[0] === 'event' && entry[1] === 'sign_up');
  assert.equal(event, undefined, 'GA4 sign_up appartient au backend');
  assert.ok(!JSON.stringify(copy(app.win.fbq.queue)).includes('private@example.invalid'));
});

test('Meta reçoit les événements reconnus sans doublon ni conversion sur un transfert vers l’app', () => {
  const app = browser(); app.click('accept');
  app.api.trackEvent('view_item', { item_id: '42', item_category: 'Sonorisation', value: 12.5, currency: 'EUR',
    items: [{ item_id: '42', price: 12.5 }], email: 'private@example.invalid' });
  app.api.trackEvent('sign_up', { method: 'email' });
  app.api.trackEvent('listing_published', { listing_id: '42' });
  app.api.trackEvent('booking_app_handoff', { item_id: '42' });
  const meta = copy(app.win.fbq.queue);
  assert.equal(meta.filter((entry) => entry[0] === 'track' && entry[1] === 'PageView').length, 1);
  assert.deepEqual(meta.find((entry) => entry[1] === 'ViewContent'), ['track', 'ViewContent',
    { content_type: 'product', content_ids: ['42'], content_category: 'Sonorisation', currency: 'EUR', value: 12.5 }]);
  assert.equal(meta.filter((entry) => entry[1] === 'CompleteRegistration' || entry[1] === 'listing_published' || entry[1] === 'ListingPublished').length, 0, 'Business conversions have one server source');
  assert.equal(meta.filter((entry) => entry[1] === 'view_item' || entry[1] === 'sign_up').length, 0);
  assert.equal(meta.filter((entry) => entry[1] === 'InitiateCheckout' || entry[1] === 'Purchase').length, 0);
  assert.ok(!JSON.stringify(meta).includes('private@example.invalid'));
  const ga = app.win.dataLayer.filter((entry) => entry[0] === 'event' && entry[1] === 'view_item');
  assert.equal(ga.length, 1); assert.equal(ga[0][2].platform, 'web');
});

test('un clic vers le store conserve web comme origine ; les conversions serveur sont refusées', () => {
  const app = browser(); app.save(true, false);
  app.api.trackEvent('app_store_click', { destination_platform: 'ios', platform: 'ios' });
  const event = app.win.dataLayer.find((entry) => entry[0] === 'event' && entry[1] === 'app_store_click');
  assert.equal(event[2].platform, 'web'); assert.equal(event[2].destination_platform, 'ios');
  assert.equal(app.api.trackEvent('publish_listing', { item_id: '42' }), false);
  for (const name of ['rental_request_sent', 'purchase', 'booking_confirmed', 'rental_completed', 'refund']) {
    assert.equal(app.api.trackEvent(name, { value: 100 }), false);
  }
  assert.equal(app.win.fbq, undefined);
});

test('GTM garde deux finalités indépendantes et les contextes backend, sans double chargement', () => {
  const app = browser({ ...options, gtmId: 'GTM-TEST123' });
  app.save(true, false);
  assert.equal(app.win.dataLayer.filter(e => e.event === 'gl_analytics_ready').length, 1);
  assert.equal(app.win.dataLayer.filter(e => e.event === 'gl_marketing_ready').length, 0);
  assert.ok(app.writes.some(w => w.key === 'goodlease:analytics-installation:v1'));
  assert.ok(!app.writes.some(w => w.key === 'goodlease:marketing-installation:v1'));
  app.win.goodleaseGtm.loadMarketing(); assert.equal(app.win.fbq, undefined);
  app.win.goodleaseGtm.loadAnalytics(); app.win.goodleaseGtm.loadAnalytics();
  assert.equal(app.scripts.filter(s => s.includes('/gtag/js')).length, 0, 'GTM prend en charge le chargement Google ; aucun second script injecté par le site');
  assert.equal(app.win.dataLayer.filter(e => e[0] === 'event' && e[1] === 'page_view').length, 1);
  app.save(true, true); app.win.goodleaseGtm.loadMarketing(); app.win.goodleaseGtm.loadMarketing();
  assert.equal(app.scripts.filter(s => s.includes('/fbevents.js')).length, 1);
  assert.equal(app.win.fbq.queue.filter(e => e[1] === 'PageView').length, 1);
  assert.ok(app.writes.some(w => w.key === 'goodlease:marketing-installation:v1'));
  app.save(true, true);
  assert.equal(app.win.dataLayer.filter(e => e.event === 'gl_analytics_ready').length, 1);
  assert.equal(app.win.dataLayer.filter(e => e.event === 'gl_marketing_ready').length, 1);
});

test('les tags GTM tardifs respectent le retrait et aucun fournisseur ne part sur refus', () => {
  const app = browser({ ...options, gtmId: 'GTM-TEST123' });
  app.click('refuse'); assert.equal(app.scripts.length, 0);
  app.save(false, true);
  app.api.trackEvent('view_item', { item_id: '42' });
  app.save(false, false); assert.equal(app.reloads, 1);
  app.win.goodleaseGtm.loadAnalytics(); app.win.goodleaseGtm.loadMarketing(); app.win.goodleaseGtm.flush();
  assert.equal(app.scripts.length, 1, 'Seul le conteneur précédemment autorisé a été chargé');
  assert.equal(app.win.fbq, undefined);
  assert.ok(!app.win.dataLayer.some(e => e[0] === 'event'));
});

test('GTM conserve les événements en attente puis les envoie une fois ; les conversions restent serveur', () => {
  const app = browser({ ...options, gtmId: 'GTM-TEST123' }); app.click('accept');
  app.api.trackEvent('view_item', { item_id: '42', value: 12.5, currency: 'EUR', email: 'private@example.invalid' });
  app.api.trackEvent('sign_up'); app.api.trackEvent('listing_published', { listing_id: '42' });
  const layer = copy(app.win.dataLayer.filter(e => e.event === 'gl_event'));
  assert.equal(layer.length, 1); assert.equal(layer[0].gl_event_name, 'view_item');
  assert.ok(!JSON.stringify(layer).includes('private@example.invalid'));
  app.win.goodleaseGtm.flush();
  assert.ok(!app.win.dataLayer.some(e => e[0] === 'event'));
  app.win.goodleaseGtm.loadAnalytics(); app.win.goodleaseGtm.loadMarketing();
  app.win.goodleaseGtm.flush(); app.win.goodleaseGtm.flush();
  assert.equal(app.win.dataLayer.filter(e => e[0] === 'event' && e[1] === 'view_item').length, 1);
  assert.equal(app.win.fbq.queue.filter(e => e[1] === 'ViewContent').length, 1);
  assert.ok(!JSON.stringify(app.win.fbq.queue).includes('CompleteRegistration'));
});

test('acceptation successive des finalités : le produit visible est envoyé une fois par fournisseur', () => {
  const app = browser({ ...options, gtmId: 'GTM-TEST123' });
  app.api.trackEvent('view_item', { item_id: '42' });
  app.save(true, false); app.win.goodleaseGtm.loadAnalytics();
  app.save(true, true); app.win.goodleaseGtm.loadMarketing(); app.win.goodleaseGtm.flush();
  assert.equal(app.win.dataLayer.filter(e => e[0] === 'event' && e[1] === 'view_item').length, 1);
  assert.equal(app.win.fbq.queue.filter(e => e[1] === 'ViewContent').length, 1);
});

const gtmOptions = { ...options, gtmId: 'GTM-TEST123' };
const campaignUrl = 'https://goodlease.fr/?utm_source=google&utm_medium=cpc&utm_campaign=gl_launch&utm_id=gl_oct&gclid=Ads123&fbclid=Meta123&utm_content=creative&ttclid=TikTok123&email=private@example.invalid&token=PRIVATE#secret';
const gaEvent = (app, name = 'app_store_click') => app.win.dataLayer.find(e => e[0] === 'event' && e[1] === name)?.[2];
const storedChoice = app => app.writes.findLast(w => w.key === 'goodlease:consent:v1').value;
const loadGtm = app => { app.win.goodleaseGtm.loadAnalytics(); app.win.goodleaseGtm.loadMarketing(); app.win.goodleaseGtm.flush(); };

test('UTM et IDs consentis traversent les pages internes sans modifier les liens stores ni prolonger le TTL', () => {
  const entry = browser(gtmOptions, undefined, { href: campaignUrl });
  assert.equal(entry.session.size, 0); entry.save(true, true);
  const initial = JSON.parse(entry.session.get(ATTRIBUTION_KEYS.marketing));
  assert.deepEqual(initial.data, { source: 'google', medium: 'cpc', campaign: 'gl_launch', id: 'gl_oct', gclid: 'Ads123', fbclid: 'Meta123' });
  assert.ok(!JSON.stringify([...entry.session]).includes('PRIVATE'));
  for (const path of ['/app/', '/louer-son-materiel/']) {
    const page = browser(gtmOptions, storedChoice(entry), { href: `https://goodlease.fr${path}`, referrer: '', session: entry.session, now: entry.now + 600000 });
    loadGtm(page);
    const href = 'https://play.google.com/store/apps/details?id=com.goodlease.app';
    assert.equal(page.storeClick(href).href, href); page.win.goodleaseGtm.flush();
    const event = gaEvent(page); const url = new URL(event.page_location);
    assert.equal(url.pathname, path); assert.equal(url.searchParams.get('utm_campaign'), 'gl_launch'); assert.equal(url.searchParams.get('gclid'), 'Ads123');
    assert.equal(event.page_referrer, ''); assert.equal(event.platform, 'web'); assert.equal(event.destination_platform, 'android');
    assert.equal(JSON.parse(entry.session.get(ATTRIBUTION_KEYS.marketing)).capturedAt, initial.capturedAt);
  }
});

test('statistiques seules : contexte UTM retrouvé, aucun click ID conservé ou restauré après accord publicitaire', () => {
  for (const config of [options, gtmOptions]) {
    const app = browser(config, undefined, { href: campaignUrl }); app.save(true, false);
    assert.equal(app.session.has(ATTRIBUTION_KEYS.marketing), false);
    assert.ok(!app.session.get(ATTRIBUTION_KEYS.analytics).includes('gclid'));
    app.navigate('/app/#explorer');
    if (config.gtmId) loadGtm(app);
    const href = 'https://apps.apple.com/fr/app/good-lease-location-mat%C3%A9riel/id6758953661';
    assert.equal(app.storeClick(href).href, href); app.win.goodleaseGtm?.flush();
    const url = new URL(gaEvent(app).page_location);
    assert.equal(url.searchParams.get('utm_source'), 'google'); assert.equal(url.searchParams.has('gclid'), false); assert.equal(url.searchParams.has('fbclid'), false);
    app.save(true, true);
    assert.ok(!JSON.stringify([...app.session]).includes('Ads123')); assert.ok(!JSON.stringify([...app.session]).includes('Meta123'));
  }
});

test('tag GTM retardé : clic et produit gardent les URL de l’action après changement de route et de referrer', () => {
  const referrer = 'https://example.invalid/?utm_source=partner&utm_campaign=gl_ref&gclid=Ref123&token=PRIVATE';
  const app = browser(gtmOptions, undefined, { href: campaignUrl, referrer }); app.save(true, true);
  const original = app.win.location.href; app.storeClick(); app.api.trackEvent('view_item', { item_id: '42' });
  app.navigate('/app/#reservations'); app.document.referrer = 'https://other.invalid/'; loadGtm(app);
  for (const name of ['app_store_click', 'view_item']) {
    const event = gaEvent(app, name);
    assert.equal(event.page_location, original); assert.equal(event.page_referrer, measurementUrl(referrer, true));
  }
});

test('le produit visible avant consentement garde sa page lors du rattrapage autorisé', () => {
  const app = browser(gtmOptions, undefined, { href: campaignUrl.replace('goodlease.fr/?', 'goodlease.fr/annonce/42?') });
  app.api.trackEvent('view_item', { item_id: '42' }); app.save(true, false);
  app.navigate('/app/#explorer'); loadGtm(app);
  assert.equal(new URL(gaEvent(app, 'view_item').page_location).pathname, '/annonce/42');
  assert.equal(new URL(gaEvent(app, 'view_item').page_location).searchParams.get('utm_source'), 'google');
});

test('retrait publicitaire avant flush : cache et URL purgés, action statistique sans IDs, aucun retour des IDs', () => {
  const app = browser(gtmOptions, undefined, { href: campaignUrl }); app.save(true, true); app.storeClick();
  app.save(true, false);
  assert.equal(app.session.has(ATTRIBUTION_KEYS.marketing), false); assert.equal(app.session.has(ATTRIBUTION_KEYS.analytics), true);
  loadGtm(app);
  assert.equal(new URL(gaEvent(app).page_location).searchParams.has('gclid'), false); assert.equal(app.win.fbq, undefined);
  app.save(true, true); loadGtm(app);
  assert.ok(!JSON.stringify([...app.session]).includes('Ads123'));
  assert.ok(!app.win.fbq.queue.some(e => e[1] === 'app_store_click'), 'Le retrait annule définitivement la copie publicitaire en attente');
});

test('expiration à 30 minutes : purge sans collecte, aucun contexte expiré dans un événement retardé', () => {
  const app = browser(gtmOptions, undefined, { href: campaignUrl }); app.save(true, true); app.storeClick();
  app.advance(ATTRIBUTION_TTL - 1); app.save(true, true);
  assert.equal(app.session.size, 2); app.advance(1);
  assert.equal(app.session.size, 0); assert.ok(!app.win.dataLayer.some(e => e[0] === 'event'));
  assert.equal(new URL(app.win.location.href).searchParams.size, 0);
  loadGtm(app);
  assert.equal(new URL(gaEvent(app).page_location).searchParams.size, 0);
  assert.equal(new URL(gaEvent(app).page_referrer).searchParams.size, 0);
});

test('refus, consentement expiré et retrait entre onglets purgent le contexte sans collecte tardive', () => {
  const origin = browser(gtmOptions, undefined, { href: campaignUrl }); origin.save(true, true);
  const expired = JSON.stringify({ analytics: true, marketing: true, version: consentVersion(gtmOptions), savedAt: origin.now - CONSENT_MAX_AGE });
  const refused = JSON.stringify({ analytics: false, marketing: false, version: consentVersion(gtmOptions), savedAt: origin.now });
  for (const stored of [undefined, expired, refused]) {
    const app = browser(gtmOptions, stored, { session: new Map(origin.session), now: origin.now });
    app.storeClick(); loadGtm(app);
    assert.equal(app.session.size, 0); assert.equal(app.scripts.length, 0); assert.ok(!app.win.dataLayer.some(e => e[0] === 'event'));
  }
  origin.storeClick();
  origin.listeners.get('window:storage')({ key: 'goodlease:consent:v1', newValue: refused });
  loadGtm(origin);
  assert.equal(origin.session.size, 0); assert.equal(origin.reloads, 1); assert.ok(!origin.win.dataLayer.some(e => e[0] === 'event'));
  const reload = browser(gtmOptions, refused, { session: origin.session });
  assert.equal(reload.session.size, 0); assert.equal(reload.scripts.length, 0);
});

test('sessionStorage inaccessible : mémoire locale, URL figées et expiration fonctionnent', () => {
  const app = browser(gtmOptions, undefined, { href: campaignUrl, storageBlocked: true });
  assert.doesNotThrow(() => app.save(true, true)); app.navigate('/app/'); app.storeClick(); loadGtm(app);
  assert.equal(new URL(gaEvent(app).page_location).searchParams.get('gclid'), 'Ads123'); assert.equal(app.session.size, 0);
  assert.doesNotThrow(() => app.advance(ATTRIBUTION_TTL));
  app.api.trackEvent('search'); app.win.goodleaseGtm.flush();
  assert.equal(new URL(gaEvent(app, 'search').page_location).searchParams.size, 0);
});
