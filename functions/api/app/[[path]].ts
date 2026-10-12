import {
  authorizationMatchesRule,
  contentTypeMatchesRule,
  matchWebAppApiRule,
  sanitizePublicPayload,
} from '../../../src/server/webapp-api-policy';

interface Env {
  GOODLEASE_API_BASE_URL?: string;
}

const DEFAULT_API = 'https://goodlease-back-prod-loyvx5xpua-ew.a.run.app';

const jsonError = (error: string, status: number) =>
  Response.json(
    { error },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );

export const onRequest: PagesFunction<Env> = async ({ request, params, env, waitUntil }) => {
  const rawPath = Array.isArray(params.path) ? params.path.join('/') : String(params.path ?? '');
  const rule = matchWebAppApiRule(rawPath, request.method);
  if (!rule) {
    return jsonError('Route API web indisponible.', 404);
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() || '';
  if (!contentTypeMatchesRule(rule, contentType)) {
    return jsonError('Type de contenu invalide.', 415);
  }
  if (rule.requestBody === 'empty' && request.body !== null) {
    // Cloudflare can expose a stream even for a zero-byte POST. Validate bytes,
    // not stream presence, and reject a nonempty body without buffering it.
    const reader = request.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) {
          await reader.cancel();
          return jsonError('Cette route n’accepte pas de corps de requête.', 400);
        }
      }
    } finally { reader.releaseLock(); }
  }

  const authorization = request.headers.get('authorization') || '';
  if (!authorizationMatchesRule(rule, authorization)) {
    return jsonError('Authentification requise.', 401);
  }

  const cacheable = rule.method === 'GET' && Boolean(rule.publicPayload) && !rule.requiresBearer;
  const edgeCache = cacheable ? (caches as CacheStorage & { default: Cache }).default : undefined;
  const cacheKey = cacheable
    ? new Request(request.url, { method: 'GET', headers: { Accept: 'application/json' } })
    : undefined;
  if (edgeCache && cacheKey) {
    const cached = await edgeCache.match(cacheKey);
    if (cached) return cached;
  }

  const base = (env.GOODLEASE_API_BASE_URL || DEFAULT_API).replace(/\/$/, '');
  const incoming = new URL(request.url);
  const upstream = new URL(`${base}/api/${rule.upstreamPath || rule.path}`);
  upstream.search = incoming.search;

  const headers = new Headers();
  for (const name of ['content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (rule.requiresBearer) headers.set('authorization', authorization);
  const analytics = request.headers.get('x-goodlease-analytics') || '';
  if (!cacheable && analytics.length <= 1500 && /^[A-Za-z0-9_-]+={0,2}$/.test(analytics)) {
    headers.set('x-goodlease-analytics', analytics);
  }
  headers.set('x-goodlease-client', 'web');
  const marketing = request.headers.get('x-goodlease-marketing') || '';
  if (!cacheable && marketing.length <= 1500 && /^[A-Za-z0-9_-]+={0,2}$/.test(marketing)) {
    headers.set('x-goodlease-marketing', marketing);
    const userAgent = request.headers.get('user-agent');
    if (userAgent && userAgent.length <= 500) headers.set('user-agent', userAgent);
  }

  try {
    const response = await fetch(upstream, {
      method: rule.method,
      headers,
      body: rule.method === 'GET' || rule.requestBody === 'empty' ? undefined : request.body,
      redirect: 'manual',
    });

    const outgoingHeaders = new Headers();
    for (const name of ['content-type', 'content-disposition', 'x-total-count']) {
      const value = response.headers.get(name);
      if (value) outgoingHeaders.set(name, value);
    }
    outgoingHeaders.set(
      'Cache-Control',
      cacheable ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' : 'no-store',
    );
    outgoingHeaders.set('X-Content-Type-Options', 'nosniff');
    outgoingHeaders.set('Referrer-Policy', 'no-referrer');
    outgoingHeaders.set('X-Robots-Tag', 'noindex');

    if (rule.publicPayload) {
      if (!response.ok) {
        return jsonError(
          response.status === 404 ? 'Ressource introuvable.' : 'Le catalogue GoodLease est momentanément indisponible.',
          response.status,
        );
      }
      if (!(response.headers.get('content-type') || '').toLowerCase().includes('json')) {
        return jsonError('Réponse API invalide.', 502);
      }

      try {
        const payload: unknown = await response.json();
        const publicResponse = Response.json(sanitizePublicPayload(payload, rule.publicPayload), {
          status: response.status,
          headers: outgoingHeaders,
        });
        if (edgeCache && cacheKey) waitUntil(edgeCache.put(cacheKey, publicResponse.clone()));
        return publicResponse;
      } catch (error) {
        if (error instanceof RangeError) return jsonError('Ressource introuvable.', 404);
        return jsonError('Réponse API invalide.', 502);
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outgoingHeaders,
    });
  } catch {
    return jsonError('Le service GoodLease est momentanément indisponible.', 502);
  }
};
