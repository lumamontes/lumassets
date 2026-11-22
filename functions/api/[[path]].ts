// Cloudflare Pages Function for every /api/* request: the wall (see src/lib/wall-api.ts).
// Bindings (set in wrangler.toml / the Cloudflare dashboard): DB (D1), WALL (R2);
// secrets: ADMIN_TOKEN, TURNSTILE_SECRET. Setup: docs/wall.md.
import { handle, type WallEnv } from '../../src/lib/wall-api.ts';

export const onRequest = (context: { request: Request; env: WallEnv }) => handle(context.request, context.env);
