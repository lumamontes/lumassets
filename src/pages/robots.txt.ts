import type { APIRoute } from 'astro';
import { SITE } from '../site';

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('/sitemap.xml', site ?? SITE.url).href;
  return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /wall/admin/\n\nSitemap: ${sitemap}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
