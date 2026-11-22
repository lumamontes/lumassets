import { handle, type WallEnv } from './lib/wall-api.ts';

interface Env extends WallEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    return path === '/api' || path.startsWith('/api/')
      ? handle(request, env)
      : env.ASSETS.fetch(request);
  },
};
