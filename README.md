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
npm test           # build + tests des routes Cloudflare, du proxy et du consentement
```

## Pages (les slugs matchent l'app Flutter — ne pas les renommer)

| URL | Contenu | Lié depuis l'app |
|---|---|---|
| `/` | Landing (hero + waitlist, comment ça marche, loueurs, locataires, sécurité, captures) | — |
| `/contact` | Formulaire de contact + coordonnées support | ✅ |
| `/faq` | Questions fréquentes (accordéons) | ✅ |
| `/securite` | Sécurité du bail | ✅ |
| `/resolution-des-litiges` | Médiation CM2C, CEC (pas d'ODR) | ✅ |
| `/confidentialite` | Politique de confidentialité (RGPD) | ✅ |
| `/mentions-legales` | Mentions légales | ✅ |
| `/regles-de-contenu` | Règles de contenu / DSA | ✅ |
| `/supprimer-mon-compte` | Suppression de compte (exigence Apple 5.1.1.v) | ✅ |
| `/cgs` | Conditions générales de service | footer |
| `/cookies` | Préférences cookies | footer |
| `/a-propos/` | Entreprise, services et catalogue actuel | footer |
| `/louer-son-materiel/` | Mise en location pour les propriétaires | footer |

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
- Le DNS est géré par **Cloudflare** ; les domaines `goodlease.fr` et `www.goodlease.fr` sont
  associés au projet Pages. La redirection de `www` vers le domaine principal est une règle Cloudflare.
- **Les e-mails restent gérés par OVH** même si le DNS passe sur Cloudflare (conserver les
  enregistrements MX/SPF/DKIM/DMARC OVH).

## Analytics

Les fournisseurs marketing sont désactivés tant que leurs identifiants sont vides. Copier
`.env.example` dans `.env`, renseigner les identifiants publics nécessaires, puis reconstruire.
Pour Direct Upload, ces valeurs doivent être présentes **pendant le build local** ; les définir
uniquement dans le dashboard Pages ne modifie pas les fichiers JavaScript déjà construits.

- `PUBLIC_GTM_ID` : conteneur Google Tag Manager. Il prend la priorité sur les intégrations directes.
- `PUBLIC_GA4_ID` et `PUBLIC_META_PIXEL_ID` : intégrations directes en l'absence de GTM.
- Plausible reste configurable par `analytics.plausibleDomain` dans `src/config.ts`.

Le bandeau propose Accepter, Refuser et Personnaliser avec la même présentation, conserve les
choix six mois et permet leur modification sur `/cookies/`. Les quatre consentements Google
Consent Mode v2 sont initialement refusés. Aucun script Google/Meta n'est chargé avant accord.
La solution locale de consentement n'est pas une CMP certifiée Google/TCF ; une CMP commerciale
peut être intégrée après choix du fournisseur et de son compte.

**GTM** : avant activation, configurer et vérifier les contrôles de consentement de chaque tag,
les déclencheurs et l'absence de doublon GA4. Par prudence, le conteneur actuel n'est chargé que
si les deux finalités sont acceptées. Avec les intégrations directes, les finalités sont
indépendantes. Pour GA4 via GTM, utiliser les variables de couche de données `page_location`
et `page_referrer`, limiter la durée du cookie à 13 mois et désactiver son renouvellement.
Avec Meta, désactiver les événements automatiques et le rapprochement automatique des données
de formulaires dans le compte. Les clés secrètes serveur ne doivent jamais porter `PUBLIC_`.

Événements branchés : `view_item`, `search`, `sign_up` après activation du compte par e-mail,
`listing_published` après confirmation de la disponibilité, `app_store_click` et
`booking_app_handoff`. Ils ne contiennent aucun DTO de compte, champ de formulaire, message,
adresse précise ou GPS. Les recherches sont mesurées par filtres/indicateurs sans transmettre
le texte saisi. Les UTM utiles sont conservés et les paramètres d'URL arbitraires sont exclus.

Le retour d'Achour du 10 octobre confirme 21 lignes dans le plan app/backend, dont une mesure
d'abandon à calculer, et 10 propositions séparées. Le dictionnaire local est dans
`docs/TRACKING_PLAN.json`. Les événements web restent un périmètre distinct : `platform=web`,
et `destination_platform` indique le store ciblé. Meta utilise `PageView`, `ViewContent` et
`CompleteRegistration` pour ces actions réelles, les autres événements restant personnalisés.
La réception visible de chaque événement doit être vérifiée séparément de son installation.

Les conversions financières viennent du backend, sur confirmation du paiement réel ; le site
ne déclare aucune conversion payée sur un simple clic. Firebase Analytics est intégré à la version
mobile 1.0.9 sous consentement facultatif. Le backend GA4 Measurement Protocol est déployé en dev
et prod avec trois flux (iOS, Android, web), secrets dans Secret Manager, signature Stripe vérifiée
et déduplication transactionnelle. Un ajout réel au panier dev a passé le validateur strict Google.
La disponibilité du nouveau binaire et la réception des conversions complètes restent à vérifier.
Meta CAPI et les SDK publicitaires mobiles ne sont pas activés.

Références : [Consent Mode Google](https://developers.google.com/tag-platform/security/guides/consent)
et [règles de consentement CNIL](https://www.cnil.fr/fr/cookies-et-autres-traceurs/que-dit-la-loi).

## Catalogue public et SEO

Les **Pages Functions** rendent les annonces, catégories et villes dans le HTML serveur.
`npm run dev` et `npm run preview` ne font pas tourner ces fonctions. Pour les vérifier localement :

```bash
npm run build
npx wrangler pages dev dist --port 8788
```

- `/catalogue` : hub des catégories et des zones.
- `/location-{categorie}` : sélection par catégorie, texte éditorial et FAQ visible/structurée.
- `/location-{categorie}/{ville}` et `/location-materiel/{ville}` : sélections par communes.
- `/location-materiel-mariage` : catégories adaptées à une réception de mariage.
- `/materiel/{titre-ville-id}` : URL descriptive pour l'indexation. Les anciens titres redirigent.
- `/annonce/{id}` : partage mobile stable, toujours accessible ; canonical vers la fiche descriptive.

Les catégories de l'API gardent leurs identifiants. Les anciens slugs `structures`, `reception`
et `textile` redirigent vers `tentes-barnums`, `decoration` et `nappes-linge-de-table`.
La sélection vaisselle utilise les annonces de réception qui mentionnent ces équipements ;
elle ne crée pas de nouvelle catégorie dans l'API.

Les zones et leurs communes sont définies dans `src/server/catalogue-content.ts`.
Elles ne représentent pas un rayon de 15 km. Les sélections de moins de trois annonces
restent consultables en `noindex` et sont exclues du sitemap. Le catalogue global reste indexable.
`sitemap-catalogue.xml` contient les fiches descriptives et les sélections indexables ;
`lastmod` n'est ajouté que lorsque l'API fournit une date de modification fiable pour la sélection.
L'API réelle expose actuellement `createdAt` mais pas encore `updatedAt`/`lastModifiedAt`.

Les photos du bucket public GoodLease sont servies sous `/images/catalogue/uploads/…` et mises
en cache à l'edge. Le proxy autorise uniquement ce bucket, les formats d'image prévus et 20 Mo
par fichier. Les originaux restent dans S3 ; ce cache ne remplace pas une migration ni un
redimensionnement des images en amont.

Les liens internes statiques utilisent le slash final ; les pages dynamiques le retirent par 301.
Le 404 générique est en `noindex` sans canonical, et `/app` conserve son `noindex`.
`/llms.txt` fournit des références sur le service ; il ne garantit pas une visibilité dans les moteurs IA.
La balise Search Console existante est conservée. La soumission du sitemap et le réglage
Cloudflare AI Crawl Control restent à vérifier dans les comptes administrateurs.

## À compléter (actions hors-code)

- [ ] Choisir et activer les fournisseurs marketing, puis valider les conversions réelles.
- [ ] Vérifier la soumission du sitemap à Search Console et Bing, et les règles de crawl Cloudflare.
- [ ] Faire relire les ajouts à la confidentialité postérieurs à la validation de juin 2026.
- [ ] Finaliser l'adhésion à **CM2C**, médiateur déjà nommé dans les conditions générales.
- [ ] Recouper la clé de TVA avec le mémento fiscal à réception.

## Design

Tokens repris de l'app Flutter dans `tailwind.config.mjs` (couleurs, rayons, ombres) et
`src/styles/global.css`. Logo : `public/mark.svg` (glyphe « G » extrait de la charte) + wordmark
Inter dans `src/components/Logo.astro`.
