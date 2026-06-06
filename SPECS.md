# SPECS — reste à finir (goodlease-landing)

> Site **en ligne** sur `https://goodlease.fr` (HTTPS, www→apex, e-mail OVH intact). Cette liste = ce qui
> reste pour passer de "en ligne" à "prêt pour le lancement". Items **app Flutter** = dans le repo
> `../good-lease`, pas ici. Cocher au fur et à mesure. Pointeurs fichiers entre `code`.

## 🔴 P1 — Bloquants / sécurité

- [ ] **Supprimer l'ancien token Cloudflare exposé** (`cfut_7vAx…`) → Cloudflare → My Profile → API Tokens
      → Delete. (Le token actif est dans `.cloudflare.env`, gitignored.)
- [ ] **Brancher Brevo** (formulaires waitlist + contact, aujourd'hui en *mode démo*) :
  - Créer le compte Brevo + une **liste waitlist** (+ liste newsletter optionnelle).
  - Cloudflare Pages → projet `goodlease-landing` → Settings → Environment variables :
    `BREVO_API_KEY`, `BREVO_WAITLIST_LIST_ID`, `BREVO_NEWSLETTER_LIST_ID`, `CONTACT_TO` (défaut
    `support@goodlease.fr`), `CONTACT_FROM` (défaut `contact@goodlease.fr`).
  - Tester end-to-end : `functions/api/waitlist.ts`, `functions/api/contact.ts`. Viser le **double opt-in**.
  - ⚠ Les Pages Functions ne tournent **pas** en `npm run dev` → tester sur la prod (ou `wrangler pages dev dist`).
- [ ] **Créer les 6 adresses e-mail OVH** : `contact@`, `support@`, `rgpd@`, `retractation@`,
      `signalement@`, `hello@` (`src/config.ts` → `emails`). Ajouter **DMARC** (et DKIM si dispo OVH) —
      seuls MX + SPF existent aujourd'hui.

## 🟠 P2 — Contenu légal (dépend d'externes)

- [ ] **Mentions légales** : renseigner **SIREN + N° TVA** dès réception du **Kbis** → `company.siren` /
      `company.tva` dans `src/config.ts` (actuellement `[À COMPLÉTER]`). Idem `company.phone`.
- [ ] **CGS + Confidentialité** : **validation finale avocat** → retirer le `draftNote` dans
      `src/pages/cgs.astro` et `src/pages/confidentialite.astro` une fois validées.
- [ ] **FEVAD** : confirmer l'adhésion avant d'activer la clause de médiation (retirer le `draftNote` de
      `src/pages/resolution-des-litiges.astro`).
- [x] **Contenu étoffé** : `faq.astro` (22 Q + données structurées FAQPage), `securite.astro` (conseils,
      responsabilité/assurance, vie privée), `regles-de-contenu.astro` (comptes & identité, propriété
      intellectuelle), `cookies.astro` aligné sur **Plausible**. Reste à intégrer les **vraies questions
      remontées** par les premiers utilisateurs une fois l'app en service.

## 🟡 P3 — Analytics & conformité cookies

- [ ] **Plausible** : créer le site, décommenter le `<script>` dans `src/layouts/Base.astro`
      (`data-domain="goodlease.fr"`). Cookieless → **pas de bandeau** requis.
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
- [x] **Perf** : captures converties en **WebP** (servies via `<picture>` dans `PhoneMockup.astro`,
      fallback PNG conservé) — ~440 Ko → ~57 Ko etc. L'icône en page passe de `icon-1024.png` (838 Ko)
      à `icon-192` (5 Ko). Reste : mesurer Lighthouse réel, viser **≥ 95** (perf/SEO/a11y).
- [x] **Favicon set** : `favicon.ico` (16+32) + `favicon-16/32/512.png` + `apple-touch-icon` (180)
      régénérés depuis `icon-1024.png`, référencés dans `Base.astro`.
- [ ] **OG images** : une seule `og-default.png` (1200×630). Optionnel : OG dédiées par page clé.
- [x] **SEO** : `sitemap-0.xml` couvre bien les **11 pages**, `robots.txt` OK (pointe le sitemap-index),
      données structurées `Organization` + `MobileApplication` présentes (`Base.astro`, `homeSchema`).

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
