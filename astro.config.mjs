// @ts-check
import { defineConfig } from 'astro/config';
import headingIds from './src/plugins/heading-ids.mjs';

export default defineConfig({
  // Point this at the domain you end up registering; it only affects canonical
  // URLs, sitemap entries and OpenGraph tags.
  site: 'https://damagedpatches.dev',
  markdown: {
    remarkPlugins: [headingIds],
    shikiConfig: { theme: 'github-light', wrap: true },
  },
});
