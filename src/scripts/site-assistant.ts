import { webAnalyticsHeaders } from './web-analytics-context.ts';
import { webMarketingHeaders } from './web-marketing-context.ts';

type JsonRecord = Record<string, unknown>;
type Turn = { conversationId: number; status: string; messages: JsonRecord[]; pendingAction?: JsonRecord };
const SESSION_KEY = 'goodlease:session';
const API_ROOT = '/api/app/assistant/conversations';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : '';
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const money = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);

/** Same public-text guard as mobile; never render model HTML or tool traces. */
export const assistantVisibleText = (value: unknown) => text(value).replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, '').trim();

export function parseAssistantTurn(value: unknown): Turn {
  if (!record(value) || !positiveId(value.conversationId) || !Array.isArray(value.messages)) {
    throw new Error('Réponse de l’assistant illisible. Actualisez la conversation.');
  }
  return {
    conversationId: value.conversationId,
    status: text(value.status),
    messages: value.messages.filter(record).filter(m => m.role === 'user' || m.role === 'assistant'),
    pendingAction: record(value.pendingAction) ? value.pendingAction : undefined,
  };
}

const actionLabels: Record<string, string> = {
  cart_add_item: 'Confirmer l’ajout au panier',
  cart_update_item: 'Confirmer la modification',
  cart_remove_item: 'Confirmer le retrait',
  report_missing_product: 'Transmettre ce besoin à GoodLease',
};

/** Incomplete, mismatched, expired or unknown previews cannot be approved. */
export function canApproveAssistantAction(action: JsonRecord, now = Date.now()): boolean {
  const tool = text(action.tool), preview = action.preview;
  if (!Object.hasOwn(actionLabels, tool) || !UUID.test(text(action.actionId)) || !record(preview) || preview.action !== tool) return false;
  const expires = Date.parse(text(action.expiresAt));
  if (!Number.isFinite(expires) || expires <= now) return false;
  if (tool === 'report_missing_product') return Boolean(text(preview.need).trim());
  const line = preview.line, cart = preview.cart;
  if (!record(line) || !record(line.item) || !record(cart) || !Array.isArray(cart.items)) return false;
  const item = line.item, start = text(item.startDate), end = text(item.endDate);
  return positiveId(item.leaseId) && Number.isInteger(item.quantity) && Number(item.quantity) >= 1 && Number(item.quantity) <= 500
    && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end
    && Boolean(text(line.title).trim()) && amount(line.lineTotal) && amount(line.deposit)
    && amount(cart.subtotal) && amount(cart.serviceFee) && amount(cart.total) && amount(cart.totalDeposits);
}

class AssistantApiError extends Error {
  status: number;
  constructor(status: number) {
    super(({
      400: 'Vérifiez votre message et les informations de votre demande.',
      401: 'Votre session a expiré. Reconnectez-vous pour discuter avec l’assistant.',
      403: 'Ce compte ne peut pas accéder à cette conversation.',
      404: 'Cette conversation ou ce service est introuvable.',
      409: 'Une réponse est peut-être encore en cours. Actualisez la conversation.',
      429: 'La limite de demandes est atteinte. Réessayez plus tard.',
      503: 'L’assistant est momentanément indisponible. Vous pouvez contacter l’équipe GoodLease.',
    } as Record<number, string>)[status] || 'L’assistant ne répond pas pour le moment. Actualisez avant de renvoyer votre message.');
    this.status = status;
  }
}

