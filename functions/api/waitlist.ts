/**
 * Cloudflare Pages Function — inscription waitlist.
 * Relaie l'e-mail vers Brevo en gardant la clé API côté serveur. Configurez les variables
 * d'environnement dans le dashboard Cloudflare Pages (Settings → Environment variables) :
 *   - BREVO_API_KEY          : clé API Brevo (v3)
 *   - BREVO_WAITLIST_LIST_ID : id numérique de la liste "waitlist"
 *   - BREVO_NEWSLETTER_LIST_ID (optionnel) : id de la liste newsletter
 *   - BREVO_DOI_TEMPLATE_ID  (optionnel) : id du template d'e-mail de confirmation (double opt-in)
 *   - BREVO_DOI_REDIRECT_URL (optionnel) : URL de redirection après confirmation
 *                                          (ex. https://goodlease.fr/?confirm=1)
 *
 * Trois modes selon la config :
 *   1. clé + liste + template DOI  → DOUBLE OPT-IN : Brevo envoie un e-mail de confirmation,
 *      le contact n'est ajouté à la liste qu'après clic (RGPD-friendly, recommandé).
 *   2. clé + liste (sans template) → single opt-in : ajout direct à la liste.
 *   3. aucune clé                  → mode démo : 200 sans rien envoyer (test UI local).
 */

interface Env {
  BREVO_API_KEY?: string;
  BREVO_WAITLIST_LIST_ID?: string;
  BREVO_NEWSLETTER_LIST_ID?: string;
  BREVO_DOI_TEMPLATE_ID?: string;
  BREVO_DOI_REDIRECT_URL?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { email?: string; newsletter?: boolean; company?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (body.company) return json({ ok: true }); // honeypot
  const email = (body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'invalid_email' }, 422);
  }

  // Pas de clé configurée → on accepte sans envoyer (mode démo).
  if (!env.BREVO_API_KEY || !env.BREVO_WAITLIST_LIST_ID) {
    return json({ ok: true, queued: false });
  }

  // Les ids de liste/template viennent d'env vars → on valide la coercition numérique :
  // un id mal configuré donnerait NaN (sérialisé en null) et une inscription silencieusement perdue.
  const waitlistId = Number(env.BREVO_WAITLIST_LIST_ID);
  if (!Number.isInteger(waitlistId)) {
    console.error('BREVO_WAITLIST_LIST_ID invalide (pas un entier) :', env.BREVO_WAITLIST_LIST_ID);
    return json({ error: 'config_error' }, 500);
  }
  const listIds = [waitlistId];
  if (body.newsletter && env.BREVO_NEWSLETTER_LIST_ID) {
    const newsletterId = Number(env.BREVO_NEWSLETTER_LIST_ID);
    if (Number.isInteger(newsletterId)) listIds.push(newsletterId);
  }

  const headers = { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY };

  // Mode 1 — double opt-in : Brevo envoie l'e-mail de confirmation, ajout à la liste après clic.
  if (env.BREVO_DOI_TEMPLATE_ID && env.BREVO_DOI_REDIRECT_URL) {
    const templateId = Number(env.BREVO_DOI_TEMPLATE_ID);
    if (!Number.isInteger(templateId)) {
      console.error('BREVO_DOI_TEMPLATE_ID invalide (pas un entier) :', env.BREVO_DOI_TEMPLATE_ID);
      return json({ error: 'config_error' }, 500);
    }
    const res = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        includeListIds: listIds,
        templateId,
        redirectionUrl: env.BREVO_DOI_REDIRECT_URL,
      }),
    });
    // Sur le DOI, un 400 n'est pas un succès documenté (template/liste invalide, etc.) :
    // on remonte l'erreur au lieu de l'avaler, sinon l'inscription est perdue en silence.
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('Brevo DOI error', res.status, detail);
      return json({ error: 'provider_error' }, 502);
    }
    return json({ ok: true, queued: true, doi: true });
  }

  // Mode 2 — single opt-in : ajout direct à la liste.
  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, listIds, updateEnabled: true }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Brevo renvoie 400 "duplicate_parameter" si l'e-mail est déjà inscrit → on considère ça
    // comme un succès. Tout autre 400 (liste invalide, etc.) reste une vraie erreur.
    if (res.status === 400 && /duplicate_parameter|already/i.test(detail)) {
      return json({ ok: true, queued: true });
    }
    console.error('Brevo contacts error', res.status, detail);
    return json({ error: 'provider_error' }, 502);
  }

  return json({ ok: true, queued: true });
};
