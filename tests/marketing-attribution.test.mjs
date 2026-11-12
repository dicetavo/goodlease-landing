import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTRIBUTION_KEYS, ATTRIBUTION_TTL, createMarketingAttribution } from '../src/scripts/marketing-attribution.ts';

const first = 'https://goodlease.fr/?utm_source=google&utm_medium=cpc&utm_campaign=gl_first&utm_id=gl_one&gclid=Ads123';
function fixture() {
  const values = new Map(); let now = 1770000000000;
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  return { values, context: () => createMarketingAttribution(() => storage, 'test', () => now), advance(ms) { now += ms; } };
}

test('nouvelle arrivée remplace l’origine ; relecture et rechargement ne prolongent jamais les 30 minutes', () => {
  const app = fixture(); const context = app.context(); const consent = { analytics: true, marketing: true };
  context.updateConsent(consent, first); const original = app.values.get(ATTRIBUTION_KEYS.analytics);
  app.advance(600000); context.snapshot('https://goodlease.fr/app/', ''); context.updateConsent(consent, first);
  assert.equal(app.values.get(ATTRIBUTION_KEYS.analytics), original);
  const reload = app.context(); reload.updateConsent(consent, first);
  assert.equal(app.values.get(ATTRIBUTION_KEYS.analytics), original);
  reload.updateConsent(consent, 'https://goodlease.fr/?utm_source=newsletter&utm_medium=email&utm_campaign=gl_second');
  const url = new URL(reload.snapshot('https://goodlease.fr/app/', '').page_location);
  assert.equal(url.searchParams.get('utm_campaign'), 'gl_second'); assert.equal(url.searchParams.has('gclid'), false);
  app.advance(ATTRIBUTION_TTL); const expired = app.context();
  expired.updateConsent(consent, 'https://goodlease.fr/?utm_source=newsletter&utm_medium=email&utm_campaign=gl_second');
  assert.equal(app.values.size, 0, 'La même URL ne ressuscite pas un contexte déjà expiré');
});

test('purge par finalité et revalidation du stockage avec l’allowlist existante', () => {
  const app = fixture(); const context = app.context(); context.updateConsent({ analytics: true, marketing: true }, first);
  context.updateConsent({ analytics: false, marketing: true });
  assert.equal(app.values.has(ATTRIBUTION_KEYS.analytics), false); assert.equal(app.values.has(ATTRIBUTION_KEYS.marketing), true);
  context.updateConsent({ analytics: false, marketing: false }); assert.equal(app.values.size, 0);
  app.values.set(ATTRIBUTION_KEYS.analytics, JSON.stringify({ version: 'test', capturedAt: 1770000000000,
    data: { source: 'google', medium: 'cpc', campaign: 'private@example.invalid', id: '123456', gclid: 'Ads123', token: 'PRIVATE', url: first } }));
  const restored = app.context(); restored.updateConsent({ analytics: true, marketing: false });
  assert.deepEqual(JSON.parse(app.values.get(ATTRIBUTION_KEYS.analytics)).data, { source: 'google', medium: 'cpc' });
  assert.ok(!JSON.stringify([...app.values]).includes('PRIVATE'));
});

test('seuls les cinq IDs marketing actuels survivent, jamais dans la partie statistiques', () => {
  const app = fixture(); const context = app.context();
  context.updateConsent({ analytics: true, marketing: true }, `${first}&dclid=Dc_1&gbraid=Gb-1&wbraid=Wb_1&fbclid=Fb-1&ttclid=Tt_1&msclkid=Ms_1`);
  const marketing = JSON.parse(app.values.get(ATTRIBUTION_KEYS.marketing)).data;
  for (const key of ['gclid', 'dclid', 'gbraid', 'wbraid', 'fbclid']) assert.ok(marketing[key]);
  assert.equal(marketing.ttclid, undefined); assert.equal(marketing.msclkid, undefined);
  const analytics = JSON.parse(app.values.get(ATTRIBUTION_KEYS.analytics)).data;
  assert.deepEqual(Object.keys(analytics), ['source', 'medium', 'campaign', 'id']);
});
