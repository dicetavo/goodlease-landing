import { apiBaseUrl, fetchCatalogue } from '../src/server/public-catalogue';
import { methodNotAllowed } from '../src/server/catalogue-pages';
import type { PublicShareEnv } from '../src/server/public-html';

export const onRequest: PagesFunction<PublicShareEnv> = async (context) => {
  if (!['GET', 'HEAD'].includes(context.request.method)) return methodNotAllowed();
  const shell = await context.env.ASSETS.fetch(new Request(new URL('/a-propos/', context.request.url)));
  if (!shell.ok) return shell;
  let count: number;
  try { count = (await fetchCatalogue(apiBaseUrl(context.env))).length; }
  catch { return context.request.method === 'HEAD' ? new Response(null, { headers: shell.headers }) : shell; }
  const headers = new Headers(shell.headers);
  headers.delete('Content-Length'); headers.delete('ETag'); headers.delete('Last-Modified');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300, must-revalidate');
  const rendered = new HTMLRewriter().on('#about-catalogue-count', {
    element(element) { element.setInnerContent(`Le catalogue contient actuellement ${count} annonce${count > 1 ? 's' : ''} publiée${count > 1 ? 's' : ''}. Les disponibilités pour vos dates sont à vérifier dans l’application.`); },
  }).transform(new Response(shell.body, { headers }));
  return context.request.method === 'HEAD' ? new Response(null, { headers }) : rendered;
};
