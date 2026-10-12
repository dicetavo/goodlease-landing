export type PublicPayloadKind = 'lease-list' | 'account-lease-list' | 'lease' | 'profile';

export interface WebAppApiRule {
  path: string;
  method: 'GET' | 'POST' | 'PUT';
  upstreamPath?: string;
  publicPayload?: PublicPayloadKind;
  requiresBearer?: boolean;
  requestBody?: 'json' | 'multipart' | 'empty';
}

type JsonRecord = Record<string, unknown>;

const POSITIVE_ID = '[1-9]\\d{0,18}';
const patterns = {
  lease: new RegExp(`^leases/${POSITIVE_ID}$`),
  clientLeases: new RegExp(`^leases/client/${POSITIVE_ID}$`),
  accountLeases: new RegExp(`^account/leases/${POSITIVE_ID}$`),
  client: new RegExp(`^client/${POSITIVE_ID}$`),
  bookings: new RegExp(`^transactions/bookings-with-details/${POSITIVE_ID}$`),
  chatMessages: new RegExp(`^chats/${POSITIVE_ID}/messages$`),
  sendMessage: new RegExp(`^chats/${POSITIVE_ID}/sendmessages$`),
  walletBalance: new RegExp(`^wallet/balance/${POSITIVE_ID}$`),
  cashoutHistory: new RegExp(`^cashout/history/${POSITIVE_ID}$`),
  cashoutBankInfo: new RegExp(`^cashout/bank-info/${POSITIVE_ID}$`),
  clientNotifications: new RegExp(`^notifications/client/${POSITIVE_ID}$`),
  readAllNotifications: new RegExp(`^notifications/client/${POSITIVE_ID}/read-all$`),
  readNotification: new RegExp(`^notifications/${POSITIVE_ID}/read$`),
  stripeAccountLink: new RegExp(`^stripe/account-link/${POSITIVE_ID}$`),
  bookingContract: new RegExp(`^bookings/${POSITIVE_ID}/contract\\.pdf$`),
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const copyPrimitive = (source: JsonRecord, target: JsonRecord, key: string) => {
  const value = source[key];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    target[key] = value;
  }
};

const sanitizeAddress = (value: unknown): JsonRecord | undefined => {
  if (!isRecord(value)) return undefined;
  const address: JsonRecord = {};
  copyPrimitive(value, address, 'city');
  copyPrimitive(value, address, 'country');
  return Object.keys(address).length ? address : undefined;
};

const sanitizeLease = (value: unknown): JsonRecord | undefined => {
  if (!isRecord(value)) return undefined;

  const lease: JsonRecord = {};
  for (const key of [
    'id',
    'title',
    'description',
    'priceByPeriod',
    'bail',
    'caution',
    'state',
    'available',
    'clientId',
    'categoryId',
    'regionId',
    'quantity',
    'condition',
    'handoutOption',
    'averageRating',
    'reviewCount',
    'periodType',
    'distanceKm',
    'createdAt',
    'updatedAt',
    'lastModifiedAt',
    'likeCount',
  ]) {
    copyPrimitive(value, lease, key);
  }

  if (Array.isArray(value.photoUrls)) {
    lease.photoUrls = value.photoUrls.filter((photo): photo is string => typeof photo === 'string');
  }

  const address = sanitizeAddress(value.address);
  if (address) lease.address = address;
  return lease;
};

const sanitizeProfile = (value: unknown): JsonRecord | undefined => {
  if (!isRecord(value)) return undefined;

  const profile: JsonRecord = {};
  for (const key of [
    'id',
    'username',
    'displayName',
    'name',
    'company',
    'photoProfilUrl',
    'reviewsCount',
    'listingsCount',
    'averageRating',
    'identityVerified',
    'memberSince',
  ]) {
    copyPrimitive(value, profile, key);
  }
  return profile;
};

/**
 * Rebuild public payloads from an explicit field allowlist. Unknown and nested
 * fields are discarded, so adding PII to a backend DTO cannot expose it here.
 */
export function sanitizePublicPayload(value: unknown, kind: PublicPayloadKind): unknown {
  if (kind === 'lease-list' || kind === 'account-lease-list') {
    if (!Array.isArray(value)) throw new TypeError('Expected a lease array');
    const leases = value
      .map(sanitizeLease)
      .filter((lease): lease is JsonRecord => lease !== undefined);
    return kind === 'lease-list'
      ? leases.filter((lease) => lease.available === true)
      : leases;
  }
  if (kind === 'lease') {
    const lease = sanitizeLease(value);
    if (!lease) throw new TypeError('Expected a lease object');
    if (lease.available !== true) throw new RangeError('Lease is not publicly available');
    return lease;
  }
  const profile = sanitizeProfile(value);
  if (!profile) throw new TypeError('Expected a profile object');
  return profile;
}

export function contentTypeMatchesRule(rule: WebAppApiRule, contentType: string): boolean {
  const normalized = contentType.trim().toLowerCase();
  if (rule.requestBody === 'json') {
    return /^application\/json(?:\s*;|$)/.test(normalized);
  }
  if (rule.requestBody === 'multipart') {
    return /^multipart\/form-data\s*;[^\r\n]*\bboundary=/.test(normalized);
  }
  return rule.requestBody !== 'empty' || normalized === '';
}

