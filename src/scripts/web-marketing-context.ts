import { encodeWebContext, webAnalyticsEnvironment } from './web-analytics-context.ts';

export const MARKETING_INSTALL_KEY = 'goodlease:marketing-installation:v1';
export const MARKETING_REVOKE_KEY = 'goodlease:marketing-revocations:v1';
let allowed = false;
let installation = '';
let activeWindow: Window | undefined;
const pendingByWindow = new WeakMap<Window, Set<string>>();
const sendingByWindow = new WeakMap<Window, Set<string>>();

function pendingRevocations(win: Window) {
  let pending = pendingByWindow.get(win);
  if (!pending) {
    pending = new Set<string>();
    try {
      const saved: unknown = JSON.parse(win.localStorage.getItem(MARKETING_REVOKE_KEY) || '[]');
      if (Array.isArray(saved)) for (const id of saved) if (typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)) pending.add(id);
    } catch { /* Retain in-memory withdrawals when storage is unavailable. */ }
    pendingByWindow.set(win, pending);
    sendingByWindow.set(win, new Set());
    win.addEventListener?.('online', () => flushRevocations(win));
  }
  return pending;
}

function saveRevocations(win: Window, pending: Set<string>, acknowledged?: string) {
  try {
    // A response from this tab must not erase withdrawals queued by another tab
    // while the request was in flight.
    const saved: unknown = JSON.parse(win.localStorage.getItem(MARKETING_REVOKE_KEY) || '[]');
    if (Array.isArray(saved)) for (const id of saved) if (typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)) pending.add(id);
    if (acknowledged) pending.delete(acknowledged);
    if (pending.size) win.localStorage.setItem(MARKETING_REVOKE_KEY, JSON.stringify([...pending]));
    else win.localStorage.removeItem(MARKETING_REVOKE_KEY);
  } catch { /* Current-page refusal still takes effect. */ }
}

function flushRevocations(win: Window) {
  const pending = pendingRevocations(win);
  const sending = sendingByWindow.get(win)!;
  for (const id of pending) {
    if (sending.has(id)) continue;
    sending.add(id);
    const header = encodeWebContext({ installationId: id, marketing: false, consentVersion: 1, platform: 'web' });
    try {
      void win.fetch('/api/app/marketing/revoke', { method: 'POST', headers: { 'X-GoodLease-Marketing': header }, keepalive: true })
        .then(response => {
          if (response.status === 204) saveRevocations(win, pending, id);
        }).catch(() => {}).finally(() => sending.delete(id));
    } catch { sending.delete(id); }
  }
}

/** Kept separate from GA client IDs and the statistical-consent installation. */
export function updateWebMarketingConsent(granted: boolean, pixelId: string, win = window) {
  activeWindow = win;
  let saved = '';
  try { saved = win.localStorage.getItem(MARKETING_INSTALL_KEY) || ''; } catch { /* Tab-only storage. */ }
  const previous = installation || (/^[a-f0-9]{32}$/.test(saved) ? saved : '');
  allowed = granted && /^\d{5,30}$/.test(pixelId) && webAnalyticsEnvironment(win.location.href) === 'production';
  if (allowed) {
    try {
      installation = (previous && !pendingRevocations(win).has(previous) ? previous : '') || Array.from(win.crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
      try { win.localStorage.setItem(MARKETING_INSTALL_KEY, installation); } catch { /* No persistence. */ }
    } catch { installation = ''; }
  } else {
    installation = '';
    if (previous) {
      const pending = pendingRevocations(win);
      pending.add(previous);
      saveRevocations(win, pending);
      try { win.localStorage.removeItem(MARKETING_INSTALL_KEY); } catch { /* No persistence. */ }
    }
  }
  // No matching cookies remain in the queue; only denial capabilities survive until
  // acknowledged. Reload/online retry cannot revoke a newly accepted installation.
  flushRevocations(win);
  win.dispatchEvent(new Event('goodlease:marketing-consent'));
}

export function webMarketingHeaders(): Record<string, string> {
  if (!allowed || !installation || !activeWindow) return {};
  const context: Record<string, unknown> = { installationId: installation, marketing: true, consentVersion: 1, platform: 'web' };
  try {
    for (const [cookie, key, pattern] of [['_fbp', 'fbp', /^fb\.[0-9]\.[0-9]{13}\.[0-9]{1,30}$/], ['_fbc', 'fbc', /^fb\.[0-9]\.[0-9]{13}\.[A-Za-z0-9_-]{1,200}$/]] as const) {
      const value = activeWindow.document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(`${cookie}=`))?.slice(cookie.length + 1);
      if (value && pattern.test(value)) context[key] = value;
    }
  } catch { /* Cookie blocking must not disable the application. */ }
  // No URL parameters, raw email/phone, GA identifiers or fabricated click IDs.
  return { 'X-GoodLease-Marketing': encodeWebContext(context) };
}
