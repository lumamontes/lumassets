# The wall: setup

The wall shows compositions people share from the composer, **after you approve them**. All of it
runs on Cloudflare, next to the static site:

- `src/worker.ts`: the Worker entry point for `/api/*` request (code in `src/lib/wall-api.ts`)
- **R2** bucket `lumassets-wall`, **private**: the images (`wall/<id>.png`)
- **D1** database `lumassets-wall`: the list of posts (`migrations/0001_wall.sql`)
- **Turnstile**: Cloudflare's spam check on the Share form
- `/wall/admin/`: where you approve, hide or delete posts, with a secret token

Nothing is public until you approve it, and deleting removes the image for good. Only PNGs exported
by the composer are accepted; they carry the composition inside, which is what makes **Remix**
work. Posts store the title and optional name. The rate limiter stores a keyed, per-window digest of the visitor IP and drops expired entries on the next share attempt.

## One-time setup

Log in with the project's Wrangler dependency:

```sh
pnpm wrangler login
```

Create the storage and the table:

```sh
pnpm wrangler r2 bucket create lumassets-wall          # keep it private (the default)
pnpm wrangler d1 create lumassets-wall                 # save the database_id it prints
```

For a new installation, update the binding names and database ID in `wrangler.toml`, then run:

```sh
pnpm wrangler d1 migrations apply lumassets-wall --remote
```

**Turnstile**: Cloudflare dashboard → Turnstile → Add widget, with your site's domain (and
`localhost`). Put the **site key** in `turnstileSiteKey` in `src/site.ts` (the one there now is
Cloudflare's test key, which the API refuses outside localhost, so sharing stays off until you
replace it). Keep the **secret key** for the next step.

**Secrets** of the Worker (Workers & Pages → lumassets → Settings → Variables and Secrets, or):

```sh
pnpm wrangler secret put ADMIN_TOKEN        # a long random password: openssl rand -base64 32
pnpm wrangler secret put TURNSTILE_SECRET   # the Turnstile secret key
```

The R2 and D1 bindings come from `wrangler.toml` (names `WALL` and `DB`). If the dashboard doesn't
show them, add them under Settings → Bindings with those names.

**Rate limit**: the Worker allows five share attempts per visitor IP in each ten-minute window and returns `429` with `Retry-After` when the limit is reached. This works on the `workers.dev` hostname. Apply both D1 migrations before deploying.

Deploy as usual (push to `main`). Then open `/wall/admin/`, paste the token, and approve.

## Trying it locally

```sh
cp .dev.vars.example .dev.vars                     # test token + Cloudflare's always-pass Turnstile secret
pnpm wrangler d1 migrations apply lumassets-wall --local
PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm dev:wall                                       # builds, then serves the site and /api on http://localhost:8788
```

`pnpm dev` (plain Astro) has no `/api`: the wall says it isn't available, and Share says it can't
send. That's expected.

## Moderation

- **Waiting**: new posts. Not public, not even their image.
- **Approve**: shows it on the wall.
- **Hide**: takes it off the wall but keeps it.
- **Delete**: removes the image and the entry for good.

Shared images are scaled down to 1600 px on the long side. Limits: 8 MB, 80 characters of title,
40 of name.

The approval queue holds up to 200 pending posts. Workers preview URLs are disabled.
