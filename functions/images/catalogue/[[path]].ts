import { renderCatalogueImage } from '../../../src/server/catalogue-image';

export const onRequest: PagesFunction = (context) => renderCatalogueImage(context.request);
