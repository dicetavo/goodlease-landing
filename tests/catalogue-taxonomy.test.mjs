import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'parse5';
import {
  listingCategories, listingCategoryChildren, listingCategoryIncludes, listingCategoryNames, rootListingCategories, rootListingCategoryId,
} from '../src/category-labels.ts';
import { normalizeListingCity } from '../src/listing-location.ts';

const elements = (node) => [node, ...(node.childNodes || []).flatMap(elements)];
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const text = (node) => node.value || (node.childNodes || []).map(text).join('');

test('le catalogue conserve les identifiants, codes et libellés français du mobile', () => {
  assert.deepEqual(listingCategories.map(({ id, codeRef, label }) => [id, codeRef, label]), [
    [1, 'sound', 'Son'], [2, 'light', 'Lumière'], [3, 'struc', 'Structures'], [4, 'video', 'Vidéo'],
    [5, 'place', 'Lieux de réception'], [6, 'clothe', 'Textile'], [7, 'whip', 'Transport'], [8, 'divers', 'Divers'],
    [9, 'furnit', 'Mobilier'], [10, 'deco', 'Décoration'], [11, 'speaker', 'Enceintes'], [12, 'micro', 'Micros'],
    [13, 'mixer', 'Tables de mixage'], [14, 'dj', 'DJ'], [15, 'sound_acc', 'Accessoires son'],
  ]);
  assert.deepEqual(rootListingCategories.map(({ id }) => id), [1, 2, 4, 10, 9, 6, 3, 5, 8]);
  assert.equal(listingCategoryNames[7], 'Transport', 'Transport n’est plus proposé, mais les annonces existantes gardent leur libellé');
  assert.deepEqual(listingCategoryChildren(1).map(({ id }) => id), [11, 12, 13, 14, 15]);
  assert.deepEqual(listingCategoryChildren(5), []);
});

test('une catégorie principale inclut ses sous-catégories, comme la recherche de l’API', () => {
  for (const child of [11, 12, 13, 14, 15]) {
    assert.equal(rootListingCategoryId(child), 1);
    assert.equal(listingCategoryIncludes(1, child), true, `Son doit inclure la sous-catégorie ${child}`);
    assert.equal(listingCategoryIncludes(child, 1), false);
  }
  assert.equal(rootListingCategoryId(9), 9, 'Mobilier est redevenu une catégorie principale');
  assert.equal(rootListingCategoryId(0), 0);
  assert.equal(listingCategoryIncludes(5, 9), false, 'Les lieux de réception n’incluent plus le mobilier');
  assert.equal(listingCategoryIncludes(11, 12), false);
  assert.equal(listingCategoryIncludes(0, 15), true);
});

test('la barre, les sous-catégories et le formulaire de /app suivent la liste de novembre 2026', async () => {
  const nodes = elements(parse(await readFile('dist/app/index.html', 'utf8')));
  const classes = (node) => (attr(node, 'class') || '').split(/\s+/);
  const chips = (container, className) => elements(container)
    .filter((node) => node.tagName === 'button' && classes(node).includes(className) && attr(node, 'data-category-id'))
    .map((button) => [Number(attr(button, 'data-category-id')), text(button)]);
  assert.deepEqual(chips(nodes[0], 'category-chip'), [
    [1, 'Son'], [2, 'Lumière'], [4, 'Vidéo'], [10, 'Décoration'], [9, 'Mobilier'],
    [6, 'Textile'], [3, 'Structures'], [5, 'Lieux de réception'], [8, 'Divers'],
  ]);
  assert.ok(!nodes.some((node) => attr(node, 'id') === 'reception-subcategories'));
  const rows = nodes.filter((node) => attr(node, 'data-subcategories-of') !== undefined);
  assert.deepEqual(rows.map((row) => [attr(row, 'data-subcategories-of'), attr(row, 'aria-label'), attr(row, 'hidden') !== undefined]), [
    ['1', 'Sous-catégories Son', true],
  ]);
  assert.deepEqual(chips(rows[0], 'subcategory-chip'), [
    [1, 'Tout Son'], [11, 'Enceintes'], [12, 'Micros'], [13, 'Tables de mixage'], [14, 'DJ'], [15, 'Accessoires son'],
  ]);
  const select = nodes.find((node) => node.tagName === 'select' && attr(node, 'name') === 'categoryId');
  assert.deepEqual(elements(select).filter((node) => node.tagName === 'option').map((option) => [Number(attr(option, 'value')), text(option)]), [
    [1, 'Son'], [11, 'Son › Enceintes'], [12, 'Son › Micros'], [13, 'Son › Tables de mixage'], [14, 'Son › DJ'], [15, 'Son › Accessoires son'],
    [2, 'Lumière'], [4, 'Vidéo'], [10, 'Décoration'], [9, 'Mobilier'], [6, 'Textile'], [3, 'Structures'], [5, 'Lieux de réception'], [8, 'Divers'],
  ]);
});

test('chaque catégorie de la barre de /app garde son icône dans le CSS construit', async () => {
  const page = await readFile('dist/app/index.html', 'utf8');
  const stylesheets = [...page.matchAll(/href="(\/_astro\/[^"]+\.css)"/g)].map(([, href]) => readFile(`dist${href}`, 'utf8'));
  const css = (await Promise.all(stylesheets)).join('\n');
  for (const { icon } of rootListingCategories) {
    assert.match(page, new RegExp(`class="app-icon icon-${icon}"`));
    // Tailwind retire une classe qu'il ne trouve pas écrite en entier dans le code :
    // sans elle, le masque de l'icône disparaît et la catégorie s'affiche en carré gris.
    const rule = css.match(new RegExp(`\\.icon-${icon}\\{--app-icon: ?url\\(["']?([^"')]+)`));
    assert.ok(rule, `.icon-${icon} manque dans le CSS de /app`);
    await assert.doesNotReject(access(`dist${rule[1]}`), `${rule[1]} n’est pas publié`);
  }
});

test('la commune est normalisée sans deviner celle du propriétaire', () => {
  for (const value of [undefined, null, 59000, {}, '', '  ', '\t', '1', 'A', 'Paris\u0000']) {
    assert.equal(normalizeListingCity(value), undefined);
  }
  assert.equal(normalizeListingCity('  Villeneuve-d’Ascq  '), 'Villeneuve-d’Ascq');
  assert.equal(normalizeListingCity(' Saint  André lez Lille '), 'Saint André lez Lille');
});
