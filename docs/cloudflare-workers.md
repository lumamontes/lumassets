# Deploy to Cloudflare Workers

The Worker serves the Astro build from `dist` and sends `/api/*` to the wall handler.
The public address is `https://lumassets.bibliotecadezines.workers.dev`.

For a local deploy with authenticated Wrangler, run `pnpm deploy`.

For Cloudflare Workers Builds, connect `lumamontes/lumassets` and use these settings:

- Worker name: `lumassets`
- Production branch: `main`
- Build command: `pnpm build`
- Deploy command: `pnpm exec wrangler deploy`
- Build environment variable: `NODE_VERSION=26`

Disable non-production branch builds for this Worker to keep production wall resources separate.
Configure the two production secrets and verify moderation using [the wall setup](wall.md).
