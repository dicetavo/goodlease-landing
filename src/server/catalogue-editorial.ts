import { cancellationFaq } from '../rental-policy';
import type { RentalCategory } from './catalogue-content';
import { formatMoney, leasePrice, type PublicLease } from './public-catalogue';
import { escapeHtml as esc } from './public-html';

export type Faq = { question: string; answer: string };
const median = (values: number[]) => {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};

/** Only comparable, paid DAILY rents. Outliers stay visible on the listing cards. */
export function dailyPriceSummary(leases: PublicLease[]) {
  const all = leases.filter((lease) => lease.periodType === 'DAILY').map(leasePrice)
    .filter((price): price is number => price !== undefined && price > 0).sort((a, b) => a - b);
  if (!all.length) return undefined;
  const ceiling = median(all) * 5;
  const prices = all.filter((price) => price <= ceiling);
  return { min: prices[0], max: prices.at(-1)!, median: median(prices), count: prices.length, excluded: all.length - prices.length };
}

export const commonRentalFaq: Faq[] = [
  ...cancellationFaq,
  { question: 'Comment fonctionne le dépôt de garantie ?', answer: 'Une empreinte bancaire peut être demandée via Stripe : ce n’est pas un débit du dépôt de garantie. Vérifiez le montant et les conditions de libération indiqués dans le parcours de location avant de confirmer.' },
  { question: 'Comment récupérer et rendre le matériel ?', answer: 'Le loueur précise le lieu de retrait, la livraison éventuelle et les conditions pratiques. Confirmez-les dans la messagerie. À la remise et au retour, des photos permettent de constater l’état du matériel.' },
  { question: 'Quels frais s’ajoutent au loyer ?', answer: 'Le loyer est fixé par le loueur. Les frais de service applicables et le montant total à payer s’affichent avant la confirmation du paiement. Le dépôt de garantie est présenté séparément.' },
  { question: 'Que faire en cas de problème ?', answer: 'Contactez d’abord le loueur dans la messagerie, puis le support GoodLease. Les coordonnées et horaires sont indiqués sur la page Contact. La procédure de médiation est présentée sur la page Résolution des litiges.' },
];

export function faqHtml(questions: Faq[]) {
  return questions.map((item) => `<details class="mt-4 rounded-card border border-line bg-surface p-5"><summary class="cursor-pointer font-semibold">${esc(item.question)}</summary><p class="mt-3 leading-relaxed text-muted">${esc(item.answer)}</p></details>`).join('');
}
export const faqSchema = (questions: Faq[]) => ({ '@type': 'FAQPage', mainEntity: questions.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) });
export const editorialSection = (title: string, paragraphs: string[]) => `<section class="mt-10 max-w-3xl"><h2 class="text-2xl">${esc(title)}</h2>${paragraphs.map((p) => `<p class="mt-4 leading-relaxed text-muted">${esc(p)}</p>`).join('')}</section>`;

