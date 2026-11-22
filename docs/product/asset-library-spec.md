# Asset Library and Composition Tool

Status: Draft
Language: English
Audience: Designers, developers, and people looking for reusable visual assets

## 1. Product Summary

Create a free, fast, English-language open-source website for Luma's original visual assets. The site should work as both a public asset library and a lightweight playground for composing the assets into visual experiments.

The product must feel like a visual collection rather than a generic dashboard or stock-asset marketplace. The assets and their presentation are the primary product.

## 2. Goals

- Make original assets easy to discover, inspect, download, and reuse.
- Give every published asset a stable, shareable detail URL.
- Let visitors preview assets at large size without leaving the browsing flow.
- Let visitors create compositions without an account or server-side storage.
- Provide deterministic PNG and SVG exports where the source format allows it.
- Present the project, author, license, source repository, website, and contact links clearly.
- Keep the public site extremely fast, accessible, and free to deploy and operate.

## 3. Non-goals for the Initial Release

- No user accounts, authentication, profiles, comments, or social features.
- No paid marketplace, checkout, donations flow, or analytics platform requirement.
- No server-side composition storage.
- No remote asset API or database.
- No promise that every source file is a true vector. Some current SVG files may contain embedded raster content.
- No automatic ingestion of third-party libraries into the published collection.

## 4. Product Areas

### 4.1 Home

The home page should provide a short explanation of the collection, a featured composition or selected assets, and direct paths to:

- Browse assets
- Compose
- About
- GitHub
- Luma's personal website

The home page must load without requiring the composition editor bundle.

### 4.2 Asset Library

The library is the primary discovery surface.

Each card must show a visual preview and a readable asset name. Cards must link to the asset detail route, not only open a temporary modal.

The first version should support:

- Responsive grid layout
- Free-text search across name, aliases, tags, and description
- Category or collection filtering
- Optional variant or status filtering
- Visible result count
- Keyboard-accessible navigation
- Loading only the data and previews needed for the current page

Search is build-time or client-side over a generated static index. A server search endpoint is not required.

### 4.3 Asset Detail

Each asset must have a stable URL based on a URL-safe slug.

The detail page must provide:

- Large preview with zoom/fullscreen behavior
- Asset name, description, and tags
- Dimensions and viewBox when available
- Format and file size
- Source file download
- Optimized preview/download options when available
- License and attribution requirements
- Collection and release version
- Source repository link
- Add-to-composition action
- Open Graph metadata suitable for sharing

The detail page is canonical for SEO and sharing. A lightbox is an enhancement for browsing, not the only way to access information about an asset.

### 4.4 Composition Playground

The playground is a client-side editor for creating compositions from published assets.

Visitors must be able to:

- Add an asset from the library
- Move, scale, rotate, duplicate, and delete layers
- Change layer order
- Set canvas size and background
- Adjust supported visual properties such as opacity, color, blend mode, and filters
- Undo and redo changes
- Reset the composition
- Export PNG
- Export SVG when all layers and transformations can be represented faithfully
- Copy or download a composition document for later reuse

The initial composition is local-only. Reloading may discard unsaved work unless the user explicitly downloads or saves a composition document. No account is required.

The editor must preserve the asset ID and source version for every layer so a saved composition remains explainable and reproducible.

### 4.5 About

The About page must be short and personal. It must link to:

- Luma's website
- GitHub repository
- License and contribution information

All public interface and content copy is in English for the initial release.

## 5. Product and Business Rules

### 5.1 Asset ownership and publication

- Only assets intentionally approved for publication may appear in the public catalog.
- The local source collection is not automatically public.
- An asset is public only when it has a catalog entry and a published file.
- Draft, rejected, or unfinished assets must not appear in the generated site.
- The original source file is the source of truth; generated previews are disposable build output.
- Publishing an asset requires a stable ID, display name, slug, license, and source path.

### 5.2 Identity and naming

- IDs are immutable once published.
- Slugs should be lowercase, URL-safe, and human-readable.
- Display names may change without changing the ID.
- Search aliases should preserve discoverability after a rename.
- Filenames must not be the only user-facing name.
- Duplicate assets require distinct IDs and an explicit relationship such as variant, revision, or duplicate review.

### 5.3 Metadata

Every published asset must have:

- `id`
- `name`
- `slug`
- `description`
- `aliases`
- `tags`
- `category`
- `sourcePath`
- `previewPath`
- `format`
- `width`, `height`, and `viewBox` when available
- `license`
- `version`
- `status`

Optional metadata may include creation date, updated date, color variants, related assets, and composition restrictions.

### 5.4 Licensing

- The license must be explicit at collection level and, when needed, asset level.
- The website must not imply that all assets have the same terms if they do not.
- Required attribution must be visible on the detail page and in the repository documentation.
- Third-party assets must include upstream URL, license, version or commit, and import date.
- Third-party assets must not be republished only because they are downloadable elsewhere.
- The initial collection should preferably use one clear license chosen by Luma.

### 5.5 Downloads and exports

- Downloads must identify the asset and release version.
- Exported compositions are user-created outputs and must retain a provenance record when downloaded as a composition document.
- PNG export is allowed to rasterize the composition.
- SVG export must not falsely claim to preserve vector fidelity when a layer contains embedded raster data.
- Exported files should include a generated filename based on the composition title or a safe default.

### 5.6 Saved compositions

- Saved compositions are local documents, not public catalog entries.
- A composition document must contain canvas settings, ordered layers, transforms, visual properties, asset IDs, and asset versions.
- A composition must fail clearly when a referenced asset is unavailable instead of silently substituting a different asset.
- Sharing a composition URL is optional for the first release and must not require a backend.

