# SPECS — reste à faire (goodlease-landing)

> Nettoyé le **22/07/2026**. Site **en ligne** sur `https://goodlease.fr`, **app iOS publiée**
> (« Good Lease : Location Matériel », App Store, 20/07/2026), Brevo branché (single opt-in),
> SIREN/TVA renseignés, CGS + confidentialité validées avocat. Cette liste = uniquement ce qui
> **reste ouvert**. `CLAUDE.md`/`AGENTS.md` font foi pour l'état courant ; pointeurs fichiers entre `code`.

## 🔴 P1 — Sécurité / hygiène

- [ ] **Supprimer l'ancien token Cloudflare exposé** (`cfut_7vAx…`) → Cloudflare → My Profile → API
      Tokens → Delete. (Le token actif est dans `.cloudflare.env`, gitignored ; invérifiable par API —
      le token actif n'a pas la permission de lister les tokens, testé 22/07/2026 → 403.)
- [ ] **Créer les redirections OVH manquantes** : `rgpd@`, `retractation@` et `signalement@goodlease.fr`
      sont **publiées sur le site mais rebondissent** (vérifié 13/07/2026) → OVH Manager → Emails →
      redirections vers `gregorypounah@gmail.com`. (`contact@`, `support@`, `gregorypounah@` OK.)

## 🟠 P2 — Légal

- [ ] **Relecture avocat** (à l'occasion) : les 2 ajouts de `/confidentialite` hors `.docx` validé
      (section « Transferts hors UE » Stripe/Google + durées 10 ans compta / 5 ans KYC) + l'informer du
      remplacement **FEVAD → CM2C** (le doc validé citait la FEVAD).
- [ ] **S'inscrire réellement chez CM2C** (48 €/3 ans ≤10 salariés + 36 €/dossier) — obligation
      art. L612-1 : le médiateur doit être *souscrit*, pas seulement nommé. CM2C est déjà cité dans
      CGS §18 (`cgs.astro`) et `/resolution-des-litiges` (CM2C, 49 rue de Ponthieu, 75008 Paris, cm2c.net).
- [ ] **Étoffer le contenu** au fil de l'eau : `faq.astro` (vraies questions remontées après lancement),
      `regles-de-contenu.astro`, `securite.astro`. (`cookies.astro` est déjà aligné : aucun traceur actif.)

## 🟡 P3 — Analytics

- [ ] **Plausible** : créer le site sur plausible.io puis renseigner `analytics.plausibleDomain`
      (`'goodlease.fr'`) dans `src/config.ts` → le `<script>` cookieless s'active tout seul
      (`Base.astro`). Cookieless → pas de bandeau requis.
- [ ] **CMP** : seulement **si** un tracking non-cookieless est ajouté un jour (Meta Pixel…) →
      bandeau Accepter/Refuser (CNIL) + brancher `cookies.astro`. Sinon, rien à faire.

## 🟢 P4 — Stores

- [ ] **Badges officiels** Apple / Google à la place des SVG faits main (`StoreBadges.astro`) — chartes
      de marque strictes, obligatoire maintenant que l'app est publiée. Les endpoints Apple ne répondent
      pas en CLI (404) → télécharger à la main sur developer.apple.com/app-store/marketing/guidelines.
- [ ] **Double opt-in Brevo** (optionnel, recommandé) : créer le template de confirmation dans Brevo +
      poser `BREVO_DOI_TEMPLATE_ID` et `BREVO_DOI_REDIRECT_URL` (`https://goodlease.fr/?confirm=1`)
      en **secret_text** → aujourd'hui single opt-in. Cf. en-tête de `functions/api/waitlist.ts`.

## 🔵 P5 — Visuels, SEO, perf (optionnel)

- [ ] **Lighthouse** : mesurer ≥ 95 en prod (les captures sont déjà servies en WebP via `astro:assets`).
- [ ] **OG images** : une seule `og-default.png` (1200×630) ; optionnel : OG dédiées par page clé.
- [ ] **Captures app** : si besoin, recapturer des écrans propres (masters `src/assets/screenshots/`,
      plus de copies dans `public/`) — jamais d'écran profil/portefeuille/transactions/bailleur (PII).

## ⚙️ P6 — Ops (optionnel)

- [ ] **Git auto-deploy** : connecter `dicetavo/goodlease-landing` dans Cloudflare Pages (Connect to
      Git, preset Astro) au lieu du CLI Direct Upload. ⚠ Les env vars sont déjà toutes en
      `secret_text` (wrangler écrase les `plain_text` à chaque deploy) — ne pas les repasser en clair.
- [ ] **DNSSEC** : réactiver côté Cloudflare (vérifié 22/07/2026 : pas de DS chez le parent → toujours
      désactivé depuis la migration des nameservers).

---

Rappels opérationnels (slugs figés par l'app Flutter, MX/SPF OVH intouchables, build flaky, commande de
déploiement) : voir `CLAUDE.md`, qui fait foi.
