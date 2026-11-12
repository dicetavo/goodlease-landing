import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Articles du blog : un fichier Markdown par article dans src/content/blog/.
// Un article n'apparaît qu'à partir de sa date de publication (au build) et si draft vaut false.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string().max(70),
    description: z.string().max(170),
    date: z.coerce.date(),
    category: z.string(),
    keyword: z.string().optional(),
    cta: z.object({ label: z.string(), href: z.string() }).optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
