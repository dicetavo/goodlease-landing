import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'parse5';
import { Miniflare, Response } from 'miniflare';

// Exercise Wrangler's real router and workerd's HTMLRewriter using local fixtures.
// Run after npm run build: node --experimental-strip-types --test 'tests/*.test.mjs'
const workerDir = await mkdtemp(join(tmpdir(), 'goodlease-seo-'));
let worker;
try {
  await promisify(execFile)(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js', 'pages', 'functions', 'build', '--outdir', workerDir,
  ]);
  worker = await readFile(join(workerDir, 'index.js'), 'utf8');
} finally { await rm(workerDir, { recursive: true, force: true }); }

const elements = (node) => [node, ...(node.childNodes || []).flatMap(elements)];
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const text = (node) => node.value || (node.childNodes || []).map(text).join('');

const privateValues = ['private@example.invalid', 'PRIVATE-STREET-123', 'PRIVATE-WALLET', '50.123456', '3.123456'];
const lease = {
  id: 42, title: 'Enceinte <script>alert(1)</script>', description: 'Première ligne\nSon clair & puissant </script><script>alert(2)</script>" onmouseover="alert(3) &lt;em&gt;',
  priceByPeriod: 12.5, periodType: 'WEEKLY', categoryId: 1, available: true,
  averageRating: 4.5, reviewCount: 3, updatedAt: '2026-10-01T12:00:00Z',
  photoUrls: ['javascript:alert(1)', 'https://SECRET-PHOTO:PRIVATE@images.example.invalid/hidden.jpg', 'https://images.example.invalid/enceinte.jpg'],
  address: { city: 'Lille', country: 'France', street: privateValues[1], latitude: privateValues[3], longitude: privateValues[4] },
  email: privateValues[0], client: { email: privateValues[0], wallet: privateValues[2] },
};

const schemas = (html) => [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
const graph = (html) => schemas(html).flatMap((item) => item['@graph'] || [item]);
const product = (html) => graph(html).find((item) => item['@type'] === 'Product');
const leaseSeoPath = '/materiel/enceinte-script-alert-1-script-lille-42';
const h1 = (html) => html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];

