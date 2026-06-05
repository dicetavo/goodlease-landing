/**
 * Cloudflare Pages Function — inscription waitlist.
 * Relaie l'e-mail vers Brevo (création/màj d'un contact dans une liste) en gardant
 * la clé API côté serveur. Configurez les variables d'environnement dans le dashboard
 * Cloudflare Pages (Settings → Environment variables) :
 *   - BREVO_API_KEY        : clé API Brevo (v3)
 *   - BREVO_WAITLIST_LIST_ID: id numérique de la liste "waitlist"
 *   - BREVO_NEWSLETTER_LIST_ID (optionnel) : id de la liste newsletter
 *
 * Tant que ces variables ne sont pas définies, l'endpoint répond 200 sans rien envoyer
 * (le front affiche le message de succès) — pratique pour tester l'UI avant de brancher Brevo.
 */

interface Env {
  BREVO_API_KEY?: string;
  BREVO_WAITLIST_LIST_ID?: string;
  BREVO_NEWSLETTER_LIST_ID?: string;
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

  const listIds = [Number(env.BREVO_WAITLIST_LIST_ID)];
  if (body.newsletter && env.BREVO_NEWSLETTER_LIST_ID) {
    listIds.push(Number(env.BREVO_NEWSLETTER_LIST_ID));
  }

  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
    body: JSON.stringify({ email, listIds, updateEnabled: true }),
  });

  // Brevo renvoie 400 "Contact already exist" si déjà inscrit → on considère ça comme un succès.
  if (!res.ok && res.status !== 400) {
    return json({ error: 'provider_error' }, 502);
  }

  return json({ ok: true, queued: true });
};
