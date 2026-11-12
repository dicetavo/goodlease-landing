import { site } from '../config';
import { apiBaseUrl, fetchCatalogue, inArea, leasePath, leasePrice, formatMoney, type PublicLease } from './public-catalogue';
import { commonRentalFaq, dailyPriceSummary, editorialSection, faqHtml, faqSchema, pricesTable, sonoPriceRows, sonoEquipmentGroup, type Faq } from './catalogue-editorial';
import { DEFAULT_IMAGE, escapeHtml as esc, renderPublicPage, type PublicPageContext } from './public-html';

export const editorialPaths = ['/prix-location-sono', '/organiser-une-soiree-d-entreprise'] as const;

function cheapest(leases: PublicLease[], pattern: RegExp) {
  return leases.filter((lease) => lease.periodType === 'DAILY' && (leasePrice(lease) ?? 0) > 0 && pattern.test(String(lease.title || '')))
    .sort((a, b) => leasePrice(a)! - leasePrice(b)!)[0];
}

function budgetExample(label: string, items: (PublicLease | undefined)[]) {
  if (items.some((item) => !item)) return '';
  const selected = items as PublicLease[];
  const amount = selected.reduce((sum, item) => sum + leasePrice(item)!, 0);
  return `<li class="mt-3"><strong>${esc(label)} : ${esc(formatMoney(amount))} par jour</strong> (${selected.map((item) => `<a class="text-primary underline" href="${leasePath(item)}">${esc(String(item.title))}</a>`).join(' + ')}).</li>`;
}

function sonoGuide(leases: PublicLease[]) {
  const sono = leases.filter((lease) => Number(lease.categoryId) === 1);
  const speaker = cheapest(sono.filter((lease) => sonoEquipmentGroup(lease) === 'Enceintes et systèmes audio'), /./);
  const microphone = cheapest(sono.filter((lease) => sonoEquipmentGroup(lease) === 'Micros'), /./);
  const dj = cheapest(sono.filter((lease) => sonoEquipmentGroup(lease) === 'Matériel DJ'), /./);
  const examples = [budgetExample('Enceinte et micro', [speaker, microphone]), budgetExample('Contrôleur DJ et enceinte', [dj, speaker])].filter(Boolean);
  const faq: Faq[] = [
    { question: 'Combien coûte la location d’une sono pour une soirée ?', answer: 'Le budget dépend du matériel, de la durée et des accessoires inclus. Le tableau présente les loyers journaliers des annonces de Lille et de sa métropole. Vérifiez les disponibilités et le montant total avant de réserver.' },
    { question: 'Comment comparer deux locations de sono ?', answer: 'Regardez le matériel et les quantités inclus, les câbles, les pieds et les connexions. Demandez aussi au loueur les conditions de retrait, de livraison ou d’installation lorsqu’elles sont proposées.' },
    ...commonRentalFaq,
  ];
  return {
    title: 'Prix location sono : tarifs à la journée',
    heading: 'Combien coûte la location d’une sono ?',
    description: 'Comparez les loyers journaliers des micros, enceintes et équipements DJ proposés à Lille et dans la métropole lilloise sur GoodLease.',
    html: `<p class="mt-5 max-w-3xl leading-relaxed text-muted">Le prix dépend du matériel, de la durée et de ce qui est inclus. Voici les loyers journaliers actuellement affichés dans les ${sono.length} annonces de sonorisation de Lille et de sa métropole.</p>
      ${editorialSection('Les prix par type de matériel à Lille', ['Ces fourchettes sont calculées depuis les annonces de la sélection. Les tarifs atypiques supérieurs à cinq fois la médiane de chaque type sont exclus de la fourchette indicative, mais restent visibles sur les annonces.'])}
      ${pricesTable(sonoPriceRows(sono))}
      ${examples.length ? `<section class="mt-10 max-w-3xl"><h2 class="text-2xl">Exemples de budget par jour</h2><p class="mt-4 text-muted">Additions de loyers affichés, avant frais de service et dépôt de garantie, parfois chez des loueurs différents. Vérifiez la compatibilité du matériel et la disponibilité de chaque annonce pour vos dates.</p><ul class="mt-4 list-disc pl-6">${examples.join('')}</ul></section>` : ''}
      ${editorialSection('Ce qui fait varier le prix', ['Le loueur fixe son loyer et sa période de facturation. Le prix total dépend de la durée et des conditions de l’annonce.', 'Comparez les accessoires et les quantités avant de choisir sur le prix seul. Demandez si le retrait, la livraison ou l’installation correspondent à votre besoin.', 'Les frais de service et le montant total à payer s’affichent avant la confirmation du paiement. Un dépôt de garantie peut être demandé séparément.'])}
      <p class="mt-6"><a class="btn-primary" href="/location-sonorisation/lille">Voir les ${sono.length} annonces de sonorisation à Lille et alentours</a></p>`,
    faq,
  };
}