type Copy = { title: string; h1: string; examples: string; section: string; paragraphs: string[]; faq: Faq[] };
const copy: Record<string, Copy> = {
  sonorisation: {
    title: 'Location sono', h1: 'Location de sono', examples: 'Enceintes, caissons de basse, micros et contrôleurs DJ', section: 'Quelle sono pour quel événement ?',
    paragraphs: [
      'Pour une soirée à la maison ou un anniversaire, comparez les enceintes portables ou amplifiées avec un micro.',
      'Pour un mariage ou une salle des fêtes, regardez les paires d’enceintes, les caissons de basse et les micros HF. Indiquez au loueur le nombre d’invités et la taille de la salle.',
      'Pour un set DJ, regardez les contrôleurs, les tables de mixage et les meubles ou façades DJ proposés dans les annonces.',
      'Dans chaque annonce, vérifiez les câbles, les pieds et les accessoires inclus. Le contenu de l’annonce fait foi.',
    ], faq: [
      { question: 'Quelle puissance de sono faut-il ?', answer: 'Elle dépend du nombre d’invités, de la taille de la salle et de l’usage, en intérieur ou en extérieur. Donnez ces informations au loueur et vérifiez la puissance indiquée dans l’annonce.' },
      { question: 'Les câbles et les pieds sont-ils fournis ?', answer: 'Le contenu de chaque annonce fait foi. Vérifiez les accessoires et les quantités avant de confirmer, ou posez la question au loueur dans la messagerie.' },
    ],
  },
  eclairage: {
    title: 'Location éclairage', h1: 'Location d’éclairage et d’effets', examples: 'Projecteurs LED, jeux de lumière, lasers et machines à effets', section: 'Quel effet pour quel moment ?',
    paragraphs: [
      'La fumée ou le brouillard donne du volume aux faisceaux lumineux. La fumée lourde reste au sol et peut accompagner une première danse.',
      'Les lasers créent des faisceaux et des motifs pour une piste de danse. Les projecteurs LED et les lyres colorent une salle ou animent une scène.',
      'Pour les effets à étincelles froides, demandez au loueur les conditions d’utilisation. Avant de réserver de la fumée, un laser ou des étincelles, vérifiez ce que votre lieu autorise.',
    ], faq: [
      { question: 'Peut-on utiliser une machine à fumée ou des étincelles froides dans une salle ?', answer: 'Cela dépend du lieu. Demandez l’accord de la salle : les détecteurs de fumée et les règles de sécurité peuvent l’interdire.' },
      { question: 'Comment choisir l’éclairage de ma soirée ?', answer: 'Indiquez au loueur la taille de la salle, l’effet souhaité et le moment de la soirée. Vérifiez dans l’annonce ce qui est inclus : câbles, supports et commande.' },
    ],
  },
  decoration: {
    title: 'Location décoration mariage', h1: 'Location de décoration de mariage et de réception', examples: 'Arches, murs de fleurs, backdrops, banquettes et accessoires de réception', section: 'Composer votre décoration',
    paragraphs: [
      'Partez d’une pièce centrale : une arche, un mur de fleurs ou un backdrop pour la cérémonie ou les photos.',
      'Reprenez sa couleur sur le reste de la décoration. Comparez les chemins de fleurs, les boules de fleurs, les vases et les chandeliers réellement proposés.',
      'Vérifiez les dimensions de chaque pièce : elle doit tenir dans votre lieu et dans votre véhicule. Demandez au loueur le conditionnement, le transport et le montage des pièces fragiles.',
    ], faq: [
      { question: 'Comment choisir une arche ou un backdrop ?', answer: 'Comparez les dimensions, les couleurs et la structure. Confirmez avec le loueur les conditions de montage et de transport.' },
      { question: 'Peut-on assortir plusieurs pièces ?', answer: 'Écrivez au loueur dans la messagerie pour vérifier les couleurs, les quantités et la disponibilité de l’ensemble sur les mêmes dates.' },
    ],
  },
  'photo-video': {
    title: 'Location vidéoprojecteur et vidéo', h1: 'Location de vidéoprojecteur et de matériel photo et vidéo', examples: 'Vidéoprojecteurs, écrans de projection et matériel photo et vidéo', section: 'Pour projeter une présentation ou un film',
    paragraphs: [
      'Comparez les vidéoprojecteurs et les écrans de projection proposés. Vérifiez la luminosité de la salle, la distance de projection et les connexions avec le loueur.',
      'Pour une animation ou des souvenirs de réception, consultez aussi les livres d’or vidéo et les animations interactives présents dans le catalogue. Les accessoires inclus dépendent de chaque annonce.',
    ], faq: [{ question: 'Faut-il louer l’écran en plus du vidéoprojecteur ?', answer: 'Cela dépend de votre salle et du contenu de l’annonce. Vérifiez si l’écran est inclus ou proposé séparément, ainsi que les câbles et les supports.' }],
  },
};

