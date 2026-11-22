# Open-Source Asset Library Patterns

Research date: 2026-11-21

Scope: first-party repositories, READMEs, documentation, and official deployed
catalogs relevant to an English-language Astro/static site for original SVG
assets. No application code was changed.

## Useful References

| Project | What is useful | License / caveat |
| --- | --- | --- |
| [Lucide](https://lucide.dev/icons/) ([repo](https://github.com/lucide-icons/lucide)) | Searchable icon catalog with categories, keyboard shortcuts, a live color/size/stroke customizer, and copy/download-oriented interaction. The official package also exposes structured icon data (`name`, nodes, dimensions) and builders for SVG strings, DOM elements, and data URIs. | ISC; free for commercial and personal use. Lucide explicitly does not accept brand logos. |
| [Phosphor](https://phosphoricons.com/) ([core repo](https://github.com/phosphor-icons/core)) | Particularly strong data model: raw SVGs plus catalog entries containing kebab/Pascal names, aliases, categories, tags, codepoints, and published/updated versions. Assets are grouped by weight using predictable paths. The README says this catalog powers fuzzy search. | MIT. Preserve the copyright and license notice when distributing substantial copies. |
| [Radix Icons](https://radix-ui.com/icons) ([repo](https://github.com/radix-ui/icons)) | Compact catalog with explicit categories, search, direct SVG zip download, npm install, Figma access, and copyable React examples. Fixed 15x15 geometry is a useful model for consistent preview cells. | MIT. |
| [Heroicons](https://heroicons.com/) ([repo](https://github.com/tailwindlabs/heroicons)) | Very legible browse pattern: styles and sizes are separated into Outline, Solid, Mini, and Micro; names are stable kebab-case in the catalog and package names are predictable. The README makes copy-the-inline-SVG the fastest path. | MIT. The official catalog currently displays 316 icons and has first-party React/Vue packages. |
| [OpenMoji](https://openmoji.org/library) ([repo](https://github.com/hfg-gmuend/openmoji)) | Closest reference for a serious asset catalog: searchable library, category/group browsing, black and color variants, release downloads, a dev catalog, and a central metadata file. Metadata includes Unicode identity, annotation, tags, author/date, skin-tone fields, and asset paths. The repository distinguishes source, exported assets, data, guidelines, helpers, and tests. | Graphics are CC BY-SA 4.0 and require attribution/share-alike; code is LGPL-3.0. The active development branch is not the stable production release, so pin releases. |
| [unDraw](https://undraw.co/illustrations) | Good illustration-gallery pattern: named cards, pagination, search, click-to-download, and on-the-fly color generation. It demonstrates a detail-light workflow where the preview is the primary affordance. | Free commercial/personal use without attribution, but the license prohibits creating a competing asset service, redistributing packs, automated scraping/search/download without consent, and AI/ML use. Do not mirror or ingest it into this product without permission. |

## Patterns Worth Adopting

### Catalog and search

- Keep a typed, build-time catalog separate from the SVG files. Minimum fields:
  `id`, display name, aliases, description, tags, category, style/variant,
  dimensions/viewBox, license, source URL, version, created/updated date, and
  preview/download paths.
- Search names, aliases, tags, and descriptions. Phosphor's tags and aliases
  are more useful than filename-only search; OpenMoji shows that domain metadata
  can make a large collection navigable.
- Use stable IDs for routes and downloads. Display names can change, while an
  alias list or redirect can preserve old links.
- Offer category and variant filters, but make free-text search the primary
  interaction. Support keyboard navigation and visible result counts.

### Preview and detail

- Use a dense responsive gallery for scanning, with a consistent preview frame
  and a visible asset name. A click should open a real detail route, not only a
  transient modal, so each asset is linkable and shareable.
- The detail view should show a large checkerboard or neutral preview, zoom,
  alternate variants, dimensions/viewBox, tags, source/version, license, and
  explicit SVG/PNG download actions.
- Borrow Lucide's live customization idea for original assets: background,
  color, scale, stroke/fill where meaningful, and reset/copy controls. Keep the
  generated result deterministic so downloads and future canvas layers match.
- Treat accessibility metadata as content: meaningful title/description,
  keyboard focus, visible focus state, alt text or decorative labeling, and a
  non-visual metadata panel.

### File organization and versioning

- Separate source assets from generated previews and distribution exports. A
  practical layout is `assets/source/`, `assets/preview/`, `assets/download/`,
  and `data/assets.json`; do not make generated thumbnails the source of truth.
- Use predictable, URL-safe filenames. Keep human-readable slugs separate from
  source identifiers such as Unicode/codepoint IDs.
- Pin the asset set to a release or commit and expose that version in the UI.
  OpenMoji's stable-release warning and Phosphor's published/updated fields are
  good reasons not to silently track a moving branch.
- Store license per asset or per collection, not only in a global footer. A
  mixed catalog needs collection-specific attribution and download terms.

### Future composition canvas

- Model a composition as a small ordered document: canvas size/background plus
  layers containing `assetId`, source version, transform, color/customization,
  and optional text. This keeps an export reproducible after the gallery grows.
- Reuse the same SVG renderer used by detail previews. Export SVG first; add PNG
  only after defining how external fonts, embedded images, and asset licenses
  are handled.
- Keep canvas state client-side initially. It does not require a server or
  account, which preserves the static-site architecture.

## Astro and Hosting Fit

Astro recommends build-time content collections for relatively static data,
with schemas for validation and generated static routes. That maps cleanly to
an asset catalog: metadata can be JSON/YAML or one entry per file, while SVGs
remain static assets. See the [Astro content collections guide](https://docs.astro.build/en/guides/content-collections/).

Cloudflare's official Pages guide uses `main`, a build command, and `dist`,
and rebuilds on pushed commits. The repository already documents `pnpm build`
and `dist` in [`docs/cloudflare-pages.md`](../cloudflare-pages.md). For a
static catalog, avoid adding SSR or a database until search scale or user-saved
compositions genuinely requires it. Astro now recommends Workers for new
Cloudflare projects, but Pages remains documented for existing static projects:
[Astro's Cloudflare deployment guide](https://docs.astro.build/en/guides/deploy/cloudflare/)
and [Cloudflare's Astro Pages guide](https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/).

## Licensing and Distribution Checklist

- Record the exact license and attribution text beside every imported
  collection; MIT/ISC permissive licenses are not interchangeable with
  CC BY-SA, LGPL, or custom terms.
- Do not assume "free download" permits republishing an asset library. unDraw
  explicitly forbids competing services and automated cataloging; that is a
  direct warning against copying its assets into this product.
- Keep original assets clearly separated from third-party references. Link to
  upstream source and license pages, and provide attribution in the detail page
  or a dedicated credits page where required.
- Pin upstream versions and retain a provenance record: upstream URL, commit or
  release, import date, local filename, license, and any transformations.
- Prefer repository-owned static files for a small original collection. A CDN
  or external API adds availability, CORS, rate-limit, and version-drift risks;
  if used later, pin immutable URLs and keep a local metadata snapshot.

## Primary Sources

- [Lucide repository README](https://github.com/lucide-icons/lucide)
- [Lucide catalog](https://lucide.dev/icons/)
- [Lucide icon data documentation](https://lucide.dev/guide/icons/)
- [Phosphor core README](https://github.com/phosphor-icons/core)
- [Phosphor license](https://github.com/phosphor-icons/core/blob/main/LICENSE)
- [Radix Icons catalog](https://radix-ui.com/icons)
- [Radix Icons repository](https://github.com/radix-ui/icons)
- [Heroicons catalog](https://heroicons.com/)
- [Heroicons repository README](https://github.com/tailwindlabs/heroicons)
- [OpenMoji catalog](https://openmoji.org/library)
- [OpenMoji repository README](https://github.com/hfg-gmuend/openmoji)
- [OpenMoji API metadata](https://github.com/hfg-gmuend/openmoji/blob/master/API.md)
- [unDraw illustrations](https://undraw.co/illustrations)
- [unDraw license](https://undraw.co/license)
- [Astro content collections](https://docs.astro.build/en/guides/content-collections/)
- [Astro Cloudflare deployment](https://docs.astro.build/en/guides/deploy/cloudflare/)
- [Cloudflare Pages Astro guide](https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/)
