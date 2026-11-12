import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { articlesToPublish, builtArticles, builtAssets, unreachable } from '../scripts/production.mjs';

const site = 'https://site.example.invalid';

function fakeBuild(articles, assets = []) {
  const dist = mkdtempSync(join(tmpdir(), 'goodlease-dist-'));
  mkdirSync(join(dist, 'blog'), { recursive: true });
  writeFileSync(join(dist, 'blog', 'index.html'), '');
  for (const name of articles) {
    mkdirSync(join(dist, 'blog', name));
    writeFileSync(join(dist, 'blog', name, 'index.html'), '');
  }
  mkdirSync(join(dist, '_astro'));
  for (const name of assets) writeFileSync(join(dist, '_astro', name), '');
  return dist;
}

/** Faux site : chemins connus en 200, le reste en 404, comme la production. */
function siteServing(paths, calls = []) {
  return async (url) => {
    const { pathname } = new URL(url);
    calls.push(pathname);
    return new Response(null, { status: paths.includes(pathname) ? 200 : 404 });
  };
}

test('le build expose ses articles et ses fichiers empreintés', () => {
  const dist = fakeBuild(['sono-lille-louer', 'location-photobooth-prix'], ['app.abc123.css', 'page.def456.js', 'photo.png']);
  assert.deepEqual(builtArticles(dist), ['/blog/location-photobooth-prix/', '/blog/sono-lille-louer/']);
  assert.deepEqual(builtAssets(dist), ['/_astro/app.abc123.css', '/_astro/page.def456.js']);
  assert.deepEqual(builtArticles(join(dist, 'absent')), []);
});

test('seul un article arrivé à sa date et absent du site déclenche une mise en ligne', async () => {
  const dist = fakeBuild(['deja-en-ligne', 'paru-ce-matin']);
  const fetchImpl = siteServing(['/blog/deja-en-ligne/']);
  assert.deepEqual(await articlesToPublish({ dist, site, fetchImpl }), [{ path: '/blog/paru-ce-matin/', status: 404 }]);
  assert.deepEqual(await articlesToPublish({ dist, site, fetchImpl: siteServing(['/blog/deja-en-ligne/', '/blog/paru-ce-matin/']) }), []);
  assert.deepEqual(await articlesToPublish({ dist: fakeBuild([]), site, fetchImpl }), [], 'sans article construit, rien à publier');
});

test('un site injoignable ne bloque pas la parution : l’article reste à publier', async () => {
  const dist = fakeBuild(['paru-ce-matin']);
  const fetchImpl = async () => { throw new Error('réseau coupé'); };
  assert.deepEqual(await articlesToPublish({ dist, site, fetchImpl }), [{ path: '/blog/paru-ce-matin/', status: 0 }]);
});

test('la vérification réessaie puis signale ce qui ne répond toujours pas', async () => {
  const calls = [];
  let live = ['/'];
  const fetchImpl = async (url) => {
    const response = await siteServing(live, calls)(url);
    if (calls.length === 2) live = ['/', '/blog/tardif/'];
    return response;
  };
  const failed = await unreachable(['/', '/blog/tardif/', '/blog/absent/'], { site, fetchImpl, attempts: 2, delayMs: 0 });
  assert.deepEqual(failed, [{ path: '/blog/absent/', status: 404 }]);
  assert.deepEqual(calls, ['/', '/blog/tardif/', '/blog/absent/', '/blog/tardif/', '/blog/absent/']);
});

