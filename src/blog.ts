import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/**
 * Articles publiés : non brouillons et dont la date est passée au moment du build.
 * BLOG_SHOW_SCHEDULED=1 au build affiche aussi les articles programmés (préversion uniquement).
 */
export async function publishedPosts(now = new Date()): Promise<Post[]> {
  const showScheduled = process.env.BLOG_SHOW_SCHEDULED === '1';
  const posts = await getCollection('blog', ({ data }) => !data.draft && (showScheduled || data.date.getTime() <= now.getTime()));
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export const postHref = (post: Post) => `/blog/${post.id}/`;

export const formatDate = (date: Date) =>
  date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
