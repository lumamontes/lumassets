import { handle, type WallEnv } from './lib/wall-api.ts';

import { serveWallEntry, WALL_ENTRY_TEMPLATE } from './lib/wall-entry.ts';

interface Env extends WallEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api' || path.startsWith('/api/')) return handle(request, env);
    if (path.startsWith('/wall/post/')) return serveWallEntry(request, env.DB, env.ASSETS);
    const imageId = path.match(/^\/wall\/image\/([a-z0-9]{12})\.png$/)?.[1];
    if (imageId) {
      const image = new URL(`/api/wall/${imageId}.png`, request.url);
      return handle(new Request(image, { method: request.method }), env);
    }
    if (path === WALL_ENTRY_TEMPLATE.slice(0, -1) || path.startsWith(WALL_ENTRY_TEMPLATE))
      return Promise.resolve(new Response('Not found.', { status: 404 }));
    return env.ASSETS.fetch(request);
  },
};
