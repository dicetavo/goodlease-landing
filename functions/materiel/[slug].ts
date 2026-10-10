import { renderPublicSharePage } from '../../src/server/public-share-page';
import type { PublicShareEnv } from '../../src/server/public-html';

export const onRequest: PagesFunction<PublicShareEnv> = (context) => {
  const slug = context.params.slug;
  const id = typeof slug === 'string' ? /-([1-9]\d{0,18})$/.exec(slug)?.[1] : undefined;
  return renderPublicSharePage({ ...context, params: { id: id || '' } }, 'annonce');
};
