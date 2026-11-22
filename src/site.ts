// Every link and address the site uses lives here. Change these before deploying.
// (SITE_URL in the deploy settings can override `url` without editing this file.)
export const SITE = {
  name: 'lumassets',
  tagline: 'Drawings-turned-assets by Luma Montes',
  description: "I’m Luma Montes. I drew these little monsters and geometric shapes. Take one, change its colors, or put a few together in the browser.",
  author: 'Luma Montes',

  /** Where this site is deployed (canonical links, sitemap, social previews). */
  url: process.env.SITE_URL ?? 'https://lumassets.bibliotecadezines.workers.dev',
  /** Luma's personal website: "Luma Montes" links here. */
  websiteUrl: 'https://lumamontes.com',
  /** Public Turnstile key. Use the test key with the local wall walkthrough. */
  turnstileSiteKey: import.meta.env?.PUBLIC_TURNSTILE_SITE_KEY ?? '0x4AAAAAAGMxZ5iEwPYZjjn_',
  /** quick-editor's repository (the tool that turns photos of drawings into SVGs). */
  quickEditorUrl: 'https://github.com/lumamontes/quick-editor',
  /** The public repository of this site. */
  githubUrl: 'https://github.com/lumamontes/lumassets',
  /** Contact link: email, social… */
  contactEmail: 'lumagoesmontes@gmail.com',
  contactUrl: 'https://lumamontes.com/br/contact',
} as const;
