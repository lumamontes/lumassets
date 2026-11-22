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

## Web analytics

In the Cloudflare dashboard, open **Web Analytics** and select
`lumassets.bibliotecadezines.workers.dev`. Use **Device type** to compare mobile, tablet,
and desktop traffic.

The shared layout loads the site’s public beacon on the production hostname and skips
private pages. If the hostname changes, update both the Web Analytics site and the hostname
check in `public/web-analytics.js`.

Download counts are available under **Download counts** on `/wall/admin/` with the
existing admin token. Apply the D1 migrations before deploying. The report covers the last
30 days in UTC. A download counts when the library or composer starts a file download,
with a ZIP counted as one file.

## Google Analytics

The dedicated [Lumassets GA4 property](https://analytics.google.com/analytics/web/#/a245331990p565383897/reports/intelligenthome)
uses the production web stream. Google Analytics starts after a visitor chooses **Allow
analytics**. Visitors can change the choice through **Analytics settings** in the footer.

Check **Reports → Realtime** for new activity and **Reports → Engagement → Events** for
`file_download` and events such as `wall_remix_click`. Download events use fixed file labels, and click events use
fixed action names. Library searches, composition names, and uploaded files stay out of
those event parameters. Cloudflare traffic and the private download report keep their own totals.
