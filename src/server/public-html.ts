import { site } from '../config';

export const SITE_URL = site.url;
export const DEFAULT_API = 'https://goodlease-back-prod-loyvx5xpua-ew.a.run.app';
export const DEFAULT_IMAGE = `${SITE_URL}/og-default.png`;
const APP_STORE_ID = '6758953661';
const ANDROID_PACKAGE = 'com.goodlease.app';
type JsonRecord = Record<string, unknown>;

export interface PublicShareEnv {
  ASSETS: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  GOODLEASE_API_BASE_URL?: string;
}

export interface PublicPageContext {
  request: Request;
  env: PublicShareEnv;
}

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  image: string;
  imageAlt: string;
  ogType: 'product' | 'profile' | 'website';
  robots: string;
  schema: JsonRecord;
  productPrice?: string;
  appLink?: string;
}

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char];
  });

export const safeJson = (value: JsonRecord) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

function extraHead(meta: PageMeta) {
  const appLink = meta.appLink || meta.canonical;
  const tags = [
    `<meta property="og:type" content="${escapeHtml(meta.ogType)}">`,
    '<meta property="og:site_name" content="GoodLease">',
    '<meta property="og:locale" content="fr_FR">',
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}">`,
    `<meta property="og:image" content="${escapeHtml(meta.image)}">`,
    `<meta property="og:image:secure_url" content="${escapeHtml(meta.image)}">`,
    `<meta property="og:image:alt" content="${escapeHtml(meta.imageAlt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(meta.image)}">`,
    `<meta name="twitter:image:alt" content="${escapeHtml(meta.imageAlt)}">`,
    `<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, app-argument=${escapeHtml(appLink)}">`,
    `<meta property="al:ios:url" content="${escapeHtml(appLink)}">`,
    `<meta property="al:ios:app_store_id" content="${APP_STORE_ID}">`,
    '<meta property="al:ios:app_name" content="Good Lease">',
    `<meta property="al:android:url" content="${escapeHtml(appLink)}">`,
    `<meta property="al:android:package" content="${ANDROID_PACKAGE}">`,
    '<meta property="al:android:app_name" content="Good Lease">',
    ...(meta.productPrice
      ? [
          `<meta property="product:price:amount" content="${meta.productPrice}">`,
          '<meta property="product:price:currency" content="EUR">',
        ]
      : []),
    `<script type="application/ld+json">${safeJson(meta.schema)}</script>`,
  ];
  return tags.join('');
}

export async function renderPublicPage(context: PublicPageContext, meta: PageMeta, status: number, body?: string) {
  // Pages preview hosts must stay out of search even when the production page is indexable.
  const robots = new URL(context.request.url).hostname.endsWith('.pages.dev') ? 'noindex,follow' : meta.robots;
  const shellUrl = new URL(body === undefined ? '/app/' : '/catalogue/', context.request.url);
  const shell = await context.env.ASSETS.fetch(
    new Request(shellUrl, { headers: { Accept: 'text/html' }, method: 'GET' }),
  );

  if (!shell.ok || !shell.body) {
    return new Response('Application GoodLease indisponible.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const headers = new Headers(shell.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set(
    'Cache-Control',
    status === 200
      ? 'public, max-age=30, s-maxage=60, must-revalidate'
      : status === 404
        ? 'public, max-age=15, s-maxage=30, must-revalidate'
        : 'no-store',
  );
  headers.set('Content-Language', 'fr');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  headers.delete('Content-Length');
  headers.delete('ETag');
  headers.delete('Last-Modified');
  headers.set('X-Robots-Tag', robots);
  if (status === 503) headers.set('Retry-After', '60');

  const response = new Response(shell.body, { status, headers });
  interface HtmlRewriterInstance {
    on(selector: string, handlers: object): HtmlRewriterInstance;
    transform(response: Response): Response;
  }
  const HtmlRewriter = (
    globalThis as unknown as {
      HTMLRewriter: new () => HtmlRewriterInstance;
    }
  ).HTMLRewriter;
  const rewriter = new HtmlRewriter();

  rewriter
    .on('title', {
      element(element: { setInnerContent(content: string): void }) {
        element.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"]', {
      element(element: { setAttribute(name: string, value: string): void }) {
        element.setAttribute('content', meta.description);
      },
    })
    .on('meta[name="robots"]', {
      element(element: { setAttribute(name: string, value: string): void }) {
        element.setAttribute('content', robots);
      },
    })
    .on('link[rel="canonical"]', {
      element(element: { setAttribute(name: string, value: string): void }) {
        element.setAttribute('href', meta.canonical);
      },
    })
    .on('head', {
      element(element: { append(content: string, options: { html: boolean }): void }) {
        element.append(extraHead(meta), { html: true });
      },
    });

  if (body !== undefined) {
    rewriter.on('#public-catalogue-content', {
      element(element: { setInnerContent(content: string, options: { html: boolean }): void }) {
        element.setInnerContent(body, { html: true });
      },
    });
  }
  // The public layout already has generic social tags; replace, never duplicate them.
  rewriter.on('meta[property^="og:"], meta[name^="twitter:"], script[type="application/ld+json"]', {
    element(element: { remove(): void }) { element.remove(); },
  });
  const rendered = rewriter.transform(response);
  return context.request.method === 'HEAD'
    ? new Response(null, { status: rendered.status, headers: rendered.headers })
    : rendered;
}
