import { renderCataloguePage } from '../src/server/catalogue-pages';
import type { PublicShareEnv } from '../src/server/public-html';

export const onRequest: PagesFunction<PublicShareEnv> = (context) => renderCataloguePage(context);
