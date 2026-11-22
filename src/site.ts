// Every link and address the site uses lives here. Change these before deploying.
// (SITE_URL in the deploy settings can override `url` without editing this file.)
export const SITE = {
  name: 'lumassets',
  tagline: 'Drawings @ Luma Montes',
  description: 'Drawings to copy, download or mix in the composer. @ Luma Montes',
  author: 'Luma Montes',

  /** Where this site is deployed (canonical links, sitemap, social previews). */
  url: process.env.SITE_URL ?? 'https://lumassets.pages.dev',
  /** Luma's personal website: "Luma Montes" links here. */
  websiteUrl: 'https://lumamontes.com',
  /** Cloudflare Turnstile site key (public) for sharing to the wall. This one is Cloudflare's
   *  always-passes test key: replace it with yours (docs/wall.md). */
  turnstileSiteKey: '1x00000000000000000000AA',
  /** quick-editor's repository (the tool that turns photos of drawings into SVGs). */
  quickEditorUrl: 'https://github.com/lumamontes/quick-editor',
  /** The public repository of this site. */
  githubUrl: 'https://github.com/lumamontes/lumassets',
  /** Contact link: email, social… */
  contactUrl: 'https://lumamontes.com/br/contact',
} as const;
