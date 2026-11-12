import { renderEditorialPage } from '../src/server/editorial-pages';
import type { PublicShareEnv } from '../src/server/public-html';
export const onRequest: PagesFunction<PublicShareEnv> = (context) => renderEditorialPage(context, '/prix-location-sono');
