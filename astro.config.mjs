// @ts-check
import { defineConfig } from 'astro/config';
import { SITE } from './src/site.ts';

// The site's address is set in src/site.ts (or SITE_URL in the deploy settings).
export default defineConfig({
  site: SITE.url,
  output: 'static',
  build: { format: 'directory' },
  trailingSlash: 'ignore',
});
