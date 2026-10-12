import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const compiled = (await build({ entryPoints: ['functions/api/app/[[path]].ts'], bundle: true, write: false, format: 'cjs', platform: 'browser' })).outputFiles[0].text;
const header = Buffer.from(JSON.stringify({ installationId: 'a'.repeat(32), marketing: false, consentVersion: 1, platform: 'web' })).toString('base64url');
function handler() {
  const calls = []; const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, Headers, Response, URL,
    fetch: async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 204 }); } });
  return { calls, handle: request => module.exports.onRequest({ request, params: { path: ['marketing', 'revoke'] }, env: {}, waitUntil() {} }) };
}
test('an empty POST stream forwards anonymous withdrawal and preserves the purpose-specific header', async () => {
  const proxy = handler();
  const request = new Request('https://goodlease.fr/api/app/marketing/revoke', { method: 'POST', body: new Uint8Array(0),
    headers: { 'X-GoodLease-Marketing': header, 'User-Agent': 'Browser test' } });
  assert.ok(request.body, 'Real edge requests can have a body stream with zero bytes');
  assert.equal((await proxy.handle(request)).status, 204);
  assert.equal(proxy.calls.length, 1); assert.ok(proxy.calls[0].url.pathname.endsWith('/api/marketing/revoke'));
  assert.equal(proxy.calls[0].options.headers.get('x-goodlease-marketing'), header);
  assert.equal(proxy.calls[0].options.headers.get('user-agent'), 'Browser test');
  assert.equal(proxy.calls[0].options.headers.get('authorization'), null);
  assert.equal(proxy.calls[0].options.body, undefined);
});
test('withdrawal never forwards a nonempty request body', async () => {
  const proxy = handler();
  const request = new Request('https://goodlease.fr/api/app/marketing/revoke', { method: 'POST', body: new Uint8Array([123]),
    headers: { 'X-GoodLease-Marketing': header } });
  assert.equal((await proxy.handle(request)).status, 400); assert.equal(proxy.calls.length, 0);
});
