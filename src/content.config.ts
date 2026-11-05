import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Posts live in content/posts/ so they read as plain markdown on GitHub as well
// as rendering here. Drafts are excluded from listings and from the build.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    status: z.enum(['draft', 'published']).default('draft'),
    tags: z.array(z.string()).default([]),
  }),
});

// Reference docs: the sanitized, linkable version of the private findings files.
const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/docs' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
  }),
});

export const collections = { posts, docs };
