/**
 * Cloudflare Pages Function — formulaire de contact.
 * Envoie le message à support@goodlease.fr via l'API e-mail transactionnel Brevo.
 * Variables d'environnement (dashboard Cloudflare Pages) :
 *   - BREVO_API_KEY    : clé API Brevo (v3)
 *   - CONTACT_TO        : destinataire (défaut: support@goodlease.fr)
 *   - CONTACT_FROM      : expéditeur vérifié dans Brevo (défaut: contact@goodlease.fr)
 *
 * Sans BREVO_API_KEY, l'endpoint répond 200 sans envoyer (mode démo pour tester l'UI).
 */

interface Env {
  BREVO_API_KEY?: string;
  CONTACT_TO?: string;
  CONTACT_FROM?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const esc = (s: string) =>
  s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { name?: string; email?: string; subject?: string; message?: string; company?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (body.company) return json({ ok: true }); // honeypot
  const name = (body.name || '').trim();
  const email = (body.email || '').trim();
  const subject = (body.subject || 'Question générale').trim();
  const message = (body.message || '').trim();

  if (!name || !message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'invalid_fields' }, 422);
  }

  if (!env.BREVO_API_KEY) return json({ ok: true, sent: false });

  const to = env.CONTACT_TO || 'support@goodlease.fr';
  const from = env.CONTACT_FROM || 'contact@goodlease.fr';

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
    body: JSON.stringify({
      sender: { name: 'Site GoodLease', email: from },
      to: [{ email: to }],
      replyTo: { email, name },
      subject: `[Contact] ${subject} — ${name}`,
      htmlContent: `<p><strong>De :</strong> ${esc(name)} (${esc(email)})</p>
<p><strong>Sujet :</strong> ${esc(subject)}</p>
<p><strong>Message :</strong></p>
<p>${esc(message).replace(/\n/g, '<br>')}</p>`,
    }),
  });

  if (!res.ok) return json({ error: 'provider_error' }, 502);
  return json({ ok: true, sent: true });
};
