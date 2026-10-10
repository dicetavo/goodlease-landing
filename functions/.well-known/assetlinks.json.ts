interface Env {
  ANDROID_APP_LINKS_SHA256?: string;
}

export const onRequestGet: PagesFunction<Env> = ({ env }) => {
  const fingerprints = (env.ANDROID_APP_LINKS_SHA256 || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value));

  if (!fingerprints.length) {
    return Response.json([], {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'X-GoodLease-Configuration': 'ANDROID_APP_LINKS_SHA256 is missing',
      },
    });
  }

  return Response.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.goodlease.app',
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ], {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
