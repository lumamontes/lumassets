# lumassets

A free, static library of Luma Montes's hand-drawn assets, plus a small in-browser playground for composing them.

- **Grid**: every drawing in the same square, on one page. Search and filter; click one to open a panel (`/#slug` links straight to it) with license, a link to compose, and an **export** box: SVG or transparent PNG (512 to 4096 px), any colour (or `currentColor` for websites), download or copy (SVG code, or the image itself for pasting into Canva, Slides, Notion…). Exports are made in the browser.
- **Compose**: arrange drawings on a canvas, stack effects (distort, glitch, texture, focus, color, repeat) per layer or on everything, and export PNG, SVG, or a reusable composition file. Bring your own drawings too: SVGs stay vectors, photos get their paper and shadows removed, and they're saved inside the composition file. No account, no server: files never leave the browser.
- **Static**: Astro, no SSR, no database, no trackers. Deploys to Cloudflare Pages on the free tier.

Product spec: [`docs/product/asset-library-spec.md`](docs/product/asset-library-spec.md) · Research: [`docs/research/open-source-asset-library-patterns.md`](docs/research/open-source-asset-library-patterns.md)

## Requirements

- Node.js 22.23.4 or newer (`.nvmrc` pins 26, the current LTS: run `nvm use`)
- pnpm (`corepack enable` picks up the version in `package.json`)

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm dev` | Validate the catalog, generate images, start the dev server |
| `pnpm build` | Validate, generate images, and build the static site into `dist/` |
| `pnpm preview` | Serve the production build locally |
| `pnpm check:catalog` | Validate `data/assets.json` only (no dependencies needed) |
| `pnpm test` | Unit tests for the catalog validator and composition format |
| `pnpm check` | Astro and TypeScript diagnostics |
| `pnpm check:links` | Check every internal link, image and download in `dist/` (after `pnpm build`) |
| `pnpm test:e2e` | Playwright tests (grid, panel, editor) plus axe accessibility checks, against the built site |
| `pnpm verify` | Everything CI runs, in order |
| `pnpm lighthouse [url]` | Lighthouse reports for the main pages (see below) |

## Tests and CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`: catalog check → unit tests → `astro check` → build → link check → Playwright (desktop and mobile) with axe. Cloudflare deploys `main`, so turn on branch protection to require the **CI / verify** check before merging.

If Playwright fails in CI, its HTML report and traces are attached to the run as an artifact. Locally: `pnpm exec playwright show-report`.

Run Playwright locally the first time with `pnpm exec playwright install chromium`.

### Lighthouse

Not in CI, because scores vary between runs. Run it by hand:

```sh
pnpm build && pnpm lighthouse                                  # local production build
pnpm lighthouse https://<branch>.lumassets.pages.dev           # a Cloudflare PR preview
pnpm lighthouse https://lumassets.pages.dev --desktop          # production, desktop profile
```

