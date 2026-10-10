import { catalogueSelection, renderCataloguePage } from '../src/server/catalogue-pages';
import type { PublicShareEnv } from '../src/server/public-html';

export const onRequest: PagesFunction<PublicShareEnv> = (context) => {
  const category = context.params.category;
  if (typeof category !== 'string' || !catalogueSelection(`/${category}`)) return context.next();
  return renderCataloguePage(context, `/${category}`);
};
