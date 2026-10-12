import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { updateWebMarketingConsent, webMarketingHeaders, MARKETING_INSTALL_KEY, MARKETING_REVOKE_KEY } from '../src/scripts/web-marketing-context.ts';
function browser(url = 'https://goodlease.fr/app/?email=PRIVATE') {
  const storage = new Map(); const requests = [];
  return { storage, requests, win: { crypto: webcrypto, location: { href: url },
    document: { cookie: '_fbp=fb.1.1770000000000.123; _fbc=fb.1.1770000000000.Abc-123; session=PRIVATE' },
    localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    dispatchEvent() {}, fetch: (...args) => { requests.push(args); return Promise.resolve({ status: 204 }); } } };
}
test('advertising works independently of Google and refusal erases and revokes the same capability', () => {
  const app = browser(); updateWebMarketingConsent(false, '1132228155919207', app.win);
  assert.deepEqual(webMarketingHeaders(), {}); assert.equal(app.storage.size, 0);
  updateWebMarketingConsent(true, '1132228155919207', app.win);
  const payload = JSON.parse(Buffer.from(webMarketingHeaders()['X-GoodLease-Marketing'], 'base64url').toString());
  assert.equal(payload.marketing, true); assert.equal(payload.platform, 'web');
  assert.equal(payload.fbp, 'fb.1.1770000000000.123'); assert.equal(payload.fbc, 'fb.1.1770000000000.Abc-123');
  assert.ok(!JSON.stringify(payload).includes('PRIVATE')); assert.equal(payload.analytics, undefined);
  const installation = app.storage.get(MARKETING_INSTALL_KEY);
  updateWebMarketingConsent(false, '1132228155919207', app.win);
  assert.deepEqual(webMarketingHeaders(), {}); assert.equal(app.storage.has(MARKETING_INSTALL_KEY), false);
  assert.deepEqual(JSON.parse(app.storage.get(MARKETING_REVOKE_KEY)), [installation]);
  const denied = JSON.parse(Buffer.from(app.requests[0][1].headers['X-GoodLease-Marketing'], 'base64url').toString());
  assert.equal(denied.installationId, installation); assert.equal(denied.marketing, false); assert.equal(denied.fbp, undefined);
});
test('offline withdrawal survives reload until 204 and reacceptance uses a different installation', async () => {
  const app = browser();
  const listeners = new Map(); app.win.addEventListener = (name, callback) => listeners.set(name, callback);
  app.win.fetch = (...args) => { app.requests.push(args); return Promise.reject(new Error('offline')); };
  updateWebMarketingConsent(true, '1132228155919207', app.win);
  const revoked = app.storage.get(MARKETING_INSTALL_KEY);
  updateWebMarketingConsent(false, '1132228155919207', app.win);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(webMarketingHeaders(), {});
  assert.deepEqual(JSON.parse(app.storage.get(MARKETING_REVOKE_KEY)), [revoked]);
  const reloaded = { ...app.win, fetch: (...args) => { app.requests.push(args); return Promise.resolve({ status: 400 }); } };
  updateWebMarketingConsent(false, '1132228155919207', reloaded);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requests.length, 2);
  assert.ok(app.storage.has(MARKETING_REVOKE_KEY), 'An error response must not acknowledge the refusal');
  reloaded.fetch = (...args) => { app.requests.push(args); return Promise.resolve({ status: 204 }); };
  updateWebMarketingConsent(true, '1132228155919207', reloaded);
  const accepted = app.storage.get(MARKETING_INSTALL_KEY);
  assert.notEqual(accepted, revoked);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.storage.has(MARKETING_REVOKE_KEY), false);
  assert.equal(JSON.parse(Buffer.from(webMarketingHeaders()['X-GoodLease-Marketing'], 'base64url').toString()).installationId, accepted);
  assert.equal(JSON.parse(Buffer.from(app.requests.at(-1)[1].headers['X-GoodLease-Marketing'], 'base64url').toString()).installationId, revoked);
});
test('returning online retries a failed withdrawal without waiting for navigation', async () => {
  const app = browser(); const listeners = new Map();
  app.win.addEventListener = (name, callback) => listeners.set(name, callback);
  app.win.fetch = (...args) => { app.requests.push(args); return Promise.reject(new Error('offline')); };
  updateWebMarketingConsent(true, '1132228155919207', app.win);
  updateWebMarketingConsent(false, '1132228155919207', app.win);
  await new Promise(resolve => setImmediate(resolve));
  app.win.fetch = (...args) => { app.requests.push(args); return Promise.resolve({ status: 204 }); };
  listeners.get('online')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requests.length, 2);
  assert.equal(app.storage.has(MARKETING_REVOKE_KEY), false);
  assert.deepEqual(webMarketingHeaders(), {});
});
test('acknowledgement never erases another tab withdrawal queued while the request was in flight', async () => {
  const app = browser(); let acknowledge;
  app.win.fetch = () => new Promise(resolve => { acknowledge = resolve; });
  updateWebMarketingConsent(true, '1132228155919207', app.win);
  updateWebMarketingConsent(false, '1132228155919207', app.win);
  const queued = JSON.parse(app.storage.get(MARKETING_REVOKE_KEY));
  const other = 'f'.repeat(32);
  app.storage.set(MARKETING_REVOKE_KEY, JSON.stringify([...queued, other]));
  acknowledge({ status: 204 }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(app.storage.get(MARKETING_REVOKE_KEY)), [other]);
});
test('preview, invalid cookies and unavailable storage never leak data or block requests', () => {
  const preview = browser('https://preview.goodlease-landing.pages.dev/app/');
  updateWebMarketingConsent(true, '1132228155919207', preview.win); assert.deepEqual(webMarketingHeaders(), {});
  const app = browser(); app.win.document.cookie = '_fbp=PRIVATE@example.invalid; _fbc=invalid';
  updateWebMarketingConsent(true, '1132228155919207', app.win);
  const payload = JSON.parse(Buffer.from(webMarketingHeaders()['X-GoodLease-Marketing'], 'base64url').toString());
  assert.equal(payload.fbp, undefined); assert.equal(payload.fbc, undefined);
  updateWebMarketingConsent(false, '1132228155919207', app.win);
  app.win.crypto = { getRandomValues() { throw new Error('unavailable'); } };
  assert.doesNotThrow(() => updateWebMarketingConsent(true, '1132228155919207', app.win));assert.deepEqual(webMarketingHeaders(), {});
});
