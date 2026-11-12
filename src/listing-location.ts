/** Shared browser/edge validation; never derive an announcement city from its owner. */
export function normalizeListingCity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const city = value.replace(/\s+/g, ' ').trim();
  return city.length >= 2 && city.length <= 120 && /\p{L}/u.test(city) && !/[\u0000-\u001f\u007f]/.test(city)
    ? city : undefined;
}
