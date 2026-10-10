// Données centrales du site goodlease.fr — réutilisées par le layout, le header et le footer.

export const site = {
  name: 'GoodLease',
  domain: 'goodlease.fr',
  url: 'https://goodlease.fr',
  tagline: 'Louez du matériel pour vos événements',
  description:
    'Louez sono, éclairage, tentes, mobilier et décoration près de chez vous, entre particuliers et pros. Paiement sécurisé et dépôt de garantie protégé.',
};

// Mesure d'audience. Vide = désactivée (aucun script chargé). Renseigner le domaine
// déclaré sur plausible.io pour activer le tracking cookieless (pas de bandeau requis).
export const analytics = {
  plausibleDomain: '',
  // Identifiants publics. Sans identifiant, aucun outil marketing ni bandeau n'est chargé.
  gtmId: import.meta.env?.PUBLIC_GTM_ID || '',
  ga4Id: import.meta.env?.PUBLIC_GA4_ID || '',
  metaPixelId: import.meta.env?.PUBLIC_META_PIXEL_ID || '',
  consentVersion: '2026-10-08',
};

// Identifiants publics nécessaires aux fournisseurs de connexion web.
export const auth = {
  googleClientId: '1015997562913-av22cljjqgrj0uph774q8nkobjic1c9n.apps.googleusercontent.com',
};

// Liens vers les fiches stores. Vide = badge « Bientôt disponible » (non cliquable).
// App Store : « Good Lease : Location Matériel », publiée le 20/07/2026.
// Google Play : publiée le 24/07/2026.
export const stores = {
  appStore: 'https://apps.apple.com/fr/app/good-lease-location-mat%C3%A9riel/id6758953661',
  playStore: 'https://play.google.com/store/apps/details?id=com.goodlease.app',
};

// Adresses e-mail — cf. brief §10.
// contact@ redirige via OVH vers Gmail ; support@ est une boîte OVH Email Pro.
// rgpd@ / retractation@ / signalement@ n'ont jamais été créées côté OVH et
// rebondissaient en 550 « User unknown » : elles pointent donc sur contact@.
export const emails = {
  contact: 'contact@goodlease.fr',
  support: 'support@goodlease.fr',
  rgpd: 'contact@goodlease.fr',
  retractation: 'contact@goodlease.fr',
  signalement: 'contact@goodlease.fr',
};

// Identité de l'éditeur — cf. brief §4.2 (mentions légales)
export const company = {
  legalName: 'GOODLEASE',
  form: 'Société par actions simplifiée au capital de 1 000 €',
  address: '10 Rue de Jemmapes, 59155 Faches-Thumesnil, France',
  postalAddress: {
    streetAddress: '10 Rue de Jemmapes', postalCode: '59155',
    addressLocality: 'Faches-Thumesnil', addressCountry: 'FR',
  },
  rcs: 'RCS Lille Métropole',
  siren: '106 617 467',
  tva: 'FR54 106 617 467',
  president: 'Yacine Kalbez',
  dg: 'Gregory Pounah',
  publicationDirector: 'Gregory Pounah',
  phone: '', // vide = ligne « Téléphone » masquée sur le site ; renseigner pour l'afficher
};

// Slugs canoniques — ils DOIVENT matcher lib/utils/web_links.dart de l'app Flutter.
export const routes = {
  home: '/',
  app: '/app',
  contact: '/contact',
  faq: '/faq',
  safety: '/securite',
  disputes: '/resolution-des-litiges',
  privacy: '/confidentialite',
  legal: '/mentions-legales',
  contentRules: '/regles-de-contenu',
  deleteAccount: '/supprimer-mon-compte',
  // Pages additionnelles (référencées dans le footer / la CMP, pas par l'app)
  terms: '/cgs',
  cookies: '/cookies',
  about: '/a-propos',
  lenders: '/louer-son-materiel',
};

/** Les slugs partagés avec Flutter restent stables ; les liens HTML évitent la redirection Pages. */
export const pageHref = (path: string) => path === '/' ? path : `${path.replace(/\/$/, '')}/`;

export const mainNav = [
  { label: 'Explorer', href: pageHref(routes.app) },
  { label: 'Pour vos événements', href: '/#evenements' },
  { label: 'Le parcours', href: '/#parcours' },
  { label: 'Pour les loueurs', href: '/#loueurs' },
  { label: 'Aide', href: pageHref(routes.faq) },
];

export const footerNav = [
  {
    title: 'Produit',
    links: [
      { label: 'Ouvrir l’application web', href: pageHref(routes.app) },
      { label: 'Catalogue par catégorie et ville', href: '/catalogue' },
      { label: 'Louer son matériel', href: pageHref(routes.lenders) },
      { label: 'À propos de GoodLease', href: pageHref(routes.about) },
      { label: 'Comment ça marche', href: '/#comment-ca-marche' },
      { label: 'Parcours complet', href: '/#parcours' },
      { label: 'Télécharger l’app', href: '/#telecharger' },
    ],
  },
  {
    title: 'Aide',
    links: [
      { label: 'Contacter le service client', href: pageHref(routes.contact) },
      { label: 'FAQ', href: pageHref(routes.faq) },
      { label: 'Sécurité du bail', href: pageHref(routes.safety) },
      { label: 'Résolution des litiges', href: pageHref(routes.disputes) },
    ],
  },
  {
    title: 'Légal',
    links: [
      { label: 'Mentions légales', href: pageHref(routes.legal) },
      { label: 'Politique de confidentialité', href: pageHref(routes.privacy) },
      { label: 'Conditions générales de service', href: pageHref(routes.terms) },
      { label: 'Règles de contenu', href: pageHref(routes.contentRules) },
      { label: 'Gestion des cookies', href: pageHref(routes.cookies) },
    ],
  },
];
