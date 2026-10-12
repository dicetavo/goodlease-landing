import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizationMatchesRule,
  contentTypeMatchesRule,
  matchWebAppApiRule,
  sanitizePublicPayload,
} from '../src/server/webapp-api-policy.ts';

const keysRecursively = (value, keys = new Set()) => {
  if (Array.isArray(value)) {
    value.forEach((item) => keysRecursively(item, keys));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key.toLowerCase());
      keysRecursively(child, keys);
    }
  }
  return keys;
};

test('the proxy accepts every implemented web-client route with its exact method', () => {
  assert.equal(matchWebAppApiRule('analytics/context', 'POST')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('analytics/revoke', 'POST')?.requiresBearer, undefined);
  assert.equal(matchWebAppApiRule('analytics/revoke', 'POST')?.requestBody, 'empty');
  assert.equal(matchWebAppApiRule('analytics/context', 'GET'), undefined);
  assert.equal(matchWebAppApiRule('leases', 'GET')?.publicPayload, 'lease-list');
  assert.equal(matchWebAppApiRule('leases/42', 'GET')?.publicPayload, 'lease');
  assert.equal(matchWebAppApiRule('leases/client/7', 'GET')?.publicPayload, 'lease-list');
  assert.deepEqual(matchWebAppApiRule('account/leases/7', 'GET'), {
    path: 'account/leases/7',
    method: 'GET',
    upstreamPath: 'leases/client/7',
    publicPayload: 'account-lease-list',
    requiresBearer: true,
  });
  assert.equal(matchWebAppApiRule('client/7', 'GET')?.publicPayload, 'profile');
  assert.equal(matchWebAppApiRule('auth/login', 'POST')?.requestBody, 'json');
  assert.equal(matchWebAppApiRule('marketing/context', 'POST')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('marketing/revoke', 'POST')?.requiresBearer, undefined);
  assert.equal(matchWebAppApiRule('marketing/context', 'GET'), undefined);
  assert.equal(matchWebAppApiRule('marketing/revoke', 'GET'), undefined);
  assert.equal(matchWebAppApiRule('auth/google/login', 'POST')?.requestBody, 'json');
  assert.equal(matchWebAppApiRule('auth/google/login', 'POST')?.requiresBearer, undefined);
  assert.equal(matchWebAppApiRule('auth/complete-profile', 'POST')?.requestBody, 'json');
  assert.equal(matchWebAppApiRule('auth/complete-profile', 'POST')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('auth/refresh', 'POST')?.requiresBearer, undefined);
  assert.equal(matchWebAppApiRule('auth/logout', 'POST')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('auth/forgot-password', 'POST')?.requestBody, 'json');
  assert.equal(matchWebAppApiRule('auth/register/request', 'POST')?.requestBody, 'json');
  assert.equal(matchWebAppApiRule('auth/register/verify', 'POST')?.requestBody, 'json');
  assert.equal(matchWebAppApiRule('leases/newcommands', 'POST')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('booking-periods', 'POST')?.requestBody, 'json');
  assert.equal(matchWebAppApiRule('client/me', 'GET')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('client/7', 'PUT')?.requestBody, 'json');
  assert.equal(matchWebAppApiRule('transactions/bookings-with-details/7', 'GET')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('chats/user', 'GET')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('chats/7/messages', 'GET')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('wallet/balance/7', 'GET')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('cashout/history/7', 'GET')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('cashout/bank-info/7', 'GET')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('notifications/client/7', 'GET')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('stripe/account-link/7', 'GET')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('bookings/7/contract.pdf', 'GET')?.requiresBearer, true);
  assert.equal(matchWebAppApiRule('chats/7/sendmessages', 'POST')?.requestBody, 'json');
  assert.equal(matchWebAppApiRule('cashout/request', 'POST')?.requestBody, 'json');
  assert.equal(matchWebAppApiRule('notifications/client/7/read-all', 'POST')?.requestBody, 'empty');
  assert.equal(matchWebAppApiRule('notifications/7/read', 'POST')?.requestBody, 'empty');
});