## 6. SEO and Social Previews

- Every public route must have a unique title and description.
- Every asset detail page must have canonical metadata.
- Every public page must provide Open Graph and Twitter/X preview metadata.
- Social preview images should be generated from the asset preview and stable metadata.
- Sitemap and robots.txt must be generated at build time.
- Asset detail pages must contain crawlable text metadata, not only a canvas or image.
- Images must have meaningful alt text, or be marked decorative when the adjacent metadata carries the meaning.
- The site must use semantic headings, landmarks, links, and buttons.

## 7. Performance and Optimization Requirements

Performance is a product requirement, not a later polish task.

- Public pages should be statically generated whenever possible.
- The home, library, detail, and About pages must not load the composition editor code.
- Initial JavaScript should be minimal and limited to required interactions.
- Previews must be smaller than source/download files.
- Images must use explicit dimensions to avoid layout shift.
- Below-the-fold previews should lazy-load.
- The site should prefer local, self-hosted fonts or a system font stack.
- Build output must avoid unnecessary third-party scripts, trackers, and remote font requests.
- SVGs must be inspected and optimized without destroying intentional embedded content.
- Large embedded raster data should have a deliberately generated thumbnail for gallery use.
- The build must fail or warn on missing previews, duplicate IDs, invalid slugs, and missing license metadata.
- The target is a Lighthouse score of at least 90 for SEO, accessibility, and best practices, with performance measured on a representative production build.
- Interaction must remain responsive on mobile devices and lower-powered laptops.

## 8. Free Deployment and Operations

The initial deployment must have zero mandatory hosting cost.

- Host the static build on Cloudflare Pages using the free tier, or an equivalent free static host.
- Deploy from the public GitHub repository on pushes to the main branch.
- Use a static build output such as `dist`.
- Do not require a paid database, server, image CDN, search service, or analytics service.
- Do not require a paid custom domain. A free provider subdomain is acceptable for the initial release.
- Keep the repository deployable from a clean clone with documented install and build commands.
- Any future backend feature must be optional and must not break the static deployment.

Cloudflare Pages is the preferred first target because the repository already documents a compatible Astro deployment flow. Free-tier limits must be checked before introducing large generated previews or server-side features.

## 9. Open Source Reference Patterns

The following patterns are adopted from the research in [`docs/research/open-source-asset-library-patterns.md`](../research/open-source-asset-library-patterns.md):

- Lucide: searchable catalog, live customization, copy/download actions, and structured icon data.
- Phosphor: aliases, tags, categories, predictable variants, and release-aware metadata.
- Radix Icons and Heroicons: stable names, clear variants, compact previews, and direct downloads.
- OpenMoji: central metadata, separated source/export/data directories, releases, and explicit licensing.
- unDraw: preview-first browsing and direct download, with a warning that free access does not automatically permit mirroring or creating a competing asset service.

The project should adopt the catalog, metadata, versioning, and provenance patterns without copying third-party assets or assuming their licenses apply to Luma's work.

## 10. Initial Acceptance Criteria

- A visitor can browse the English asset library on desktop and mobile.
- A visitor can search by name or tag and see a correct result count.
- Clicking an asset opens a zoomable preview and provides a stable detail URL.
- A detail page exposes metadata, license, source, and download actions.
- A visitor can add assets to a client-side composition and export at least PNG.
- The site links to Luma's website and GitHub from the About area.
- The production build contains no required paid service.
- The site has generated sitemap, robots.txt, canonical metadata, and social previews.
- Missing or invalid asset metadata is detected during the build.
- The production build is deployable to the free Cloudflare Pages tier.

## 11. Initial Technical Proposal

### Application

- Astro with static output.
- TypeScript for catalog metadata and editor state.
- Astro content collections or a validated generated catalog for asset metadata.
- English copy stored in the project content/data layer.

### Assets

```text
assets/
  source/
  preview/
  download/
data/
  assets.json
```

Source assets remain separate from generated thumbnails and optimized downloads. The catalog is the build-time index and validation boundary.

### Gallery and detail interactions

- Use an existing zoom/lightbox implementation such as PhotoSwipe or the Astro image-zoom component rather than implementing gesture handling from scratch.
- Keep detail pages as statically generated routes.
- Use a small client-side search index initially; evaluate Pagefind only when catalog size makes it useful.

### Composition editor

- Load the editor only on `/compose` or after the user explicitly enters composition mode.
- Use Fabric.js for the first editor implementation because it provides transforms, layer manipulation, serialization, PNG export, and SVG export foundations.
- Keep the canonical composition document as JSON with asset IDs and source versions.
- Reuse the same asset metadata and rendering rules in detail previews and the editor.

### Optimization pipeline

- Generate gallery thumbnails during the build.
- Optimize SVG markup where safe.
- Preserve original sources separately.
- Record dimensions and file sizes in the catalog.
- Generate social preview images from stable asset metadata.
- Run build validation, accessibility checks, and Lighthouse against the production build.

### Deployment

- GitHub repository as the source of truth.
- Cloudflare Pages free tier as the first deployment target.
- Build command: `pnpm build`.
- Publish directory: `dist`.
- No SSR, database, or paid service in the initial release.

## 12. Open Decisions

- Final project and asset collection name.
- License for Luma's original assets.
- Whether the current SVGs should remain raster-in-SVG or be redrawn as true vectors.
- Whether compositions should support text layers in the first editor release.
- Whether shareable composition URLs are needed before a backend exists.
- Whether the asset library should live in this repository or a separate repository from the existing personal portfolio.