It checks the grid, About and Compose, prints a score table, and saves HTML reports to `lighthouse-reports/`. It exits non-zero if accessibility, best practices or SEO drop below 90 (the spec's target). Performance is reported but not enforced.

The first `pnpm dev` or `pnpm build` rasterizes every published asset, which takes a little while. Later runs only redo assets whose source changed. Use `node scripts/build-assets.mjs --force` to regenerate everything.

## Making assets: quick-editor

New assets come from photos or scans of drawings, processed with [quick-editor](https://github.com/lumamontes/quick-editor) (its own repository): frame the page, clean the lighting and paper, pick the pieces, review the traced SVGs, save. `quick-editor.toml` in this repo tells it where things go here (photos in `scans/inbox/`, SVGs in `assets/vector/`, entries in `data/assets.json` as drafts).

```sh
brew install uv potrace                              # once
uv tool install --editable ~/www/quick-editor         # once, from your clone
pnpm studio                                          # or just: quick-editor
```

Photos in `scans/inbox/` are not committed (they're large); keep the per-photo session files in `scans/` with your local backups so you can retrace each asset.

## Drawing quality

Every published drawing must be a traced vector, traced from at least 600 px of real detail (`quality.minSourcePixels` in `data/collections.json`). `pnpm dev`, `pnpm build` and CI stop with an error otherwise. Drafts are never blocked. A drawing that is published anyway carries a `qualityException` with the reason, and every check lists them.

To fix drawings in bulk, put sharper scans or photos in `scans/inbox/` and run, from this folder:

```sh
quick-editor refit            # preview: finds each drawing in the photos, traces it, opens a before/after page
quick-editor refit --apply    # writes assets/vector/, assets/originals/ and updates data/assets.json
quick-editor refit sq1-06     # only some drawings
```

It finds each drawing in the photos even when they're rotated or taken at an angle, and only uses a photo when it has more real pixels than the current drawing.

## The wall

`/wall/` shows compositions people share from the composer, after you approve them at `/wall/admin/`. It runs on Cloudflare (a Pages Function, a private R2 bucket, D1, Turnstile) next to the static site. Setup, local testing and moderation: [`docs/wall.md`](docs/wall.md).

## How it fits together

```text
assets/source/        original SVGs: the source of truth (committed)
data/assets.json      the catalog: one entry per asset (committed)
data/collections.json collections, licenses, release version, featured list
scripts/              catalog validation + image generation (sharp)
public/generated/     display images (trimmed to the ink), SVG/PNG downloads, social image (build output, git-ignored)
src/generated/        sizes and URLs of the generated files, read by the site (build output, git-ignored)
src/lib/catalog.ts    typed access to the catalog; filters out anything not published
src/lib/composition.ts the composition document format, validation, and SVG export
src/scripts/editor.ts the Fabric.js editor, loaded only on /compose
src/scripts/own-drawings.ts  importing your own SVG/PNG/JPG (paper removal, in the browser)
```

An asset is public only when it has a catalog entry with `"status": "published"` **and** its source file exists. Drafts and rejected entries never reach the site.

The build fails on duplicate IDs or slugs, invalid slugs, missing required fields, missing source files, or missing licenses. It warns about undecided licenses and about catalog sizes that don't match the source file.

## Adding an asset

The full walkthrough, from a photo of the notebook to the live site: **[`docs/adding-assets.md`](docs/adding-assets.md)**. In short: scan at 600 dpi into `scans/inbox/`, cut the drawings out with `quick-editor`, write a `description` and set `"status": "published"` in `data/assets.json`, check with `pnpm check:catalog` and `pnpm dev`, then push.

Renaming: change `name` and `slug` freely, and add the old name to `aliases` so search still finds it. Don't change `id`.

## Notes on the current assets

- All published drawings are traced vectors in `assets/vector/` (made with `quick-editor refit`); the cleaned ink at full resolution is in `assets/originals/`, and the old image-in-SVG files stay in `assets/source/` (listed in each entry's `previousSources`).
- Quadrados 1 came from a 200 dpi scan and Quadrados 2 from a phone photo taken from afar, so many of their drawings are still under the quality bar (see the check's list). A 600 dpi scan of the Quadrados 1 page and closer photos of Quadrados 2, then `quick-editor refit --apply`, fix them.
- `sq1-14` is a byte-for-byte duplicate of `sq1-04`, and `sq3-01` a 259 px copy of `sq3-06` ("Fatia"): both are drafts with `duplicateOf`.
- Monstrinhos (`mon-*`), Quadrados 4 (`sq4-*`) and Avulsos (`av-*`) were added from the Affinity files and scans: their sources are in `assets/source/<collection>/`. Monstrinhos come from a 2338 px copy of the page, so four of them are under the quality bar; the 300 or 600 dpi scan of that page in `scans/inbox/` plus `quick-editor refit --apply` fixes them. The rest of the monsters on that page (`mon-00`) aren't cut out yet.
- Names are simple placeholders (quadrado-1, quadrado-2…); descriptions and tags were drafted from the drawings. Edit them to taste.

## License

Free and open source:

- **Code**: MIT, see [`LICENSE`](LICENSE).
- **Drawings** (`assets/` and everything generated from them): CC0 1.0, public domain, no credit needed. See [`LICENSE-ASSETS.md`](LICENSE-ASSETS.md). Set per collection in `data/collections.json`.

## Before the first public deploy

- [ ] Set up the wall: [`docs/wall.md`](docs/wall.md) (R2, D1, a Turnstile key, two secrets, one rate-limit rule).
- [ ] Replace the placeholder links in **`src/site.ts`** (the site's address, your website, GitHub, contact). That file is the only place they live.
