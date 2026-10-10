// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://goodlease.fr',
  integrations: [tailwind(), sitemap({
    filter: (page) => !['/app', '/catalogue', '/404'].includes(new URL(page).pathname.replace(/\/$/, '')),
    customSitemaps: ['https://goodlease.fr/sitemap-catalogue.xml'],
  })],
  build: {
    inlineStylesheets: 'auto',
  },
});
