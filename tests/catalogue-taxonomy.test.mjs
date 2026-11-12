import assert from 'node:assert/strict';
import test from 'node:test';
import { listingCategories, rootListingCategories, listingCategoryIncludes, rootListingCategoryId } from '../src/category-labels.ts';
import { normalizeListingCity } from '../src/listing-location.ts';

test('le catalogue conserve les identifiants et libellés français du mobile', () => {
  assert.deepEqual(listingCategories.map(({ id, label }) => [id, label]), [
    [1, 'Son'], [2, 'Lumières'], [3, 'Structures'], [4, 'Vidéo'], [5, 'Réception'],
    [6, 'Textile'], [7, 'Transport'], [8, 'Divers'], [9, 'Mobilier'],
  ]);
  assert.deepEqual(rootListingCategories.map(({ id }) => id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(rootListingCategoryId(9), 5);
  assert.equal(listingCategoryIncludes(5, 9), true, 'Le cache local Réception doit inclure Mobilier comme l’API');
  assert.equal(listingCategoryIncludes(9, 5), false);
  assert.equal(listingCategoryIncludes(5, 3), false);
  assert.equal(listingCategoryIncludes(0, 9), true);
});

test('la commune est normalisée sans deviner celle du propriétaire', () => {
  for (const value of [undefined, null, 59000, {}, '', '  ', '\t', '1', 'A', 'Paris\u0000']) {
    assert.equal(normalizeListingCity(value), undefined);
  }
  assert.equal(normalizeListingCity('  Villeneuve-d’Ascq  '), 'Villeneuve-d’Ascq');
  assert.equal(normalizeListingCity(' Saint  André lez Lille '), 'Saint André lez Lille');
});
