# Deploying to Cloudflare Pages (free tier)

The site is fully static, so it fits Cloudflare Pages' free plan with no Functions, database or paid services.

1. Push the repository to GitHub.
2. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and pick the repository.
3. Build settings:
   - Framework preset: **Astro**
   - Production branch: `main`
   - Build command: `pnpm build`
   - Build output directory: `dist`
4. Environment variables (Production and Preview):
   - `NODE_VERSION` = `26` (matches `.nvmrc`; Astro 7 needs 22.23.4 or newer)
   - `SITE_URL` (optional): the production URL, if you'd rather not set `url` in `src/site.ts`
5. Save and deploy. Every push to `main` redeploys. Pull requests get preview URLs.

## Things to watch on the free tier

- Pages allows up to 20,000 files per deployment and 25 MiB per file. Each asset adds 6 generated files, so this leaves plenty of room, but check the limits again before adding large generated outputs.
- The largest source file (`fatia25.svg`) is about 5.6 MB, well under the per-file limit.
- Image generation happens during the build, so build time grows with the catalog. Unchanged assets are not cached between Cloudflare builds; that's fine at this size.

Astro's docs now recommend Cloudflare Workers for new projects that need server features. This project has none, so Pages is the simplest free option. Switch to Workers only if a server feature becomes necessary.
