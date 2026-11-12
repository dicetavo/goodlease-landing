import { webCampaign } from './web-analytics-context.ts';

export const ATTRIBUTION_TTL = 30 * 60 * 1000;
export const ATTRIBUTION_KEYS = {
  analytics: 'goodlease:attribution:analytics:v1',
  marketing: 'goodlease:attribution:marketing:v1',
};
type Purposes = { analytics: boolean; marketing: boolean };
type Purpose = keyof Purposes;
type Entry = { version: string; capturedAt: number; data: Record<string, string> };
export type AttributionPage = {
  page_location: string; page_referrer: string;
  campaignExpiresAt: number; marketingExpiresAt: number;
};
const campaignKeys: Record<string, string> = { source: 'utm_source', medium: 'utm_medium', campaign: 'utm_campaign', id: 'utm_id' };
const clickIds = ['gclid', 'dclid', 'gbraid', 'wbraid', 'fbclid'];

function parameters(raw: string, advertising: boolean) {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(webCampaign(raw))) data[key === 'name' ? 'campaign' : key] = value;
  try {
    const url = new URL(raw);
    if (advertising) for (const key of clickIds) {
      const value = url.searchParams.get(key);
      if (value && /^[a-zA-Z0-9_-]{1,256}$/.test(value)) data[key] = value;
    }
  } catch { /* Invalid URLs carry no attribution. */ }
  return data;
}

function urlWithParameters(raw: string, data: Record<string, string>) {
  try {
    const original = new URL(raw);
    const url = new URL(original.origin + original.pathname);
    for (const [key, value] of Object.entries(data)) url.searchParams.set(campaignKeys[key] || key, value);
    return url.href;
  } catch { return ''; }
}

/** The existing allowlist, shared by URL sanitization and the consented cache. */
export function measurementUrl(raw: string, advertising = false) {
  return urlWithParameters(raw, parameters(raw, advertising));
}

function filteredUrl(raw: string, campaigns: boolean, advertising: boolean) {
  const data = parameters(raw, advertising);
  if (!campaigns) for (const key of Object.keys(campaignKeys)) delete data[key];
  return urlWithParameters(raw, data);
}

export function createMarketingAttribution(storage: () => Storage | undefined, version: string, now = Date.now) {
  const entries: Partial<Record<Purpose, Entry>> = {};
  const grantedAt: Partial<Record<Purpose, number>> = {};
  let purposes: Purposes = { analytics: false, marketing: false };
  let initiallyStored = false;
  const persist = (purpose: Purpose) => {
    try {
      const entry = entries[purpose];
      if (entry) storage()?.setItem(ATTRIBUTION_KEYS[purpose], JSON.stringify(entry));
      else storage()?.removeItem(ATTRIBUTION_KEYS[purpose]);
    } catch { /* The current page still works without sessionStorage. */ }
  };
  for (const purpose of Object.keys(ATTRIBUTION_KEYS) as Purpose[]) {
    try {
      const raw = storage()?.getItem(ATTRIBUTION_KEYS[purpose]);
      initiallyStored ||= Boolean(raw);
      const value = JSON.parse(raw || 'null');
      if (!value || value.version !== version || !Number.isFinite(value.capturedAt) || value.capturedAt < 0 || value.capturedAt > now()) continue;
      // Revalidate stored fields too; never retain arbitrary query strings or URLs.
      const query = new URL('https://goodlease.invalid/');
      for (const key of [...Object.keys(campaignKeys), ...(purpose === 'marketing' ? clickIds : [])]) {
        if (typeof value.data?.[key] === 'string') query.searchParams.set(campaignKeys[key] || key, value.data[key]);
      }
      const data = parameters(query.href, purpose === 'marketing');
      if (Object.keys(data).length) entries[purpose] = { version, capturedAt: value.capturedAt, data };
    } catch { /* Malformed or inaccessible storage is discarded on consent sync. */ }
  }
  function prune() {
    for (const purpose of Object.keys(entries) as Purpose[]) {
      if (!purposes[purpose] || entries[purpose]!.capturedAt + ATTRIBUTION_TTL <= now()) {
        delete entries[purpose]; persist(purpose);
      }
    }
  }
  function updateConsent(next: Purposes, arrival?: string) {
    const incoming = arrival === undefined ? undefined : parameters(arrival, next.marketing);
    for (const purpose of Object.keys(ATTRIBUTION_KEYS) as Purpose[]) {
      const previous = entries[purpose];
      if (!next[purpose]) {
        delete entries[purpose]; delete grantedAt[purpose];
      } else {
        const data = incoming && { ...incoming };
        if (data && purpose === 'analytics') for (const key of clickIds) delete data[key];
        // Reading, reloading or accepting the same origin must not slide the TTL.
        if (data && Object.keys(data).length && JSON.stringify(data) !== JSON.stringify(previous?.data)) {
          entries[purpose] = { version, capturedAt: now(), data };
        }
        grantedAt[purpose] ??= entries[purpose]?.capturedAt ?? previous?.capturedAt ?? now();
        if (entries[purpose] && entries[purpose]!.capturedAt + ATTRIBUTION_TTL <= now()) delete entries[purpose];
      }
      persist(purpose);
    }
    purposes = { ...next };
  }
  function redact(page: AttributionPage): AttributionPage {
    prune();
    const campaigns = (purposes.analytics || purposes.marketing) && page.campaignExpiresAt > now();
    const advertising = purposes.marketing && page.marketingExpiresAt > now();
    return { ...page, page_location: filteredUrl(page.page_location, campaigns, advertising),
      page_referrer: filteredUrl(page.page_referrer, campaigns, advertising) };
  }
  function snapshot(raw: string, referrer: string): AttributionPage {
    prune();
    const campaignEntry = entries.analytics || entries.marketing;
    const data: Record<string, string> = {};
    for (const key of Object.keys(campaignKeys)) if (campaignEntry?.data[key]) data[key] = campaignEntry.data[key];
    for (const key of clickIds) if (entries.marketing?.data[key]) data[key] = entries.marketing.data[key];
    const campaignAt = campaignEntry?.capturedAt ?? grantedAt.analytics ?? grantedAt.marketing;
    const marketingAt = entries.marketing?.capturedAt ?? grantedAt.marketing;
    return redact({ page_location: urlWithParameters(raw, data), page_referrer: measurementUrl(referrer, purposes.marketing),
      campaignExpiresAt: campaignAt === undefined ? 0 : campaignAt + ATTRIBUTION_TTL,
      marketingExpiresAt: marketingAt === undefined ? 0 : marketingAt + ATTRIBUTION_TTL });
  }
  function nextExpiry() {
    prune();
    const times = Object.values(entries).map(entry => entry.capturedAt + ATTRIBUTION_TTL)
      .concat(Object.values(grantedAt).map(time => time + ATTRIBUTION_TTL)).filter(time => time > now());
    return times.length ? Math.min(...times) : undefined;
  }
  return { initiallyStored, updateConsent, snapshot, redact, prune, nextExpiry };
}