test('bearer authentication is mandatory only on authenticated routes', () => {
  for (const [path, method] of [
    ['auth/logout', 'POST'],
    ['auth/complete-profile', 'POST'],
    ['leases/newcommands', 'POST'],
    ['booking-periods', 'POST'],
    ['client/me', 'GET'],
    ['account/leases/7', 'GET'],
    ['client/7', 'PUT'],
    ['transactions/bookings-with-details/7', 'GET'],
    ['chats/user', 'GET'],
    ['chats/7/messages', 'GET'],
    ['wallet/balance/7', 'GET'],
    ['cashout/history/7', 'GET'],
    ['cashout/bank-info/7', 'GET'],
    ['notifications/client/7', 'GET'],
    ['stripe/account-link/7', 'GET'],
    ['bookings/7/contract.pdf', 'GET'],
    ['chats/7/sendmessages', 'POST'],
    ['cashout/request', 'POST'],
    ['notifications/client/7/read-all', 'POST'],
    ['notifications/7/read', 'POST'],
  ]) {
    assert.equal(matchWebAppApiRule(path, method)?.requiresBearer, true, `${method} ${path} must require Bearer`);
  }

  for (const path of [
    'auth/login',
    'auth/google/login',
    'auth/refresh',
    'auth/forgot-password',
    'auth/register/request',
    'auth/register/verify',
  ]) {
    assert.notEqual(matchWebAppApiRule(path, 'POST')?.requiresBearer, true, `${path} must remain public`);
  }
});

test('the account listings alias rejects missing or malformed Bearer credentials', () => {
  const rule = matchWebAppApiRule('account/leases/7', 'GET');
  assert.ok(rule);
  assert.equal(authorizationMatchesRule(rule, ''), false);
  assert.equal(authorizationMatchesRule(rule, 'Basic dXNlcjpwYXNz'), false);
  assert.equal(authorizationMatchesRule(rule, 'Bearer'), false);
  assert.equal(authorizationMatchesRule(rule, 'Bearer valid-token'), true);
  assert.equal(authorizationMatchesRule(rule, 'bearer valid-token'), true);

  const publicRule = matchWebAppApiRule('leases/client/7', 'GET');
  assert.ok(publicRule);
  assert.equal(authorizationMatchesRule(publicRule, ''), true);
});

test('the proxy rejects crossed methods and routes not used by the web client', () => {
  for (const path of [
    'leases',
    'leases/42',
    'leases/client/7',
    'account/leases/7',
    'client/me',
    'transactions/bookings-with-details/7',
    'chats/user',
    'chats/7/messages',
    'wallet/balance/7',
    'cashout/history/7',
    'cashout/bank-info/7',
    'notifications/client/7',
    'stripe/account-link/7',
    'bookings/7/contract.pdf',
  ]) {
    assert.equal(matchWebAppApiRule(path, 'POST'), undefined, `${path} must reject POST`);
  }
  for (const path of [
    'auth/login',
    'auth/google/login',
    'auth/complete-profile',
    'auth/refresh',
    'auth/logout',
    'auth/forgot-password',
    'auth/register/request',
    'auth/register/verify',
    'leases/newcommands',
    'booking-periods',
    'chats/7/sendmessages',
    'cashout/request',
    'notifications/client/7/read-all',
    'notifications/7/read',
  ]) {
    assert.equal(matchWebAppApiRule(path, 'GET'), undefined, `${path} must reject GET`);
  }

  assert.equal(matchWebAppApiRule('transactions', 'GET'), undefined);
  assert.equal(matchWebAppApiRule('client/7', 'POST'), undefined);
  assert.equal(matchWebAppApiRule('client/me', 'PUT'), undefined);
  assert.equal(matchWebAppApiRule('leases/42', 'DELETE'), undefined);
  assert.equal(matchWebAppApiRule('leases/42/edit', 'GET'), undefined);
  assert.equal(matchWebAppApiRule('../client/7', 'GET'), undefined);
});