function companyGuide(leases: PublicLease[]) {
  const needs = [
    { label: 'Prises de parole', category: 1, match: /micro/i, path: 'sonorisation', advice: 'Précisez le nombre d’intervenants et les connexions nécessaires.' },
    { label: 'Musique et ambiance', category: 1, match: /enceinte|contr[oô]leur|mixage/i, path: 'sonorisation', advice: 'Vérifiez la puissance adaptée à la salle et les accessoires inclus.' },
    { label: 'Lumière', category: 2, match: /./, path: 'eclairage', advice: 'Demandez au lieu ce qui est autorisé, notamment pour la fumée, les lasers ou les étincelles.' },
    { label: 'Présentations et vidéo', category: 4, match: /projection|projecteur|[ée]cran/i, path: 'photo-video', advice: 'Vérifiez le recul, la luminosité et la connectique.' },
    { label: 'Décoration et coin photo', category: 5, match: /backdrop|arche|mur.*fleur/i, path: 'decoration', advice: 'Comparez les dimensions, le conditionnement et les conditions de montage.' },
  ];
  const equipment = needs.flatMap((need) => {
    const price = dailyPriceSummary(leases.filter((lease) => Number(lease.categoryId) === need.category &&
      !(need.category === 1 && ['Pieds et supports', 'Meubles et façades DJ'].includes(sonoEquipmentGroup(lease) || '')) &&
      need.match.test(String(lease.title || ''))));
    return price ? [`<li class="mt-5"><a class="font-semibold text-primary underline" href="/location-${need.path}/lille">${esc(need.label)}</a> : loyers journaliers usuels de ${esc(formatMoney(price.min))} à ${esc(formatMoney(price.max))}. ${esc(need.advice)}</li>`] : [];
  }).join('');
  const faq: Faq[] = [
    { question: 'Une entreprise peut-elle louer sur GoodLease ?', answer: 'Le service est ouvert aux particuliers et aux entreprises. Pour une location professionnelle, vérifiez avec le loueur et le support les conditions et les justificatifs nécessaires avant de confirmer.' },
    { question: 'Faut-il un technicien pour installer le matériel ?', answer: 'Cela dépend du matériel. Vérifiez les conditions pratiques dans chaque annonce et posez la question au loueur avant de réserver. La livraison ou l’installation ne sont incluses que si elles sont explicitement proposées.' },
    ...commonRentalFaq,
  ];
  return {
    title: 'Soirée d’entreprise : le matériel à prévoir',
    heading: 'Organiser une soirée d’entreprise : le matériel à prévoir',
    description: 'Sono, micros, lumière, vidéoprojecteur et décoration : préparez votre soirée d’entreprise avec les annonces et les loyers journaliers de la métropole lilloise.',
    html: `<p class="mt-5 max-w-3xl leading-relaxed text-muted">Afterwork, soirée de fin d’année, inauguration ou séminaire : partez du format et du lieu, puis choisissez le matériel adapté. Les tarifs ci-dessous sont calculés depuis les annonces de Lille et de sa métropole.</p>
      ${editorialSection('Commencez par le format', ['Combien de personnes, dans quel lieu, à quelle heure, avec ou sans prises de parole ? Ces quatre questions aident à définir votre besoin.', 'Demandez au lieu ce qu’il fournit déjà et ce qu’il autorise. Vous pourrez louer seulement ce qui manque.'])}
      <section class="mt-10 max-w-3xl"><h2 class="text-2xl">Le matériel selon le besoin</h2><p class="mt-4 text-sm text-muted">Loyers journaliers indicatifs hors frais de service et dépôt de garantie. Les disponibilités sont à confirmer dans chaque annonce.</p><ul class="mt-4 list-disc pl-6">${equipment || '<li>Consultez le catalogue pour connaître les équipements et les tarifs actuellement proposés.</li>'}</ul></section>
      ${editorialSection('Le calendrier', ['Quatre semaines avant : fixez le format, le nombre de personnes et le budget.', 'Trois semaines avant : vérifiez avec le lieu ce qui est fourni et autorisé.', 'Deux semaines avant : choisissez votre matériel et envoyez vos demandes pour les dates souhaitées.', 'La veille : confirmez le retrait avec le loueur. Le jour même, prenez des photos à la remise du matériel et faites de même au retour.'])}
      <p class="mt-6"><a class="text-primary underline" href="/prix-location-sono">Comparer les prix d’une location de sono</a> · <a class="text-primary underline" href="/catalogue">Explorer le catalogue</a></p>`,
    faq,
  };
}