test('SEO public : HTML serveur, catalogue, sitemap et confidentialité', async (t) => {
  let mode = 'published';
  let calls = [];
  let imageCalls = 0;
  const mf = new Miniflare({
    modules: true, script: worker, compatibilityDate: '2025-01-01',
    bindings: { GOODLEASE_API_BASE_URL: 'https://api.example.invalid' },
    serviceBindings: {
      ASSETS: async (request) => {
        const path = new URL(request.url).pathname;
        const file = path === '/' ? 'dist/index.html' : `dist${path.replace(/\/$/, '')}/index.html`;
        try { return new Response(await readFile(file), { headers: { 'Content-Type': 'text/html', ETag: 'static-shell', 'Last-Modified': 'Mon, 01 Jan 2024 00:00:00 GMT' } }); }
        catch { return new Response(await readFile('dist/404.html'), { status: 404 }); }
      },
    },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.origin === 'https://goodlease.s3.us-east-1.amazonaws.com') {
        imageCalls++;
        if (mode === 'image-outage') return new Response('Unavailable', { status: 503 });
        if (mode === 'image-html') return new Response('<script>PRIVATE</script>', { headers: { 'Content-Type': 'text/html' } });
        if (mode === 'image-redirect') return new Response(null, { status: 302, headers: { Location: 'https://private.example.invalid/' } });
        return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'Content-Type': 'image/jpeg' } });
      }
      assert.equal(url.origin, 'https://api.example.invalid');
      calls.push(url.pathname + url.search);
      if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 5_000));
      if (mode === 'outage') return new Response('Unavailable', { status: 503 });
      if (url.pathname === '/api/leases/42') {
        if (mode === 'missing') return new Response('{}', { status: 404 });
        if (mode === 'bad-id') return Response.json({ ...lease, id: 99 });
        return Response.json({ ...lease, available: mode !== 'withdrawn', ...(mode === 'unrated' ? { averageRating: 5, reviewCount: 0 } : {}) });
      }
      if (url.pathname === '/api/client/9') return Response.json({ id: 9, username: 'Loueur public', email: privateValues[0], wallet: privateValues[2] });
      assert.equal(url.pathname, '/api/leases');
      const page = Number(url.searchParams.get('page'));
      if (mode === 'malformed') return Response.json({ content: [lease] });
      if (mode === 'empty') return Response.json([]);
      if (mode === 'no-dates') { const { updatedAt, ...record } = lease; return Response.json([{ ...record, createdAt: '2026-10-01' }]); }
      if (mode === 'metro') return Response.json([42, 43, 44].map((id) => ({ ...lease, id, address: { ...lease.address, city: 'Marquette-lez-Lille' } })));
      if (mode === 'repeat' || mode === 'repeat-final') return Response.json(
        Array.from({ length: 100 }, (_, index) => ({ ...lease, id: index + 1 })),
        mode === 'repeat-final' ? { headers: { 'X-Total-Count': '200' } } : undefined,
      );
      if (mode === 'empty-final') return Response.json(page === 0 ? [lease] : [], {
        headers: { 'X-Total-Pages': '2', 'X-Total-Count': '2' },
      });
      if (mode === 'wrong-total') return Response.json([lease], {
        headers: { 'X-Total-Pages': '1', 'X-Total-Count': '2' },
      });
      if (mode === 'pagination') {
        // Server-enforced smaller pages + withdrawn records must not truncate discovery.
        return Response.json(page === 0 ? [{ ...lease, id: 41, available: false }] : [lease, { ...lease, id: 43, categoryId: 5, address: { city: 'Roubaix' } }], {
          headers: { 'X-Total-Pages': '2', 'X-Total-Count': '3' },
        });
      }
      return Response.json([lease, { ...lease, id: 43, available: false }]);
    },
  });
  const get = async (path, method = 'GET') => {
    const response = await mf.dispatchFetch(`https://goodlease.fr${path}`, { method, redirect: 'manual' });
    return { response, html: await response.text() };
  };
  try {
    await t.test('la fiche contient toutes les données publiques sans JavaScript applicatif', async () => {
      const { response, html } = await get('/annonce/42');
      assert.equal(response.status, 200);
      assert.match(h1(html), /Enceinte &lt;script&gt;/);
      assert.match(html, /Première ligne\nSon clair &amp; puissant/);
      assert.match(html, /12,50[^<]*€ \/ semaine/);
      assert.match(html, /Lille/);
      assert.match(html, /src="https:\/\/images.example.invalid\/enceinte.jpg"/);
      assert.match(html, /href="\/location-sonorisation\/lille"/);
      assert.match(html, /href="\/app\/\?open=annonce&amp;id=42&amp;web=1"/);
      assert.match(html, /href="goodlease:\/\/annonce\/42"/);
      assert.match(html, /name="google-site-verification"/);
      assert.doesNotMatch(html, /GoodLeaseWebApp|Chargement des annonces|javascript:alert|SECRET-PHOTO/);
      // Angle brackets inside a quoted attribute are text, not executable nodes.
      const nodes = elements(parse(html));
      for (const script of nodes.filter((node) => node.tagName === 'script' && attr(node, 'type') !== 'application/ld+json')) {
        assert.ok(!text(script).includes('alert('), 'An injected script became executable');
      }
      assert.ok(!nodes.some((node) => node.attrs?.some((item) => item.name.startsWith('on'))), 'An event handler was injected');
      const description = nodes.find((node) => node.tagName === 'meta' && attr(node, 'name') === 'description');
      assert.ok(attr(description, 'content').includes('" onmouseover="alert(3)'), 'Attribute quotes must remain literal text');
      for (const value of privateValues) assert.ok(!html.includes(value), `Private value leaked: ${value}`);
      assert.equal((html.match(/property="og:title"/g) || []).length, 1);
      assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
      assert.ok(html.includes(`rel="canonical" href="https://goodlease.fr${leaseSeoPath}"`));
      assert.match(html, /property="al:ios:url" content="https:\/\/goodlease.fr\/annonce\/42"/);
      assert.match(response.headers.get('x-robots-tag'), /^index,/);
      assert.equal(response.headers.get('etag'), null);
      const schema = [product(html)];
      assert.equal(graph(html).find((item) => item['@type'] === 'BreadcrumbList').itemListElement.at(-1).item, `https://goodlease.fr${leaseSeoPath}`);
      assert.equal(schema[0]['@type'], 'Product');
      assert.deepEqual(schema[0].aggregateRating, { '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 3, bestRating: 5, worstRating: 1 });
      assert.equal(schema[0].offers.price, '12.50');
      assert.equal(schema[0].offers.priceSpecification.referenceQuantity.unitCode, 'WEE');
      assert.equal(schema[0].offers.availability, 'https://schema.org/InStock');
    });
    await t.test('pas de note structurée sans avis réel', async () => {
      mode = 'unrated';
      assert.equal(product((await get('/annonce/42')).html).aggregateRating, undefined);
      mode = 'published';
    });
    await t.test('les aperçus Pages restent non indexables avec une canonique de production', async () => {
      for (const path of ['/catalogue', '/annonce/42', '/profil/9']) {
        const response = await mf.dispatchFetch(`https://preview-seo-audit.goodlease-landing.pages.dev${path}`);
        const html = await response.text();
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get('x-robots-tag'), 'noindex,follow', path);
        assert.match(html, /name="robots" content="noindex,follow"/, path);
        assert.match(html, /rel="canonical" href="https:\/\/goodlease.fr\//, path);
      }
    });
    await t.test('les liens locaux et annonces sont présents dans le HTML initial de l’accueil', async () => {
      const { response, html } = await get('/');
      assert.equal(response.status, 200);
      assert.ok(html.includes(`href="${leaseSeoPath}"`));
      assert.doesNotMatch(html, /href="[^"]+-43"|Chargement des annonces/);
      const listingContainer = elements(parse(html)).find((node) => attr(node, 'id') === 'landing-live-listings');
      assert.ok(listingContainer);
      assert.equal(attr(listingContainer, 'data-endpoint'), undefined);
      assert.match(html, /confirm-banner/);
    });
    await t.test('catégorie × ville et annuaire sont accessibles et canoniques', async () => {
      const { response, html } = await get('/location-sonorisation/lille');
      assert.equal(response.status, 200);
      assert.match(h1(html), /Location de sonorisation à Lille/);
      assert.match(response.headers.get('x-robots-tag'), /noindex/);
      assert.ok(html.includes(`href="${leaseSeoPath}"`));
      assert.match(html, /rel="canonical" href="https:\/\/goodlease.fr\/location-sonorisation\/lille"/);
      assert.equal(graph(html).find((item) => item['@type'] === 'CollectionPage').mainEntity.numberOfItems, 1);
      const catalogue = await get('/catalogue');
      assert.equal(catalogue.response.status, 200);
      assert.match(catalogue.html, /href="\/location-sonorisation"/);
      assert.match(catalogue.html, /href="\/location-materiel\/lille"/);
      assert.doesNotMatch(catalogue.html, /noindex/);
    });
    await t.test('sitemap paginé : toutes les pages, pas de données privées ni de tableau de bord', async () => {
      mode = 'pagination'; calls = [];
      const { response, html } = await get('/sitemap-catalogue.xml');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /application\/xml/);
      for (const path of [leaseSeoPath, '/materiel/enceinte-script-alert-1-script-roubaix-43']) assert.ok(html.includes(`https://goodlease.fr${path}</loc>`));
      assert.equal(calls.length, 2);
      assert.doesNotMatch(html, /\/app|PRIVATE|location-sonorisation\/lille|location-decoration\/roubaix/);
      assert.match(html, /<lastmod>2026-10-01T12:00:00.000Z<\/lastmod>/);
      const home = await get('/');
      assert.match(home.html, /href="\/materiel\/[^"]+-43"/);
      mode = 'published';
    });
    await t.test('les zones incluent les communes voisines et seules les sélections fournies sont indexables', async () => {
      mode = 'metro';
      try {
        for (const path of ['/location-sonorisation', '/location-sonorisation/lille', '/location-materiel/lille']) {
          const { response, html } = await get(path);
          assert.equal(response.status, 200, path);
          assert.match(response.headers.get('x-robots-tag'), /^index,/);
          assert.match(html, /Marquette-lez-Lille/);
          assert.equal(graph(html).find((item) => item['@type'] === 'CollectionPage').mainEntity.numberOfItems, 3);
          for (const value of privateValues) assert.ok(!html.includes(value), path);
        }
        const sitemap = (await get('/sitemap-catalogue.xml')).html;
        for (const path of ['/location-sonorisation', '/location-sonorisation/lille', '/location-materiel/lille']) assert.ok(sitemap.includes(`${path}</loc>`));
        const category = (await get('/location-sonorisation')).html;
        const faq = graph(category).find((item) => item['@type'] === 'FAQPage');
        assert.equal(faq.mainEntity.length, 3);
        // WEEKLY fixture: editorial pricing must never claim a daily range.
        assert.doesNotMatch(category, /tarifs à la journée des annonces de cette sélection/);
        const about = await get('/a-propos/');
        assert.match(about.html, /actuellement 3 annonces publiées/);
      } finally { mode = 'published'; }
      for (const path of ['/location-sonorisation', '/location-sonorisation/lille', '/location-materiel/lille']) {
        assert.match((await get(path)).response.headers.get('x-robots-tag'), /noindex/);
      }
    });
    await t.test('les anciens slugs et slashs redirigent sans perdre les paramètres', async () => {
      const old = await get('/location-reception/leers/?utm_source=test');
      assert.equal(old.response.status, 301);
      assert.equal(old.response.headers.get('location'), 'https://goodlease.fr/location-decoration/leers?utm_source=test');
      for (const [from, to] of [['/location-structures', '/location-tentes-barnums'], ['/location-textile', '/location-nappes-linge-de-table'], ['/catalogue/', '/catalogue']]) {
        const response = (await get(from)).response;
        assert.equal(response.status, 301);
        assert.equal(response.headers.get('location'), `https://goodlease.fr${to}`);
      }
      const pretty = await get(leaseSeoPath);
      assert.equal(pretty.response.status, 200);
      assert.equal(product(pretty.html).url, `https://goodlease.fr${leaseSeoPath}`);
      const renamed = (await get('/materiel/ancien-titre-42')).response;
      assert.equal(renamed.status, 301);
      assert.equal(renamed.headers.get('location'), `https://goodlease.fr${leaseSeoPath}`);
    });
    await t.test('les dates inconnues ne sont pas remplacées par la date du jour', async () => {
      mode = 'no-dates';
      try { assert.doesNotMatch((await get('/sitemap-catalogue.xml')).html, /lastmod/); }
      finally { mode = 'published'; }
    });
    await t.test('les images passent par un cache limité au bucket public connu', async () => {
      imageCalls = 0;
      const image = await get('/images/catalogue/uploads/test.jpg');
      assert.equal(image.response.status, 200);
      assert.equal(image.response.headers.get('content-type'), 'image/jpeg');
      assert.match(image.response.headers.get('cache-control'), /s-maxage=604800/);
      const head = await get('/images/catalogue/uploads/test.jpg', 'HEAD');
      assert.equal(head.response.status, 200); assert.equal(head.html, ''); assert.equal(imageCalls, 1);
      assert.equal((await get('/images/catalogue/uploads/test.svg')).response.status, 404);
      assert.equal((await get('/images/catalogue/https://evil.example.invalid/test.jpg')).response.status, 404);
      assert.equal(imageCalls, 1);
      for (const [state, expected] of [['image-html', 502], ['image-outage', 503], ['image-redirect', 503]]) {
        mode = state;
        assert.equal((await get(`/images/catalogue/uploads/${state}.jpg`)).response.status, expected);
      }
      mode = 'published';
    });
    await t.test('404 pour une annonce retirée, absente ou un identifiant invalide', async () => {
      for (const state of ['withdrawn', 'missing']) {
        mode = state;
        const { response, html } = await get('/annonce/42');
        assert.equal(response.status, 404);
        assert.match(response.headers.get('x-robots-tag'), /noindex/);
        assert.doesNotMatch(html, /Enceinte|Première ligne|AggregateRating/);
      }
      mode = 'published'; calls = [];
      assert.equal((await get('/annonce/0')).response.status, 404);
      assert.equal(calls.length, 0);
      assert.equal((await get('/location-sonorisation/ville-inconnue')).response.status, 404);
      assert.equal((await get('/inconnu/autre')).response.status, 404);
    });
    await t.test('une API lente au-delà de quatre secondes reste accessible', async () => {
      mode = 'slow';
      try {
        const [home, detail, catalogue, sitemap] = await Promise.all(
          ['/', '/annonce/42', '/catalogue', '/sitemap-catalogue.xml'].map((path) => get(path)),
        );
        for (const page of [home, detail, catalogue, sitemap]) assert.equal(page.response.status, 200);
        assert.ok(home.html.includes(`href="${leaseSeoPath}"`));
        assert.ok(catalogue.html.includes(`href="${leaseSeoPath}"`));
        assert.equal(product(detail.html)['@type'], 'Product');
        assert.ok(sitemap.html.includes(`<loc>https://goodlease.fr${leaseSeoPath}</loc>`));
      } finally { mode = 'published'; }
    });
    await t.test('panne API : 503 non indexable, jamais un faux catalogue vide', async () => {
      mode = 'outage';
      for (const path of ['/annonce/42', '/catalogue', '/location-sonorisation/lille', '/sitemap-catalogue.xml']) {
        const { response, html } = await get(path);
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('retry-after'), '60');
        assert.doesNotMatch(html, /<urlset|Aucune annonce publiée/);
      }
      const home = await get('/');
      assert.equal(home.response.status, 200);
      assert.match(home.html, /catalogue est momentanément indisponible/);
      assert.doesNotMatch(home.html, /Aucune annonce publiée/);
      assert.equal(home.response.headers.get('cache-control'), 'no-store');
      mode = 'published';
    });
    await t.test('catalogue vide réel et pagination défaillante restent distincts', async () => {
      mode = 'empty';
      assert.match((await get('/')).html, /Aucune annonce publiée/);
      assert.equal((await get('/sitemap-catalogue.xml')).response.status, 200);
      mode = 'repeat'; calls = [];
      assert.equal((await get('/sitemap-catalogue.xml')).response.status, 503);
      assert.equal(calls.length, 2);
      for (const broken of ['repeat-final', 'empty-final', 'wrong-total']) {
        mode = broken;
        assert.equal((await get('/sitemap-catalogue.xml')).response.status, 503, broken);
      }
      mode = 'malformed';
      assert.equal((await get('/catalogue')).response.status, 503);
      mode = 'bad-id';
      assert.equal((await get('/annonce/42')).response.status, 503);
      mode = 'published';
    });
    await t.test('HEAD sans corps et méthodes d’écriture refusées', async () => {
      for (const path of ['/', '/annonce/42', '/catalogue', '/location-sonorisation/lille', '/sitemap-catalogue.xml']) {
        const head = await get(path, 'HEAD');
        assert.equal(head.response.status, 200);
        assert.equal(head.html, '');
        const post = await get(path, 'POST');
        assert.equal(post.response.status, 405);
        assert.equal(post.response.headers.get('allow'), 'GET, HEAD');
      }
    });
    await t.test('profils existants et noindex du dashboard préservés', async () => {
      const profile = await get('/profil/9');
      assert.equal(profile.response.status, 200);
      assert.equal(schemas(profile.html)[0]['@type'], 'ProfilePage');
      for (const value of privateValues) assert.ok(!profile.html.includes(value));
      const app = await get('/app');
      assert.match(app.html, /name="robots" content="noindex,follow"/);
      const sitemap = await readFile('dist/sitemap-0.xml', 'utf8');
      assert.doesNotMatch(sitemap, /https:\/\/goodlease.fr\/app\/?</);
      assert.match(await readFile('dist/sitemap-index.xml', 'utf8'), /sitemap-catalogue.xml/);
    });
    await t.test('le routeur Pages préserve les slugs et les vrais 404', async () => {
      for (const path of ['/catalogue/', '/annonce/42/', '/location-sonorisation/lille/']) {
        assert.equal((await get(path)).response.status, 301, path);
      }
      for (const path of ['/contact', '/faq', '/securite', '/resolution-des-litiges', '/confidentialite', '/mentions-legales', '/regles-de-contenu', '/supprimer-mon-compte', '/cgs', '/cookies']) {
        assert.equal((await get(path)).response.status, 200, path);
      }
      for (const path of ['/annonce/42/extra', '/catalogue/extra', '/inconnu', '/location-inconnue/lille']) {
        assert.equal((await get(path)).response.status, 404, path);
      }
      assert.match((await get('/app?open=annonce&id=42&web=1')).html, /name="robots" content="noindex,follow"/);
    });
    await t.test('FAQPage utilise exactement les questions et réponses visibles', async () => {
      const faq = await readFile('dist/faq/index.html', 'utf8');
      const schema = schemas(faq).find((item) => item['@type'] === 'FAQPage');
      assert.equal(schema.mainEntity.length, 12);
      assert.equal((faq.match(/<details\b/g) || []).length, schema.mainEntity.length);
      for (const question of schema.mainEntity) {
        const escaped = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        assert.ok(faq.includes(escaped(question.name)));
        assert.ok(faq.includes(escaped(question.acceptedAnswer.text)));
      }
    });
  } finally { await mf.dispose(); }
});
