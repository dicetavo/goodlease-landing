/**
 * Catalogue des catégories d'annonces, aligné sur l'app mobile
 * (lib/utils/lease_categories.dart, libellés français de intl_fr.arb).
 *
 * `id` et `codeRef` forment un contrat gelé avec le backend et les binaires publiés :
 * on ajoute en fin de liste, on ne renumérote, ne renomme ni ne supprime aucune entrée.
 */
export type ListingCategory = {
  id: number;
  /** Clé attendue par le backend à la publication (`coderefCategorie`). */
  codeRef: string;
  label: string;
  /** Libellé historique encore envoyé dans `typeCategorie`. */
  legacyType: string;
  /** Icône de public/webapp-icons. Les sous-catégories s'affichent en texte seul. */
  icon?: string;
  /** Catégorie parente : comme dans l'API, la recherche par le parent inclut ses enfants. */
  parentId?: number;
};

export const listingCategories: readonly ListingCategory[] = [
  { id: 1, codeRef: 'sound', label: 'Son', legacyType: 'Son', icon: 'sound' },
  { id: 2, codeRef: 'light', label: 'Lumière', legacyType: 'Lumieres', icon: 'lights' },
  { id: 3, codeRef: 'struc', label: 'Structures', legacyType: 'Structures', icon: 'structures' },
  { id: 4, codeRef: 'video', label: 'Vidéo', legacyType: 'Video', icon: 'video' },
  // Ne couvre plus que les espaces loués depuis la liste de novembre 2026.
  { id: 5, codeRef: 'place', label: 'Lieux de réception', legacyType: 'Reception', icon: 'reception' },
  { id: 6, codeRef: 'clothe', label: 'Textile', legacyType: 'Textile', icon: 'textile' },
  // Retiré en novembre 2026 : plus proposé, mais toujours résolu pour les annonces existantes.
  { id: 7, codeRef: 'whip', label: 'Transport', legacyType: 'Transport', icon: 'transport' },
  { id: 8, codeRef: 'divers', label: 'Divers', legacyType: 'Divers', icon: 'divers' },
  { id: 9, codeRef: 'furnit', label: 'Mobilier', legacyType: 'Mobilier', icon: 'furniture' },
  { id: 10, codeRef: 'deco', label: 'Décoration', legacyType: 'Decoration', icon: 'decoration' },
  { id: 11, codeRef: 'speaker', label: 'Enceintes', legacyType: 'Enceintes', parentId: 1 },
  { id: 12, codeRef: 'micro', label: 'Micros', legacyType: 'Micros', parentId: 1 },
  { id: 13, codeRef: 'mixer', label: 'Tables de mixage', legacyType: 'Tables de mixage', parentId: 1 },
  { id: 14, codeRef: 'dj', label: 'DJ', legacyType: 'DJ', parentId: 1 },
  { id: 15, codeRef: 'sound_acc', label: 'Accessoires son', legacyType: 'Accessoires son', parentId: 1 },
];

export const listingCategoryNames: Record<number, string> = Object.fromEntries(listingCategories.map((item) => [item.id, item.label]));

export const listingCategoryById = (id: number) => listingCategories.find((category) => category.id === id);

/** Catégories principales proposées dans la barre et à la publication, dans l'ordre de la liste de novembre 2026. */
export const rootListingCategories = [1, 2, 4, 10, 9, 6, 3, 5, 8].map((id) => listingCategoryById(id)!);

export const listingCategoryChildren = (parentId: number) => listingCategories.filter((category) => category.parentId === parentId);

/** Catégorie principale d'une annonce : le parent d'une sous-catégorie, la catégorie elle-même sinon. */
export const rootListingCategoryId = (id: number) => listingCategoryById(id)?.parentId ?? id;

/** 0 (« Tout ») inclut tout ; un parent inclut ses sous-catégories, comme la recherche de l'API. */
export const listingCategoryIncludes = (selectedId: number, listingId: number) =>
  selectedId === 0 || selectedId === listingId || listingCategoryById(listingId)?.parentId === selectedId;
