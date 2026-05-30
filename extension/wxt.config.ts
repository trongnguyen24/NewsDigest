import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'NewsDigest Reddit Scraper',
    description: 'Scrape Reddit listings and posts from old.reddit.com into NewsDigest.',
    permissions: ['tabs', 'activeTab', 'storage'],
    host_permissions: [
      '*://old.reddit.com/*',
      'http://localhost/*',
      'https://*.workers.dev/*',
      'https://*.pages.dev/*'
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