export function authorizationMatchesRule(rule: WebAppApiRule, authorization: string): boolean {
  return rule.requiresBearer !== true || /^Bearer\s+\S+$/i.test(authorization);
}

/** Only routes currently implemented by the production web client are proxied. */
export function matchWebAppApiRule(rawPath: string, rawMethod: string): WebAppApiRule | undefined {
  const path = rawPath.replace(/^\/+|\/+$/g, '');
  const method = rawMethod.toUpperCase();

  if (method === 'GET' && path === 'leases') {
    return { path, method: 'GET', publicPayload: 'lease-list' };
  }
  if (method === 'GET' && patterns.lease.test(path)) {
    return { path, method: 'GET', publicPayload: 'lease' };
  }
  if (method === 'GET' && patterns.clientLeases.test(path)) {
    return { path, method: 'GET', publicPayload: 'lease-list' };
  }
  if (method === 'GET' && patterns.accountLeases.test(path)) {
    const clientId = path.slice('account/leases/'.length);
    return {
      path,
      method: 'GET',
      upstreamPath: `leases/client/${clientId}`,
      publicPayload: 'account-lease-list',
      requiresBearer: true,
    };
  }
  if (method === 'GET' && patterns.client.test(path)) {
    return { path, method: 'GET', publicPayload: 'profile' };
  }
  if (method === 'POST' && path === 'auth/login') {
    return { path, method: 'POST', requestBody: 'json' };
  }
  if (method === 'POST' && ['analytics/context', 'marketing/context'].includes(path)) {
    return { path, method: 'POST', requiresBearer: true, requestBody: 'empty' };
  }
  if (method === 'POST' && ['analytics/revoke', 'marketing/revoke'].includes(path)) {
    return { path, method: 'POST', requestBody: 'empty' };
  }
  if (method === 'POST' && path === 'auth/google/login') {
    return { path, method: 'POST', requestBody: 'json' };
  }
  if (method === 'POST' && path === 'auth/refresh') {
    return { path, method: 'POST', requestBody: 'json' };
  }
  if (method === 'POST' && path === 'auth/forgot-password') {
    return { path, method: 'POST', requestBody: 'json' };
  }
  if (method === 'POST' && path === 'auth/register/request') {
    return { path, method: 'POST', requestBody: 'json' };
  }
  if (method === 'POST' && path === 'auth/register/verify') {
    return { path, method: 'POST', requestBody: 'json' };
  }
  if (method === 'POST' && path === 'auth/complete-profile') {
    return { path, method: 'POST', requiresBearer: true, requestBody: 'json' };
  }
  if (method === 'POST' && path === 'auth/logout') {
    return { path, method: 'POST', requiresBearer: true, requestBody: 'json' };
  }
  if (method === 'POST' && path === 'leases/newcommands') {
    return {
      path,
      method: 'POST',
      requiresBearer: true,
      requestBody: 'multipart',
    };
  }
  if (method === 'POST' && path === 'booking-periods') {
    return { path, method: 'POST', requiresBearer: true, requestBody: 'json' };
  }
  if (method === 'GET' && path === 'client/me') {
    return { path, method: 'GET', requiresBearer: true };
  }
  if (method === 'PUT' && patterns.client.test(path)) {
    return { path, method: 'PUT', requiresBearer: true, requestBody: 'json' };
  }
  if (method === 'GET' && patterns.bookings.test(path)) {
    return { path, method: 'GET', requiresBearer: true };
  }
  if (method === 'GET' && path === 'chats/user') {
    return { path, method: 'GET', requiresBearer: true };
  }
  if (method === 'GET' && patterns.chatMessages.test(path)) {
    return { path, method: 'GET', requiresBearer: true };
  }
  if (method === 'GET' && patterns.walletBalance.test(path)) {
    return { path, method: 'GET', requiresBearer: true };
  }
  if (method === 'GET' && patterns.cashoutHistory.test(path)) {
    return { path, method: 'GET', requiresBearer: true };
  }
  if (method === 'GET' && patterns.cashoutBankInfo.test(path)) {
    return { path, method: 'GET', requiresBearer: true };
  }
  if (method === 'GET' && patterns.clientNotifications.test(path)) {
    return { path, method: 'GET', requiresBearer: true };
  }
  if (method === 'GET' && patterns.stripeAccountLink.test(path)) {
    return { path, method: 'GET', requiresBearer: true };
  }
  if (method === 'GET' && patterns.bookingContract.test(path)) {
    return { path, method: 'GET', requiresBearer: true };
  }
  if (method === 'POST' && patterns.sendMessage.test(path)) {
    return { path, method: 'POST', requiresBearer: true, requestBody: 'json' };
  }
  if (method === 'POST' && path === 'cashout/request') {
    return { path, method: 'POST', requiresBearer: true, requestBody: 'json' };
  }
  if (method === 'POST' && patterns.readAllNotifications.test(path)) {
    return { path, method: 'POST', requiresBearer: true, requestBody: 'empty' };
  }
  if (method === 'POST' && patterns.readNotification.test(path)) {
    return { path, method: 'POST', requiresBearer: true, requestBody: 'empty' };
  }
  return undefined;
}
