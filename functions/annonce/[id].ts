import {
  renderPublicSharePage,
  type PublicShareEnv,
} from '../../src/server/public-share-page';

export const onRequest: PagesFunction<PublicShareEnv> = (context) =>
  renderPublicSharePage(context, 'annonce');