test('all id routes reject invalid identifiers', () => {
  const invalidIds = ['0', '-1', 'abc', '1.5', '01', '99999999999999999999'];
  for (const id of invalidIds) {
    for (const [path, method] of [
      [`leases/${id}`, 'GET'],
      [`leases/client/${id}`, 'GET'],
      [`account/leases/${id}`, 'GET'],
      [`client/${id}`, 'GET'],
      [`client/${id}`, 'PUT'],
      [`transactions/bookings-with-details/${id}`, 'GET'],
      [`chats/${id}/messages`, 'GET'],
      [`chats/${id}/sendmessages`, 'POST'],
      [`wallet/balance/${id}`, 'GET'],
      [`cashout/history/${id}`, 'GET'],
      [`cashout/bank-info/${id}`, 'GET'],
      [`notifications/client/${id}`, 'GET'],
      [`notifications/client/${id}/read-all`, 'POST'],
      [`notifications/${id}/read`, 'POST'],
      [`stripe/account-link/${id}`, 'GET'],
      [`bookings/${id}/contract.pdf`, 'GET'],
    ]) {
      assert.equal(matchWebAppApiRule(path, method), undefined, `${method} ${path} must be rejected`);
    }
  }
});

test('request content types are exact', () => {
  const jsonRule = matchWebAppApiRule('auth/login', 'POST');
  const multipartRule = matchWebAppApiRule('leases/newcommands', 'POST');
  const emptyRule = matchWebAppApiRule('notifications/7/read', 'POST');
  assert.ok(jsonRule && multipartRule && emptyRule);

  assert.equal(contentTypeMatchesRule(jsonRule, 'application/json'), true);
  assert.equal(contentTypeMatchesRule(jsonRule, 'application/json; charset=UTF-8'), true);
  assert.equal(contentTypeMatchesRule(jsonRule, 'text/plain'), false);
  assert.equal(contentTypeMatchesRule(jsonRule, 'application/jsonp'), false);
  assert.equal(contentTypeMatchesRule(multipartRule, 'multipart/form-data; boundary=abc123'), true);
  assert.equal(contentTypeMatchesRule(multipartRule, 'multipart/form-data'), false);
  assert.equal(contentTypeMatchesRule(emptyRule, ''), true);
  assert.equal(contentTypeMatchesRule(emptyRule, 'application/json'), false);

  for (const [path, method] of [
    ['auth/refresh', 'POST'],
    ['auth/logout', 'POST'],
    ['auth/google/login', 'POST'],
    ['auth/complete-profile', 'POST'],
    ['auth/forgot-password', 'POST'],
    ['auth/register/request', 'POST'],
    ['auth/register/verify', 'POST'],
    ['client/7', 'PUT'],
    ['booking-periods', 'POST'],
    ['chats/7/sendmessages', 'POST'],
    ['cashout/request', 'POST'],
  ]) {
    const rule = matchWebAppApiRule(path, method);
    assert.ok(rule);
    assert.equal(rule.requestBody, 'json', `${method} ${path} must accept JSON only`);
    assert.equal(contentTypeMatchesRule(rule, 'application/json'), true);
    assert.equal(contentTypeMatchesRule(rule, 'multipart/form-data; boundary=nope'), false);
  }
});

