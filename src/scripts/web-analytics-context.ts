/** Web supplies consenting gtag identifiers; server credentials stay in Secret Manager. */
export const WEB_INSTALL_KEY = 'goodlease:analytics-installation:v1';
type AnalyticsWindow = Window & { gtag?: (...args: unknown[]) => void };
let allowed = false;
let measurementId = '';
let installation = '';
let activeWindow: AnalyticsWindow | undefined;

export function webAnalyticsEnvironment(raw: string) {
  try { return ['goodlease.fr', 'www.goodlease.fr'].includes(new URL(raw).hostname) ? 'production' : 'preview'; }
  catch { return 'preview'; }
}

export function encodeWebContext(value: Record<string, unknown>) {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function validWebIdentifiers(clientId: unknown, sessionId: unknown) {
  const session = Number(sessionId);
  return typeof clientId === 'string' && /^\d{1,20}\.\d{1,20}$/.test(clientId) && Number.isSafeInteger(session) && session > 0;
}

export function webCampaign(raw: string) {
  const campaign: Record<string, string> = {};
  try {
    const params = new URL(raw).searchParams;
    for (const [field, key] of [['source', 'utm_source'], ['medium', 'utm_medium'], ['name', 'utm_campaign'], ['id', 'utm_id']]) {
      const value = params.get(key) || '';
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) continue;
      if (field === 'source' && !['google', 'meta', 'facebook', 'instagram', 'tiktok', 'linkedin', 'newsletter', 'partner', 'organic'].includes(value)) continue;
      if (field === 'medium' && !['cpc', 'paid_social', 'organic_social', 'email', 'referral', 'organic'].includes(value)) continue;
      campaign[field] = value;
    }
  } catch { /* No attribution from malformed/free-form URLs. */ }
  return campaign;
}

function savedInstallation(win: AnalyticsWindow) {
  try { const saved = win.localStorage.getItem(WEB_INSTALL_KEY); if (saved && /^[a-f0-9]{32}$/.test(saved)) return saved; }
  catch { /* Choice applies to this tab if browser storage is unavailable. */ }
  return '';
}

export function updateWebAnalyticsConsent(granted: boolean, id: string, win = window as AnalyticsWindow) {
  activeWindow = win;
  measurementId = /^G-[A-Z0-9]+$/.test(id) ? id : '';
  const previous = installation || savedInstallation(win);
  allowed = granted && Boolean(measurementId);
  if (allowed) {
    try {
      installation = previous || Array.from(win.crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
      try { win.localStorage.setItem(WEB_INSTALL_KEY, installation); } catch { /* Tab-only fallback. */ }
    } catch { installation = ''; /* Unavailable identifiers must never block the app. */ }
  } else {
    installation = '';
    if (previous) {
      const header = encodeWebContext({ installationId: previous, analytics: false, consentVersion: 1, platform: 'web', appVersion: '1.0.0' });
      // Denial remains possible after logout, without transmitting a GA client ID.
      try { void win.fetch('/api/app/analytics/revoke', { method: 'POST', headers: { 'X-GoodLease-Analytics': header }, keepalive: true }).catch(() => {}); }
      catch { /* Consent is still withdrawn locally if networking is unavailable. */ }
      try { win.localStorage.removeItem(WEB_INSTALL_KEY); } catch { /* No local persistence. */ }
    }
  }
  win.dispatchEvent(new Event('goodlease:analytics-consent'));
}

function googleId(field: 'client_id' | 'session_id') {
  return new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 600);
    try { activeWindow?.gtag?.('get', measurementId, field, (value: unknown) => { clearTimeout(timer); resolve(value); }); }
    catch { clearTimeout(timer); resolve(undefined); }
  });
}

export async function webAnalyticsHeaders(bookingFlow: 'manual' | 'agent' = 'manual'): Promise<Record<string, string>> {
  if (!allowed || !installation || !activeWindow?.gtag) return {};
  const capturedInstallation = installation;
  const [clientId, sessionId] = await Promise.all([googleId('client_id'), googleId('session_id')]);
  if (!allowed || installation !== capturedInstallation || !validWebIdentifiers(clientId, sessionId)) return {};
  return { 'X-GoodLease-Analytics': encodeWebContext({ installationId: installation, analytics: true, consentVersion: 1,
    platform: 'web', appVersion: '1.0.0', clientId, sessionId: Number(sessionId),
    campaign: webCampaign(activeWindow.location.href), bookingFlow }) };
}

export function identifyWebAnalytics(user?: { user_id: string; account_type: string; user_type: string }) {
  if (!allowed || !activeWindow?.gtag) return;
  const valid = user && /^[1-9]\d{0,18}$/.test(user.user_id) &&
    ['real', 'internal', 'test', 'unknown'].includes(user.account_type) && ['locataire', 'bailleur', 'both'].includes(user.user_type);
  const type = webAnalyticsEnvironment(activeWindow.location.href) === 'preview' ? 'test' : valid ? user.account_type : 'unknown';
  const role = valid ? user.user_type : 'guest';
  try {
    activeWindow.gtag('set', { user_id: valid ? user.user_id : null,
      account_type: type, user_type: role,
      user_properties: { account_type: type, user_type: role } });
  } catch { /* Tracking is optional, including after login or logout. */ }
}
