# GoodLease — Site public & landing (`goodlease.fr`)

Site statique **Astro 5 + Tailwind**, déployé sur **Cloudflare Pages**. Il sert :

1. la **landing produit** (fidèle au design de l'app Flutter — police Inter, bleu `#1675F3`) ;
2. toutes les **pages légales et d'aide** vers lesquelles l'app GoodLease redirige
   (`openGoodleasePage` dans `lib/utils/web_links.dart`).

## Développement

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # génère dist/
npm run preview    # sert dist/ localement
```

## Pages (les slugs matchent l'app Flutter — ne pas les renommer)

| URL | Contenu | Lié depuis l'app |
|---|---|---|
| `/` | Landing (hero + waitlist, comment ça marche, loueurs, locataires, sécurité, captures) | — |
| `/contact` | Formulaire de contact + coordonnées support | ✅ |
| `/faq` | Questions fréquentes (accordéons) | ✅ |
| `/securite` | Sécurité du bail | ✅ |
| `/resolution-des-litiges` | Médiation FEVAD, CEC (pas d'ODR) | ✅ |
| `/confidentialite` | Politique de confidentialité (RGPD) | ✅ |
| `/mentions-legales` | Mentions légales | ✅ |
| `/regles-de-contenu` | Règles de contenu / DSA | ✅ |
| `/supprimer-mon-compte` | Suppression de compte (exigence Apple 5.1.1.v) | ✅ |
| `/cgs` | Conditions générales de service | footer |
| `/cookies` | Préférences cookies | footer |

> Les slugs proviennent de `web_links.dart` et **font foi** (ils diffèrent volontairement du
> brief initial). Si l'app ajoute un lien, ajouter la page correspondante ici.

## Formulaires (waitlist + contact)

Les formulaires postent vers des **Cloudflare Pages Functions** (`functions/api/waitlist.ts`,
`functions/api/contact.ts`) qui relaient vers **Brevo** en gardant la clé API côté serveur.
Tant que les variables d'env ne sont pas définies, les endpoints répondent `200` sans rien
envoyer (mode démo — l'UI fonctionne). Variables à définir dans Cloudflare Pages
(*Settings → Environment variables*) :

- `BREVO_API_KEY` — clé API Brevo v3
- `BREVO_WAITLIST_LIST_ID` — id de la liste waitlist
- `BREVO_NEWSLETTER_LIST_ID` *(optionnel)* — id de la liste newsletter
- `CONTACT_TO` *(défaut `support@goodlease.fr`)*, `CONTACT_FROM` *(défaut `contact@goodlease.fr`)*

## Déploiement — Cloudflare Pages

### Voie A — Git natif (recommandée)

1. Pousser ce repo sur GitHub (`dicetavo/goodlease-landing`).
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build command : `npm run build` · Output directory : `dist`.
4. Chaque push sur `main` déploie ; chaque PR génère une preview.

### Voie B — CLI / GitHub Actions

```bash
npm run build
npx wrangler pages deploy dist        # nécessite `wrangler login`
```

### Domaine & DNS

- Dans le projet Pages : **Custom domains → Add** `goodlease.fr` puis `www.goodlease.fr`.
- DNS du domaine chez **OVH** : soit déléguer les *nameservers* à Cloudflare (active le CDN/proxy),
  soit garder OVH et créer un `CNAME` vers `<projet>.pages.dev` (Cloudflare gère le certificat SSL).
- **Les e-mails restent gérés par OVH** même si le DNS passe sur Cloudflare (conserver les
  enregistrements MX/SPF/DKIM/DMARC OVH).

## Analytics

Mesure d'audience cookieless **Plausible** : décommenter la balise `<script>` dans
`src/layouts/Base.astro` une fois le compte créé. Cookieless ⇒ pas de bandeau de consentement
bloquant requis.

## À compléter (actions hors-code)

- [ ] Créer les e-mails OVH : `contact@`, `support@`, `rgpd@`, `retractation@`, `signalement@`, `hello@`.
- [ ] SPF / DKIM / DMARC pour la délivrabilité.
- [ ] Mentions légales : renseigner **SIREN + TVA** dès réception du Kbis (`src/config.ts`).
- [ ] Validation finale **CGS** + **Politique de confidentialité** par l'avocat.
- [ ] Confirmer l'**adhésion FEVAD** avant d'afficher la clause de médiation.
- [ ] Remplacer le formulaire waitlist par les **badges App Store / Google Play** au lancement.
- [ ] Remplacer les captures d'écran placeholder par les vraies captures (`src/assets/screenshots/`).

## Design

Tokens repris de l'app Flutter dans `tailwind.config.mjs` (couleurs, rayons, ombres) et
`src/styles/global.css`. Logo : `public/mark.svg` (glyphe « G » extrait de la charte) + wordmark
Inter dans `src/components/Logo.astro`.
