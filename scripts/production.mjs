#!/usr/bin/env node
// Compare le build local (dist/) au site en ligne.
//   node scripts/production.mjs a-publier   articles du blog construits mais absents du site
//   node scripts/production.mjs verifier    échoue si une page ou un fichier du build ne répond pas en ligne
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE = (process.env.SITE_URL || 'https://goodlease.fr').replace(/\/+$/, '');

/** Un article publié produit dist/blog/<nom>/index.html ; un article programmé ou en brouillon n'y figure pas. */
export function builtArticles(dist = 'dist') {
  const dir = join(dist, 'blog');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'index.html')))
    .map((entry) => '/blog/' + entry.name + '/')
    .sort();
}

/** Le nom des fichiers JS et CSS contient l'empreinte de leur contenu : ils identifient le build servi. */
export function builtAssets(dist = 'dist') {
  const dir = join(dist, '_astro');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => /\.(?:js|css)$/.test(name)).map((name) => '/_astro/' + name).sort();
}

/** Code HTTP renvoyé par le site, ou 0 s'il ne répond pas. */
export async function httpStatus(path, { site = SITE, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(site + path, {
      redirect: 'follow',
      headers: { 'User-Agent': 'goodlease-deploiement' },
      signal: AbortSignal.timeout(20_000),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return 0;
  }
}

/** Un article reste à publier tant que le site ne le sert pas : dans le doute, on déploie. */
export async function articlesToPublish({ dist, ...options } = {}) {
  const missing = [];
  for (const path of builtArticles(dist)) {
    const status = await httpStatus(path, options);
    if (status !== 200) missing.push({ path, status });
  }
  return missing;
}

/** Chemins qui ne répondent toujours pas en 200 après plusieurs essais. */
export async function unreachable(paths, { attempts = 9, delayMs = 10_000, ...options } = {}) {
  let pending = paths.map((path) => ({ path, status: 0 }));
  for (let attempt = 1; attempt <= attempts && pending.length; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const next = [];
    for (const { path } of pending) {
      const status = await httpStatus(path, options);
      if (status !== 200) next.push({ path, status });
    }
    pending = next;
  }
  return pending;
}

const label = ({ path, status }) => path + ' (' + (status ? 'HTTP ' + status : 'pas de réponse') + ')';

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, name + '=' + value + '\n');
}

async function main(command) {
  if (command === 'a-publier') {
    const missing = await articlesToPublish();
    console.log(builtArticles().length + ' article(s) dans le build, ' + missing.length + ' absent(s) de ' + SITE + '.');
    for (const item of missing) console.log('À publier : ' + label(item));
    output('deployer', missing.length ? 'oui' : 'non');
    return 0;
  }
  if (command === 'verifier') {
    const pages = ['/', ...(existsSync(join('dist', 'blog', 'index.html')) ? ['/blog/'] : []), ...builtArticles()];
    const paths = [...pages, ...builtAssets()];
    const failed = await unreachable(paths);
    console.log(paths.length - failed.length + ' / ' + paths.length + ' chemins du build répondent sur ' + SITE + '.');
    for (const item of failed) console.error('Ne répond pas : ' + label(item));
    return failed.length ? 1 : 0;
  }
  console.error('Usage : node scripts/production.mjs a-publier | verifier');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv[2]));
}

