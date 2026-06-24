# SPECS — reste à finir (goodlease-landing)

> Site **en ligne** sur `https://goodlease.fr` (HTTPS, www→apex, e-mail OVH intact). Cette liste = ce qui
> reste pour passer de "en ligne" à "prêt pour le lancement". Items **app Flutter** = dans le repo
> `../good-lease`, pas ici. Cocher au fur et à mesure. Pointeurs fichiers entre `code`.

## 🔴 P1 — Bloquants / sécurité

- [ ] **Supprimer l'ancien token Cloudflare exposé** (`cfut_7vAx…`) → Cloudflare → My Profile → API Tokens
      → Delete. (Le token actif est dans `.cloudflare.env`, gitignored.)
- [ ] **Brancher Brevo** (formulaires waitlist + contact, aujourd'hui en *mode démo*) — _code prêt
      (double opt-in câblé), reste la config dashboard_ :
  - Créer le compte Brevo + une **liste waitlist** (+ liste newsletter optionnelle).
  - Pour le **double opt-in** : créer un **template d'e-mail de confirmation** dans Brevo et noter son id.
  - Cloudflare Pages → projet `goodlease-landing` → Settings → Environment variables :
    `BREVO_API_KEY`, `BREVO_WAITLIST_LIST_ID`, `BREVO_NEWSLETTER_LIST_ID`, `CONTACT_TO` (défaut
    `support@goodlease.fr`), `CONTACT_FROM` (défaut `contact@goodlease.fr`).
    - **Double opt-in** (recommandé) : ajouter `BREVO_DOI_TEMPLATE_ID` (id du template de confirmation)
      et `BREVO_DOI_REDIRECT_URL` (ex. `https://goodlease.fr/?confirm=1`). Sans ces 2 vars → repli
      single opt-in (ajout direct à la liste). Cf. en-tête de `functions/api/waitlist.ts`.
  - Tester end-to-end : `functions/api/waitlist.ts`, `functions/api/contact.ts`.
  - ⚠ Les Pages Functions ne tournent **pas** en `npm run dev` → tester sur la prod (ou `wrangler pages dev dist`).
- [ ] **Créer les 6 adresses e-mail OVH** : `contact@`, `support@`, `rgpd@`, `retractation@`,
      `signalement@`, `hello@` (`src/config.ts` → `emails`). Ajouter **DMARC** (et DKIM si dispo OVH) —
      seuls MX + SPF existent aujourd'hui.

## 🟠 P2 — Contenu légal (dépend d'externes)

- [ ] **Mentions légales** : renseigner **SIREN + N° TVA** dès réception du **Kbis** → `company.siren` /
      `company.tva` dans `src/config.ts` (actuellement `[À COMPLÉTER]`). Idem `company.phone`.
- [x] **CGS + Confidentialité** : validées (avocat) → `draftNote` retirés + date « 18 juin 2026 »
      (`cgs.astro`, `confidentialite.astro`). ⚠ À refaire relire à l'avocat à l'occasion : la confidentialité
      garde 2 ajouts hors `.docx` (section « Transferts hors UE » Stripe/Google + durées 10 ans compta /
      5 ans KYC).
- [ ] **Médiateur — CM2C** : FEVAD (trop cher) remplacé par **CM2C** — 48 €/3 ans (≤10 salariés) + 36 €/dossier.
      Nommé dans CGS §18, `resolution-des-litiges.astro`, carte home (coordonnées : CM2C, 49 rue de Ponthieu,
      75008 Paris, cm2c.net). Reste à **s'inscrire chez CM2C avant lancement** (obligation art. L612-1 :
      médiateur auquel on a réellement souscrit) + **informer l'avocat** (le doc validé citait FEVAD).
- [ ] **Contenu à étoffer** (placeholders de départ) : `faq.astro` (vraies questions remontées),
      `regles-de-contenu.astro`, `securite.astro`. Aligner `cookies.astro` avec l'analytics réellement posé.

## 🟡 P3 — Analytics & conformité cookies

- [ ] **Plausible** : créer le site sur plausible.io, puis renseigner `analytics.plausibleDomain`
      (`'goodlease.fr'`) dans `src/config.ts` → le `<script>` cookieless s'active tout seul (toggle déjà
      câblé dans `src/layouts/Base.astro`). Cookieless → **pas de bandeau** requis.
- [ ] **CMP** : seulement **si** on ajoute du tracking non-cookieless (Meta Pixel, etc.) → implémenter un
      bandeau Accepter / Refuser / Personnaliser (CNIL : refus aussi simple qu'accepter) + brancher
      `cookies.astro` dessus. Sinon, rien à faire.

## 🟢 P4 — Lancement stores

- [ ] Remplacer les badges **SVG faits main** par les **assets officiels** Apple / Google
      (`src/components/StoreBadges.astro`) — chartes de marque strictes.
- [ ] Renseigner `stores.appStore` / `stores.playStore` (`src/config.ts`) dès publication → les badges
      deviennent cliquables et le label « Bientôt disponible » disparaît automatiquement.
- [ ] Décider : garder le formulaire waitlist ou basculer 100 % badges au lancement (`src/pages/index.astro`).

## 🔵 P5 — Visuels, SEO, perf

- [ ] **Captures** : la galerie a 4 vraies captures (`public/screenshots/`). Optionnel : recapturer une
      **home propre** (sans l'annonce "laptop" de test) + ajouter 1-2 écrans (sans PII : pas d'écran
      profil/portefeuille/transactions/bailleur qui exposent des e-mails). Masters : `src/assets/screenshots/`.
- [x] **Perf** : captures servies en **WebP** via `astro:assets` (1,4 Mo → ~55 Ko, `width/height`
      posés contre le CLS). `PhoneMockup` prend une prop `image`, masters importés dans `index.astro`.
      _(Reste à mesurer Lighthouse ≥ 95 en prod.)_
- [x] **Favicon set** : `favicon.ico` (16/32/48 PNG-embedded, 6 Ko) + `favicon.svg` + `favicon-16/32.png`
      + `apple-touch-icon` (180) + `icon-192/512.png` + `site.webmanifest`, tous référencés dans `Base.astro`.
- [ ] **OG images** : une seule `og-default.png` (1200×630). Optionnel : OG dédiées par page clé.
- [x] **SEO** : `sitemap-index.xml` couvre les **11 pages** (vérifié au build), `robots.txt` OK,
      schema `Organization` + `MobileApplication` (`Base.astro`). **Ajouté** : JSON-LD `FAQPage` sur
      `/faq` (12 Q/R) pour les rich results Google.

## ⚙️ P6 — Ops (optionnel)

- [ ] **Git auto-deploy** : connecter `dicetavo/goodlease-landing` dans Cloudflare Pages (Connect to Git,
      preset Astro) pour déployer à chaque `git push` au lieu du CLI Direct Upload.
- [ ] **DNSSEC** : réactiver côté Cloudflare (désactivé pendant la migration des nameservers).
- [ ] Penser à mettre à jour `CLAUDE.md` si l'archi change.

---

### Rappels (cf. `CLAUDE.md`)
- Les **slugs** doivent rester alignés sur `../good-lease/lib/utils/web_links.dart` (renommer = casser un
  lien de l'app en prod).
- **Ne jamais** proxy/supprimer les enregistrements **MX (`mx*.mail.ovh.net`) + SPF** → casserait l'e-mail OVH.
- Build parfois **flaky** (crash natif non-déterministe) → relancer `npm run build`.
- Déploiement : `set -a; . ./.cloudflare.env; set +a && npx wrangler pages deploy dist --project-name=goodlease-landing --branch=main --commit-dirty=true`