export async function renderEditorialPage(context: PublicPageContext, path: typeof editorialPaths[number]) {
  if (!['GET', 'HEAD'].includes(context.request.method)) return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  if (new URL(context.request.url).pathname !== path) {
    const target = new URL(context.request.url); target.pathname = path;
    return new Response(null, { status: 301, headers: { Location: target.href } });
  }
  try {
    const all = await fetchCatalogue(apiBaseUrl(context.env));
    const leases = all.filter((lease) => inArea(lease, 'lille'));
    const guide = path === '/prix-location-sono' ? sonoGuide(leases) : companyGuide(leases);
    const canonical = `${site.url}${path}`;
    const relevantCount = path === '/prix-location-sono' ? leases.filter((lease) => Number(lease.categoryId) === 1).length : leases.length;
    return renderPublicPage(context, {
      title: `${guide.title} · GoodLease`, description: guide.description, canonical,
      image: DEFAULT_IMAGE, imageAlt: 'GoodLease — location de matériel', ogType: 'website',
      robots: relevantCount >= 3 ? 'index,follow,max-image-preview:large' : 'noindex,follow',
      schema: { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage', name: guide.heading, description: guide.description, url: canonical }, faqSchema(guide.faq)] },
    }, 200, `<article class="container-gl py-12 sm:py-16"><nav aria-label="Fil d’Ariane" class="text-sm text-primary"><a href="/">Accueil</a> / <a href="/catalogue">Catalogue</a></nav><h1 class="mt-6 max-w-4xl text-3xl sm:text-4xl">${esc(guide.heading)}</h1>${guide.html}<section class="mt-10 max-w-3xl"><h2 class="text-2xl">Questions fréquentes</h2>${faqHtml(guide.faq)}<p class="mt-8">Vous avez du matériel à louer ? <a class="text-primary underline" href="/louer-son-materiel/">Présentez votre matériel sur GoodLease.</a></p></section></article>`);
  } catch {
    return renderPublicPage(context, { title: 'Tarifs momentanément indisponibles · GoodLease', description: 'Le catalogue ne répond pas pour le moment. Réessayez dans quelques instants.', canonical: `${site.url}${path}`, image: DEFAULT_IMAGE, imageAlt: 'GoodLease', ogType: 'website', robots: 'noindex,follow', schema: { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Catalogue indisponible' } }, 503, '<section class="container-gl py-16"><h1 class="text-3xl">Le catalogue est momentanément indisponible</h1><p class="mt-5">Les tarifs ne peuvent pas être vérifiés. Réessayez dans quelques instants.</p></section>');
  }
}