export function mountSiteAssistant() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const launcher = $<HTMLButtonElement>('site-assistant-open');
  const panel = $<HTMLDialogElement>('site-assistant-panel');
  if (!launcher || !panel || panel.dataset.mounted || typeof panel.showModal !== 'function') return;
  panel.dataset.mounted = 'true';
  launcher.hidden = false;
  const close = $<HTMLButtonElement>('site-assistant-close');
  const login = $('site-assistant-login'), workspace = $('site-assistant-workspace');
  const history = $<HTMLSelectElement>('site-assistant-history');
  const newButton = $<HTMLButtonElement>('site-assistant-new'), refresh = $<HTMLButtonElement>('site-assistant-refresh');
  const messages = $('site-assistant-messages'), actionBox = $('site-assistant-action');
  const form = $<HTMLFormElement>('site-assistant-form');
  const input = $<HTMLTextAreaElement>('site-assistant-message');
  const status = $('site-assistant-status');
  let currentToken = '', turn: Turn | undefined;
  let busy = false, uncertain = false, authExpired = false, generation = 0;
  let loginToken: string | undefined;
  let sessionTimer: ReturnType<typeof setInterval> | undefined;
  const requests = new Set<AbortController>();

  const sessionToken = () => {
    try {
      const session: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return record(session) ? text(session.accessToken) || text(session.token) : '';
    } catch { return ''; }
  };
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, content = '', className = '') => {
    const element = document.createElement(tag);
    element.textContent = content;
    if (className) element.className = className;
    return element;
  };
  const announce = (message = '', error = false) => {
    status.textContent = message;
    status.dataset.error = String(error);
  };

  function syncSession() {
    const token = sessionToken();
    if (token === currentToken) return false;
    generation++;
    requests.forEach(controller => controller.abort());
    currentToken = token;
    turn = undefined;
    busy = uncertain = authExpired = false;
    history.replaceChildren(new Option('Nouvelle conversation', ''));
    form.reset();
    announce();
    render();
    return true;
  }

  async function request(path = '', body?: JsonRecord): Promise<unknown> {
    const token = sessionToken();
    if (!token || token !== currentToken) throw new AssistantApiError(401);
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 80_000);
    try {
      const headers: Record<string, string> = { Accept: 'application/json', Authorization: 'Bearer ' + token };
      if (body !== undefined) {
        Object.assign(headers, { 'Content-Type': 'application/json' }, await webAnalyticsHeaders('agent'), webMarketingHeaders());
      }
      if (sessionToken() !== token) throw new AssistantApiError(401);
      const response = await fetch(API_ROOT + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new AssistantApiError(response.status);
      const value: unknown = await response.json();
      if (sessionToken() !== token) throw new AssistantApiError(401);
      return value;
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }

  function failed(error: unknown, writing: boolean) {
    if (error instanceof AssistantApiError && error.status === 401) {
      authExpired = true;
      turn = undefined;
      history.replaceChildren(new Option('Nouvelle conversation', ''));
      form.reset();
    }
    // A failed read cannot clear uncertainty about a previous write.
    if (writing) uncertain = !(error instanceof AssistantApiError) || error.status >= 500 || error.status === 409;
    const message = error instanceof Error && error.name !== 'AbortError' ? error.message : 'Connexion interrompue.';
    announce(message + (uncertain ? ' Actualisez l’historique avant de renvoyer votre message.' : ''), true);
  }

  function addCart(parent: HTMLElement, value: unknown) {
    if (!record(value) || !Array.isArray(value.items)) return;
    const summary = node('div', '', 'site-assistant-result');
    summary.append(node('strong', 'Panier estimé · hors dépôt de garantie'));
    for (const line of value.items.filter(record)) {
      if (!record(line.item)) continue;
      summary.append(node('span', text(line.title) + ' · quantité ' + (Number.isInteger(line.item.quantity) ? line.item.quantity : 'à vérifier')
        + (amount(line.lineTotal) ? ' · ' + money(line.lineTotal) : '')));
    }
    for (const [key, label] of [['subtotal', 'Sous-total'], ['serviceFee', 'Frais de service estimés'], ['total', 'Total estimé'], ['totalDeposits', 'Dépôts de garantie']] as const) {
      if (amount(value[key])) summary.append(node('span', label + ' : ' + money(value[key])));
    }
    if (text(value.pricingNote)) summary.append(node('small', text(value.pricingNote)));
    summary.append(node('small', 'Le panier ne réserve pas le matériel. Vérifiez les conditions et les montants avant tout paiement.'));
    parent.append(summary);
  }

  function addComponents(parent: HTMLElement, components: unknown) {
    if (!Array.isArray(components)) return;
    for (const component of components.filter(record)) {
      const type = text(component.type);
      if (type === 'tool_trace' || type === 'approval_request') continue;
      if (type === 'listing_card' || (positiveId(component.leaseId) && amount(component.pricePerDay))) {
        if (!positiveId(component.leaseId) || !text(component.title)) continue;
        const result = node('div', '', 'site-assistant-result'), link = node('a', text(component.title));
        link.href = '/annonce/' + component.leaseId;
        result.append(link, node('span', [text(component.category), text(component.city)].filter(Boolean).join(' · ')));
        if (amount(component.pricePerDay)) result.append(node('strong', money(component.pricePerDay) + ' / jour'));
        if (amount(component.deposit)) result.append(node('small', 'Dépôt de garantie : ' + money(component.deposit)));
        result.append(node('small', component.availableForBrief === true ? 'Consultez l’annonce pour vérifier les conditions de location.' : 'Disponibilité non confirmée pour votre recherche.'));
        parent.append(result);
      } else if (type === 'choice_chips' || (Array.isArray(component.options) && typeof component.question === 'string')) {
        if (text(component.question)) parent.append(node('p', text(component.question)));
        const choices = node('div', '', 'site-assistant-choices');
        for (const option of (Array.isArray(component.options) ? component.options : []).filter(record)) {
          if (!text(option.label) || !text(option.value)) continue;
          const button = node('button', text(option.label), 'site-assistant-choice');
          button.type = 'button';
          button.disabled = busy || uncertain || turn?.status === 'RUNNING';
          button.addEventListener('click', () => void send(text(option.value)));
          choices.append(button);
        }
        parent.append(choices);
      } else if (type === 'cart_summary' || record(component.cart)) addCart(parent, component.cart);
    }
  }

  function renderAction() {
    actionBox.replaceChildren();
    const action = turn?.pendingAction;
    actionBox.hidden = !action;
    if (!action) return;
    const preview = record(action.preview) ? action.preview : {};
    actionBox.append(node('strong', text(preview.title) || 'Proposition à confirmer'));
    const valid = canApproveAssistantAction(action);
    if (valid && action.tool === 'report_missing_product') {
      for (const key of ['need', 'categoryGuess', 'details']) if (text(preview[key])) actionBox.append(node('p', text(preview[key])));
    } else if (valid && record(preview.line) && record(preview.line.item)) {
      const line = preview.line, item = preview.line.item;
      actionBox.append(node('p', text(line.title) + '\nQuantité : ' + item.quantity + '\nDu ' + text(item.startDate) + ' au ' + text(item.endDate)
        + '\nMontant de la ligne : ' + money(Number(line.lineTotal)) + '\nDépôt de garantie : ' + money(Number(line.deposit))));
      addCart(actionBox, preview.cart);
    } else actionBox.append(node('p', 'Cette proposition est incomplète ou expirée. Actualisez ou demandez une nouvelle proposition à l’assistant.'));
    const buttons = node('div', '', 'site-assistant-action-buttons');
    const approve = node('button', Object.hasOwn(actionLabels, text(action.tool)) ? actionLabels[text(action.tool)] : 'Confirmer', 'btn-primary');
    approve.type = 'button';
    approve.disabled = !valid || busy || uncertain;
    approve.addEventListener('click', () => void decide(true));
    const reject = node('button', 'Refuser', 'btn-secondary');
    reject.type = 'button';
    reject.disabled = busy || uncertain || !UUID.test(text(action.actionId));
    reject.addEventListener('click', () => void decide(false));
    buttons.append(approve, reject);
    actionBox.append(buttons);
  }

  function render() {
    const signedIn = Boolean(currentToken) && !authExpired;
    panel.dataset.signedIn = String(signedIn);
    $('site-assistant-intro').hidden = signedIn;
    workspace.hidden = !signedIn;
    login.hidden = signedIn;
    history.disabled = newButton.disabled = refresh.disabled = busy;
    const blocked = busy || uncertain || turn?.status === 'RUNNING';
    input.disabled = blocked;
    form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = blocked;
    messages.replaceChildren();
    actionBox.replaceChildren();
    actionBox.hidden = true;
    if (!panel.open) return;
    if (signedIn && !turn?.messages.length) messages.append(node('p', 'Décrivez le matériel recherché, le lieu, les dates et votre budget pour commencer.'));
    for (const message of signedIn ? turn?.messages || [] : []) {
      const bubble = node('div', '', 'site-assistant-message' + (message.role === 'user' ? ' is-user' : ''));
      bubble.append(node('strong', message.role === 'user' ? 'Vous' : 'Assistant GoodLease'));
      const visible = assistantVisibleText(message.text);
      if (visible) bubble.append(node('p', visible));
      if (message.role === 'assistant') addComponents(bubble, message.components);
      if (visible || bubble.children.length > 1) messages.append(bubble);
    }
    renderAction();
    messages.scrollTop = messages.scrollHeight;
    if (turn) {
      if (![...history.options].some(option => option.value === String(turn!.conversationId))) history.add(new Option('Conversation en cours', String(turn.conversationId)));
      history.value = String(turn.conversationId);
    }
    if (turn?.status === 'RUNNING' && !busy) announce('L’assistant prépare sa réponse. Cliquez sur Actualiser pour la retrouver.');
  }

  async function loadHistory() {
    const list = await request();
    if (!Array.isArray(list)) throw new Error('Historique indisponible pour le moment.');
    history.replaceChildren(new Option('Nouvelle conversation', ''));
    for (const conversation of list.filter(record)) {
      if (positiveId(conversation.id)) history.add(new Option(text(conversation.title) || 'Mon événement', String(conversation.id)));
    }
    history.value = turn ? String(turn.conversationId) : '';
  }

  async function perform(work: () => Promise<void>, writing = false) {
    if (busy) return;
    // Do not submit a draft or a decision captured under a different session.
    if (syncSession()) { render(); return; }
    if (!currentToken || authExpired) { render(); return; }
    const expected = generation;
    busy = true;
    announce(writing ? 'L’assistant prépare sa réponse…' : 'Chargement…');
    render();
    try { await work(); if (expected === generation) announce(); }
    catch (error) { if (expected === generation) failed(error, writing); }
    finally { if (expected === generation) { busy = false; render(); } }
  }

  async function send(message: string) {
    const value = message.trim();
    if (!value || value.length > 1000 || uncertain || turn?.status === 'RUNNING') return;
    await perform(async () => {
      // Allocate first, so a lost message response can be recovered by its known ID.
      if (!turn) turn = parseAssistantTurn(await request('', {}));
      turn = parseAssistantTurn(await request('/' + turn.conversationId + '/messages', { text: value }));
      form.reset();
      uncertain = false;
    }, true);
  }

  async function decide(approve: boolean) {
    const action = turn?.pendingAction;
    if (!turn || !action || uncertain || !UUID.test(text(action.actionId)) || (approve && !canApproveAssistantAction(action))) return;
    const id = turn.conversationId;
    await perform(async () => {
      turn = parseAssistantTurn(await request('/' + id + '/actions/' + action.actionId, { decision: approve ? 'APPROVE' : 'REJECT' }));
    }, true);
  }

  async function refreshConversation() {
    await perform(async () => {
      if (turn) turn = parseAssistantTurn(await request('/' + turn.conversationId));
      await loadHistory();
      if (uncertain) form.reset();
      uncertain = false;
    });
  }

  function open() {
    syncSession();
    if (!panel.open) panel.showModal();
    render();
    if (currentToken && !authExpired && !busy) void refreshConversation();
    clearInterval(sessionTimer);
    sessionTimer = setInterval(() => { if (syncSession() && currentToken) void refreshConversation(); }, 1000);
  }

  launcher.addEventListener('click', open);
  close.addEventListener('click', () => panel.close());
  panel.addEventListener('click', event => {
    if (event.target !== panel) return;
    const bounds = panel.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) panel.close();
  });
  panel.addEventListener('close', () => {
    clearInterval(sessionTimer);
    messages.replaceChildren();
    actionBox.replaceChildren();
    actionBox.hidden = true;
    history.replaceChildren(new Option('Nouvelle conversation', ''));
    form.reset();
    if (turn) turn = { conversationId: turn.conversationId, status: turn.status, messages: [] };
    launcher.focus({ preventScroll: true });
  });
  $('site-assistant-connect').addEventListener('click', () => {
    const authDialog = document.querySelector<HTMLDialogElement>('#auth-dialog');
    if (authDialog) { loginToken = sessionToken(); panel.close(); authDialog.showModal(); }
    else location.assign('/app/?assistant=1');
  });
  document.querySelector<HTMLDialogElement>('#auth-dialog')?.addEventListener('close', () => {
    const token = sessionToken();
    const resume = loginToken !== undefined && token && token !== loginToken;
    loginToken = undefined;
    if (resume) open();
  });
  form.addEventListener('submit', event => { event.preventDefault(); void send(input.value); });
  refresh.addEventListener('click', () => void refreshConversation());
  history.addEventListener('change', () => {
    const id = Number(history.value);
    turn = undefined;
    if (!positiveId(id)) { uncertain = false; form.reset(); render(); return; }
    uncertain = true;
    void perform(async () => { turn = parseAssistantTurn(await request('/' + id)); uncertain = false; form.reset(); });
  });
  newButton.addEventListener('click', () => { turn = undefined; uncertain = false; history.value = ''; form.reset(); announce(); render(); input.focus(); });
  if (document.querySelector('.webapp') && new URLSearchParams(location.search).get('assistant') === '1') open();
}

