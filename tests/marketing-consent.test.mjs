import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { readConsent, consentVersion, googleConsent, eventParameters, measurementUrl, validMarketingOptions, CONSENT_MAX_AGE } from '../src/scripts/marketing-consent.ts';

const options = { gtmId: '', ga4Id: 'G-TEST123', metaPixelId: '123456789012345', consentVersion: 'test-v1' };
const compiled = (await build({ entryPoints: ['src/scripts/marketing-consent.ts'], bundle: true, write: false, format: 'cjs', platform: 'browser' })).outputFiles[0].text;
const copy = (value) => JSON.parse(JSON.stringify(value));

function browser(config = options, stored) {
  const listeners = new Map();
  const node = (name, dataset = {}) => ({ dataset, hidden: true, addEventListener(event, handler) { listeners.set(`${name}:${event}`, handler); } });
  const banner = node('banner');
  const inputs = { analytics: { checked: false }, marketing: { checked: false } };
  const form = { ...node('form'), elements: { namedItem: (name) => inputs[name] } };
  const dialog = { ...node('dialog'), close() {}, showModal() {}, querySelector() { return null; } };
  const configNode = node('config', { config: JSON.stringify(config) });
  const choices = [node('accept', { consentChoice: 'accept' }), node('refuse', { consentChoice: 'refuse' })];
  const scripts = []; const writes = []; let reloads = 0; let reads = 0;
  const location = { href: 'https://goodlease.fr/app/?email=private@example.invalid#profil', hostname: 'goodlease.fr', reload() { reloads++; } };
  const document = {
    title: 'GoodLease', referrer: 'https://example.invalid/start?secret=PRIVATE', cookie: '',
    head: { append(element) { scripts.push(element.src); } },
    createElement() { return { dataset: {} }; },
    querySelector(selector) { return ({ '#goodlease-marketing-config': configNode, '#marketing-consent-banner': banner, '#marketing-consent-dialog': dialog, '#marketing-consent-form': form })[selector] || null; },
    querySelectorAll(selector) { return selector === '[data-consent-choice]' ? choices : []; },
    addEventListener(event, handler) { listeners.set(`document:${event}`, handler); },
  };
  const storage = { getItem(key) { reads++; return key === 'goodlease:consent:v1' ? stored || null : null; },
    setItem(key, value) { writes.push({ key, value }); }, removeItem() {} };
  const win = { localStorage: storage, crypto: webcrypto, location, dispatchEvent() {}, fetch() { return Promise.resolve({ ok: true }); } };
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, window: win, document, location, URL, Date, Event, Uint8Array, btoa, localStorage: storage });
  module.exports.initMarketingConsent();
  return { api: module.exports, scripts, writes, win, banner, inputs, listeners, get reloads() { return reloads; }, get reads() { return reads; },
    click(choice) { listeners.get(`${choice}:click`)(); },
    save(analytics, marketing) { inputs.analytics.checked = analytics; inputs.marketing.checked = marketing; listeners.get('form:submit')({ preventDefault() {} }); },
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
  gtm.save(true, false); assert.equal(gtm.scripts.length, 0);
  gtm.save(true, true); assert.deepEqual(gtm.scripts, ['https://www.googletagmanager.com/gtm.js?id=GTM-TEST123']);
});

test('acceptation puis retrait : consent mode mis à jour et nouvelle page sans traceur', () => {
  const app = browser(); app.click('accept'); assert.equal(app.scripts.length, 2);
  assert.equal(app.api.trackEvent('listing_published', { listing_id: '42' }), true);
  app.save(false, false); assert.equal(app.reloads, 1);
  assert.equal(app.api.trackEvent('sign_up', { method: 'email' }), false);
  assert.equal(app.win['ga-disable-G-TEST123'], true);
  assert.ok(app.win.fbq.queue.some((entry) => entry[0] === 'consent' && entry[1] === 'revoke'));
  const returning = browser(options, app.writes.at(-1).value);
  assert.equal(returning.scripts.length, 0); assert.equal(returning.banner.hidden, true);
});

test('les identifiants absents désactivent même la lecture du consentement', () => {
  const app = browser({ ...options, ga4Id: '', metaPixelId: '' });
  assert.equal(app.scripts.length, 0); assert.equal(app.reads, 0); assert.equal(app.win.dataLayer, undefined);
  assert.equal(validMarketingOptions({ ...options, gtmId: 'GTM-TEST<script>', ga4Id: 'https://evil.invalid', metaPixelId: 'not-an-id' }).ga4Id, '');
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
  assert.equal(meta.filter((entry) => entry[1] === 'CompleteRegistration').length, 1);
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
