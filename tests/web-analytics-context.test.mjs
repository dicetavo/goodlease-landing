import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { updateWebAnalyticsConsent, webAnalyticsHeaders, identifyWebAnalytics, webCampaign, WEB_INSTALL_KEY } from '../src/scripts/web-analytics-context.ts';

function browser() {
  const storage = new Map(); const google = []; const revoke = [];
  return { storage, google, revoke, win: {
    crypto: webcrypto, location: { href: 'https://goodlease.fr/app/?utm_source=meta&utm_medium=paid_social&utm_campaign=gl_launch&email=private@example.invalid' },
    localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    dispatchEvent() {}, fetch: (...args) => { revoke.push(args); return Promise.resolve({ ok: true }); },
    gtag: (...args) => { google.push(args); if (args[0] === 'get') args[3](args[2] === 'client_id' ? '12345.1770000000' : 1770000000); },
  } };
}
const decode = header => JSON.parse(Buffer.from(header, 'base64url').toString());

test('web consent supplies real gtag identifiers and refusal erases/revokes them', async () => {
  const app = browser();
  updateWebAnalyticsConsent(false, 'G-TEST123', app.win);
  assert.deepEqual(await webAnalyticsHeaders(), {}); assert.equal(app.storage.size, 0); assert.equal(app.google.length, 0);
  updateWebAnalyticsConsent(true, 'G-TEST123', app.win);
  const context = decode((await webAnalyticsHeaders('agent'))['X-GoodLease-Analytics']);
  assert.equal(context.clientId, '12345.1770000000'); assert.equal(context.sessionId, 1770000000);
  assert.equal(context.platform, 'web'); assert.equal(context.bookingFlow, 'agent'); assert.equal(context.appInstanceId, undefined);
  assert.deepEqual(context.campaign, { source: 'meta', medium: 'paid_social', name: 'gl_launch' });
  assert.ok(!JSON.stringify(context).includes('private@')); assert.ok(!JSON.stringify(context).includes('apiSecret'));
  const install = app.storage.get(WEB_INSTALL_KEY);
  updateWebAnalyticsConsent(false, 'G-TEST123', app.win);
  assert.deepEqual(await webAnalyticsHeaders(), {}); assert.equal(app.storage.size, 0);
  const denied = decode(app.revoke[0][1].headers['X-GoodLease-Analytics']);
  assert.equal(denied.installationId, install); assert.equal(denied.analytics, false);
  assert.equal(denied.clientId, undefined); assert.equal(denied.sessionId, undefined);
});

test('late callbacks cannot recover consent and server identity is reset on logout', async () => {
  const app = browser(); const callbacks = [];
  app.win.gtag = (...args) => { app.google.push(args); if (args[0] === 'get') callbacks.push([args[2], args[3]]); };
  updateWebAnalyticsConsent(true, 'G-TEST123', app.win);
  identifyWebAnalytics({ user_id: '19', account_type: 'internal', user_type: 'both' }); identifyWebAnalytics();
  assert.equal(app.google.at(-1)[1].user_id, null); assert.equal(app.google.at(-1)[1].user_properties.user_type, 'guest');
  const pending = webAnalyticsHeaders(); updateWebAnalyticsConsent(false, 'G-TEST123', app.win);
  callbacks.forEach(([key, callback]) => callback(key === 'client_id' ? '123.1770000000' : 1770000000));
  assert.deepEqual(await pending, {});
  assert.deepEqual(webCampaign('https://goodlease.fr/?utm_source=private_person&utm_medium=email&utm_campaign=private@example.invalid&gclid=PRIVATE'), { medium: 'email' });
});

test('an unavailable Google SDK or browser randomness never blocks web requests', async () => {
  const app = browser();
  app.win.gtag = () => { throw new Error('blocked SDK'); };
  updateWebAnalyticsConsent(true, 'G-TEST123', app.win);
  assert.deepEqual(await webAnalyticsHeaders(), {});
  assert.doesNotThrow(() => identifyWebAnalytics());
  updateWebAnalyticsConsent(false, 'G-TEST123', app.win);
  app.win.crypto = { getRandomValues() { throw new Error('unavailable'); } };
  assert.doesNotThrow(() => updateWebAnalyticsConsent(true, 'G-TEST123', app.win));
  assert.deepEqual(await webAnalyticsHeaders(), {});
});
