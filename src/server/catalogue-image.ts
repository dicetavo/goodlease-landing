const IMAGE_ORIGIN = 'https://goodlease.s3.us-east-1.amazonaws.com';
const IMAGE_PATH = /^\/uploads\/[a-zA-Z0-9._-]+\.(?:jpe?g|png|webp|gif|avif)$/i;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** A single known public bucket: never an arbitrary URL proxy. */
export function catalogueImageUrl(url: URL) {
  return url.origin === IMAGE_ORIGIN && IMAGE_PATH.test(url.pathname) && !url.search && !url.username && !url.password
    ? `/images/catalogue${url.pathname}` : url.href;
}

export async function renderCatalogueImage(request: Request) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const url = new URL(request.url);
  const path = url.pathname.slice('/images/catalogue'.length);
  if (!url.pathname.startsWith('/images/catalogue/') || !IMAGE_PATH.test(path)) return new Response('Image introuvable.', { status: 404 });
  const cacheUrl = new URL(url); cacheUrl.search = '';
  const key = new Request(cacheUrl, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(key);
  if (cached) return request.method === 'HEAD' ? new Response(null, { headers: cached.headers }) : cached;
  try {
    const upstream = await fetch(`${IMAGE_ORIGIN}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (!upstream.ok) return new Response('Image indisponible.', { status: upstream.status === 404 ? 404 : 503, headers: { 'Cache-Control': 'no-store' } });
    const contentType = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(contentType) || !upstream.body) {
      await upstream.body?.cancel();
      return new Response('Format d’image indisponible.', { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    if (Number(upstream.headers.get('content-length') || 0) > MAX_IMAGE_BYTES) {
      await upstream.body.cancel();
      return new Response('Image trop volumineuse.', { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const reader = upstream.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); return new Response('Image trop volumineuse.', { status: 502 }); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const response = new Response(bytes, { headers: {
      'Content-Type': contentType, 'Content-Length': String(size), 'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Referrer-Policy': 'no-referrer',
    } });
    try { await cache.put(key, response.clone()); } catch { /* The image remains available if the edge cache is full. */ }
    return request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response;
  } catch { return new Response('Image temporairement indisponible.', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } }); }
}
