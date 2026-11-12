/** French mobile labels (lease_category_labels.dart / intl_fr.arb); keep API IDs stable. */
export const listingCategories = [
  { id: 1, label: 'Son', icon: 'sound' },
  { id: 2, label: 'Lumières', icon: 'lights' },
  { id: 3, label: 'Structures', icon: 'structures' },
  { id: 4, label: 'Vidéo', icon: 'video' },
  { id: 5, label: 'Réception', icon: 'reception' },
  { id: 6, label: 'Textile', icon: 'textile' },
  { id: 7, label: 'Transport', icon: 'transport' },
  { id: 8, label: 'Divers', icon: 'divers' },
  { id: 9, label: 'Mobilier', icon: 'furniture' },
] as const;

export const listingCategoryNames: Record<number, string> = Object.fromEntries(listingCategories.map((item) => [item.id, item.label]));
export const rootListingCategories = listingCategories.filter((item) => item.id !== 9);

/** Mobilier remains a child of Réception, as in the mobile catalogue and API. */
export const rootListingCategoryId = (id: number) => id === 9 ? 5 : id;
export const listingCategoryIncludes = (selectedId: number, listingId: number) =>
  selectedId === 0 || selectedId === listingId || (selectedId === 5 && listingId === 9);
