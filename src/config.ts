// Données centrales du site goodlease.fr — réutilisées par le layout, le header et le footer.

export const site = {
  name: 'GoodLease',
  domain: 'goodlease.fr',
  url: 'https://goodlease.fr',
  tagline: 'Équipez vos évènements en un clic',
  description:
    "GoodLease, la marketplace de location de matériel entre particuliers et avec des pros. Louez ce dont vous avez besoin, rentabilisez ce que vous possédez. Paiement sécurisé, dépôt de garantie et bail protégé.",
};

// Mesure d'audience. Vide = désactivée (aucun script chargé). Renseigner le domaine
// déclaré sur plausible.io pour activer le tracking cookieless (pas de bandeau requis).
export const analytics = {
  plausibleDomain: '',
};

// Liens vers les fiches stores. Vides tant que l'app n'est pas publiée
// → les badges s'affichent en mode « Bientôt disponible » (non cliquables).
// Renseigner dès la mise en ligne sur l'App Store / Google Play.
export const stores = {
  appStore: '',
  playStore: '',
};

// Adresses e-mail (à créer côté OVH — cf. brief §10)
export const emails = {
  contact: 'contact@goodlease.fr',
  support: 'support@goodlease.fr',
  rgpd: 'rgpd@goodlease.fr',
  retractation: 'retractation@goodlease.fr',
  signalement: 'signalement@goodlease.fr',
};

// Identité de l'éditeur — cf. brief §4.2 (mentions légales)
export const company = {
  legalName: 'GOODLEASE',
  form: 'Société par actions simplifiée au capital de 1 000 €',
  address: '10 Rue de Jemmapes, 59155 Faches-Thumesnil, France',
  rcs: 'RCS Lille Métropole',
  siren: '[À COMPLÉTER dès réception du Kbis]',
  tva: '[À COMPLÉTER dès réception du Kbis]',
  registrationNote: 'Société en cours d’immatriculation au Registre du Commerce et des Sociétés.',
  president: 'Yacine Kalbez',
  dg: 'Gregory Pounah',
  publicationDirector: 'Gregory Pounah',
  phone: '[À COMPLÉTER]',
};

// Slugs canoniques — ils DOIVENT matcher lib/utils/web_links.dart de l'app Flutter.
export const routes = {
  home: '/',
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
};

export const mainNav = [
  { label: 'Pour vos événements', href: '/#evenements' },
  { label: 'Comment ça marche', href: '/#comment-ca-marche' },
  { label: 'Pour les loueurs', href: '/#loueurs' },
  { label: 'Aide', href: routes.faq },
];

export const footerNav = [
  {
    title: 'Produit',
    links: [
      { label: 'Comment ça marche', href: '/#comment-ca-marche' },
      { label: 'Télécharger l’app', href: '/#telecharger' },
    ],
  },
  {
    title: 'Aide',
    links: [
      { label: 'Contacter le service client', href: routes.contact },
      { label: 'FAQ', href: routes.faq },
      { label: 'Sécurité du bail', href: routes.safety },
      { label: 'Résolution des litiges', href: routes.disputes },
    ],
  },
  {
    title: 'Légal',
    links: [
      { label: 'Mentions légales', href: routes.legal },
      { label: 'Politique de confidentialité', href: routes.privacy },
      { label: 'Conditions générales de service', href: routes.terms },
      { label: 'Règles de contenu', href: routes.contentRules },
      { label: 'Gestion des cookies', href: routes.cookies },
    ],
  },
];