const normalizedTitle = (lease: PublicLease) => String(lease.title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const equipmentTypes = [
  { label: 'Pieds et supports', match: /\b(pieds?|supports?|structures?)\b/ },
  { label: 'Meubles et façades DJ', match: /\b(meubles?|facades?)\b.*\bdj\b/ },
  { label: 'Caissons de basse', match: /\bcaissons?\b/ },
  { label: 'Enceintes et systèmes audio', match: /\b(enceintes?|systemes? amplifies?|sono)\b/ },
  { label: 'Micros', match: /\b(micros?|microphones?)\b/ },
  { label: 'Matériel DJ', match: /\b(dj|mixage|controleurs?|platines?)\b/ },
];
export const sonoEquipmentGroup = (lease: PublicLease) => equipmentTypes.find((type) => type.match.test(normalizedTitle(lease)))?.label;

/** Match the listing's main equipment, not every accessory in its description. */
export function sonoPriceRows(leases: PublicLease[]) {
  const groups = equipmentTypes.map((type) => ({ ...type, leases: [] as PublicLease[] }));
  for (const lease of leases) groups.find((type) => type.label === sonoEquipmentGroup(lease))?.leases.push(lease);
  return groups.flatMap((group) => {
    const price = dailyPriceSummary(group.leases);
    return price ? [{ label: group.label, ...price }] : [];
  });
}

export function pricesTable(rows: { label: string; min: number; max: number; count: number }[]) {
  if (!rows.length) return '<p class="mt-4 text-muted">Aucun tarif journalier comparable pour cette sélection. Consultez les périodes et les prix dans les annonces.</p>';
  return `<div class="mt-5 overflow-x-auto"><table class="w-full text-left"><caption class="mb-3 text-left text-sm text-muted">Loyers journaliers affichés, hors frais de service et dépôt de garantie. Disponibilités à confirmer.</caption><thead><tr class="border-b border-line"><th class="p-3">Matériel</th><th class="p-3">Annonces comparables</th><th class="p-3">Loyer par jour</th></tr></thead><tbody>${rows.map((row) => `<tr class="border-b border-line"><th class="p-3 font-medium">${esc(row.label)}</th><td class="p-3">${row.count}</td><td class="p-3 whitespace-nowrap">${esc(row.min === row.max ? formatMoney(row.min) : `${formatMoney(row.min)} à ${formatMoney(row.max)}`)}</td></tr>`).join('')}</tbody></table></div>`;
}

export function categoryEditorial(category: RentalCategory, leases: PublicLease[], city?: string) {
  const text = copy[category.slug];
  const place = city ? ` à ${city}${city === 'Lille' ? ' et dans la métropole lilloise' : ' et alentours'}` : ' entre particuliers et professionnels';
  const prices = dailyPriceSummary(leases);
  const range = prices ? `Les loyers journaliers usuels vont de ${formatMoney(prices.min)} à ${formatMoney(prices.max)}, avec une médiane de ${formatMoney(prices.median)}.` : 'Les tarifs et leur période de facturation sont indiqués dans chaque annonce. Comparez le prix pour la durée dont vous avez besoin.';
  const description = `${leases.length} annonce${leases.length > 1 ? 's' : ''} ${category.subject} à louer${city ? ` à ${city} et alentours` : ' près de chez vous'}.${prices ? ` Loyers usuels de ${formatMoney(prices.min)} à ${formatMoney(prices.max)} par jour.` : ''} Comparez sur GoodLease.`;
  const intro = `${text?.examples || category.examples} : comparez ${leases.length} annonce${leases.length > 1 ? 's' : ''}${place}. Choisissez vos dates et vérifiez les accessoires inclus, le retrait et les disponibilités avec le loueur.`;
  const questions = [...(text?.faq || [{ question: `Comment choisir votre location ${category.subject} ?`, answer: category.checks }]), ...commonRentalFaq];
  const related = category.slug === 'sonorisation'
    ? `<p class="mt-6"><a class="text-primary underline" href="/prix-location-sono">Comparer les prix d’une location de sono</a></p><p class="mt-3"><a class="text-primary underline" href="/location-eclairage">Besoin de lumière avec votre sono ?</a> · <a class="text-primary underline" href="/location-photo-video">Chercher un vidéoprojecteur</a></p>`
    : `<p class="mt-6"><a class="text-primary underline" href="/organiser-une-soiree-d-entreprise">Préparer le matériel d’une soirée d’entreprise</a></p>`;
  return {
    heading: text ? `${text.h1}${place}` : `Location ${category.subject}${place}`,
    title: `${text?.title || `Location ${category.subject}`}${city ? ` à ${city}` : ''}${category.slug === 'decoration' ? '' : ` : ${leases.length} annonces`}`,
    description, intro,
    schema: faqSchema(questions),
    html: `${editorialSection(text?.section || 'Bien préparer votre location', text?.paragraphs || [category.intro, category.checks])}
      ${editorialSection('Les prix', [range, 'Le total dépend de la durée et des conditions de l’annonce. Les frais de service et le dépôt de garantie sont affichés avant de confirmer.'])}
      ${prices?.excluded ? '<p class="mt-3 max-w-3xl text-sm text-muted">Cette fourchette indicative exclut les tarifs supérieurs à cinq fois la médiane. Tous les prix restent visibles sur les annonces.</p>' : ''}
      ${category.slug === 'sonorisation' ? pricesTable(sonoPriceRows(leases)) : ''}
      <section class="mt-10 max-w-3xl"><h2 class="text-2xl">Questions fréquentes</h2>${faqHtml(questions)}${related}
      <p class="mt-8">Vous avez du matériel à louer ? <a class="text-primary underline" href="/louer-son-materiel/">Présentez votre matériel sur GoodLease.</a></p></section>`,
  };
}
