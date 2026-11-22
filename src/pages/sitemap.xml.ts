import type { APIRoute } from 'astro';
import { SITE } from '../site';

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL(SITE.url);
  const urls = ['/', '/compose/', '/wall/', '/about/'];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${new URL(u, base).href}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
