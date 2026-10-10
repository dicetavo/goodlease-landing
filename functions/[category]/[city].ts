import { renderCataloguePage } from '../../src/server/catalogue-pages';
import { catalogueSelection } from '../../src/server/catalogue-pages';
import type { PublicShareEnv } from '../../src/server/public-html';

export const onRequest: PagesFunction<PublicShareEnv> = (context) => {
  const { category, city } = context.params;
  if (typeof category !== 'string' || !catalogueSelection(`/${category}/${context.params.city}`)) return context.next();
  if (typeof city !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city)) return context.next();
  return renderCataloguePage(context, `/${category}/${city}`);
};