test('lease projection removes exact and recursively nested location data', () => {
  const payload = sanitizePublicPayload(
    {
      id: 42,
      available: true,
      title: 'Enceinte',
      description: 'Sono',
      clientId: 7,
      photoUrls: ['https://cdn.example.test/photo.jpg', 12],
      address: {
        city: 'Lille',
        country: 'France',
        street: '1 rue privée',
        postalCode: '59000',
        latitude: 50.1,
        longitude: 3.1,
        coordinates: { lat: 50.1, lon: 3.1 },
      },
      owner: {
        email: 'private@example.test',
        address: { street: '2 rue privée' },
      },
    },
    'lease',
  );

  assert.deepEqual(payload, {
    id: 42,
    available: true,
    title: 'Enceinte',
    description: 'Sono',
    clientId: 7,
    photoUrls: ['https://cdn.example.test/photo.jpg'],
    address: { city: 'Lille', country: 'France' },
  });
  const projectedKeys = keysRecursively(payload);
  for (const forbidden of ['street', 'postalcode', 'latitude', 'longitude', 'coordinates', 'email']) {
    assert.equal(projectedKeys.has(forbidden), false);
  }
});

test('unavailable leases never cross the public web proxy boundary', () => {
  assert.deepEqual(sanitizePublicPayload([
    { id: 1, title: 'Visible', available: true },
    { id: 2, title: 'Retirée', available: false },
    { id: 3, title: 'État inconnu' },
  ], 'lease-list'), [{ id: 1, title: 'Visible', available: true }]);
  assert.throws(
    () => sanitizePublicPayload({ id: 2, title: 'Retirée', available: false }, 'lease'),
    /not publicly available/,
  );
});

test('authenticated account lease projection retains unavailable listings without leaking PII', () => {
  const payload = sanitizePublicPayload([
    {
      id: 1,
      title: 'Visible',
      available: true,
      address: {
        city: 'Lille',
        country: 'France',
        street: '1 rue privée',
        postalCode: '59000',
        latitude: 50.1,
        longitude: 3.1,
      },
      owner: { email: 'private@example.test', phone: '+33600000000' },
    },
    {
      id: 2,
      title: 'Indisponible',
      available: false,
      address: {
        city: 'Roubaix',
        street: '2 rue privée',
        coordinates: { lat: 50.7, lon: 3.1 },
      },
      privateNotes: 'ne jamais exposer',
    },
  ], 'account-lease-list');

  assert.deepEqual(payload, [
    {
      id: 1,
      title: 'Visible',
      available: true,
      address: { city: 'Lille', country: 'France' },
    },
    {
      id: 2,
      title: 'Indisponible',
      available: false,
      address: { city: 'Roubaix' },
    },
  ]);
  const projectedKeys = keysRecursively(payload);
  for (const forbidden of [
    'street',
    'postalcode',
    'latitude',
    'longitude',
    'coordinates',
    'email',
    'phone',
    'owner',
    'privatenotes',
  ]) {
    assert.equal(projectedKeys.has(forbidden), false);
  }
});

test('profile projection removes private DTO and wallet fields', () => {
  const payload = sanitizePublicPayload(
    {
      id: 7,
      username: 'loueur',
      company: 'Location SARL',
      photoProfilUrl: 'https://cdn.example.test/avatar.jpg',
      reviewsCount: 14,
      listingsCount: 3,
      averageRating: 4.7,
      identityVerified: true,
      memberSince: '2025-05-12T08:30:00Z',
      phone: '+33600000000',
      email: 'private@example.test',
      birthDate: '1990-01-01',
      vatNumber: 'FR00000000000',
      userId: 99,
      wallet: { balance: 1200, clientId: 7 },
      private: { address: { latitude: 50, longitude: 3 } },
    },
    'profile',
  );

  assert.deepEqual(payload, {
    id: 7,
    username: 'loueur',
    company: 'Location SARL',
    photoProfilUrl: 'https://cdn.example.test/avatar.jpg',
    reviewsCount: 14,
    listingsCount: 3,
    averageRating: 4.7,
    identityVerified: true,
    memberSince: '2025-05-12T08:30:00Z',
  });
  const projectedKeys = keysRecursively(payload);
  for (const forbidden of ['phone', 'email', 'birthdate', 'vatnumber', 'userid', 'wallet', 'latitude', 'longitude']) {
    assert.equal(projectedKeys.has(forbidden), false);
  }
});
