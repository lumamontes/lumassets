# The wall: setup

The wall shows compositions people share from the composer, **after you approve them**. All of it
runs on Cloudflare, next to the static site:

- `functions/api/[[path]].ts`: a Pages Function for every `/api/*` request (code in `src/lib/wall-api.ts`)
- **R2** bucket `lumassets-wall`, **private**: the images (`wall/<id>.png`)
- **D1** database `lumassets-wall`: the list of posts (`migrations/0001_wall.sql`)
- **Turnstile**: Cloudflare's spam check on the Share form
- `/wall/admin/`: where you approve, hide or delete posts, with a secret token

Nothing is public until you approve it, and deleting removes the image for good. Only PNGs exported
by the composer are accepted; they carry the composition inside, which is what makes **Remix**
work. Nothing else about the person is stored: no IP, no email, just the title and the optional name.

## One-time setup

Install Wrangler (Cloudflare's CLI) and log in:

```sh
pnpm add -D wrangler
pnpm wrangler login
```

Create the storage and the table:

```sh
pnpm wrangler r2 bucket create lumassets-wall          # keep it private (the default)
pnpm wrangler d1 create lumassets-wall                 # save the database_id it prints
```

Uncomment the D1 and R2 binding blocks in `wrangler.toml`, paste the real database ID, then run:

```sh
pnpm wrangler d1 migrations apply lumassets-wall --remote
```

**Turnstile**: Cloudflare dashboard → Turnstile → Add widget, with your site's domain (and
`localhost`). Put the **site key** in `turnstileSiteKey` in `src/site.ts` (the one there now is
Cloudflare's test key, which the API refuses outside localhost, so sharing stays off until you
replace it). Keep the **secret key** for the next step.

**Secrets** of the Pages project (Workers & Pages → lumassets → Settings → Variables and Secrets, or):

```sh
pnpm wrangler pages secret put ADMIN_TOKEN        # a long random password: openssl rand -base64 32
pnpm wrangler pages secret put TURNSTILE_SECRET   # the Turnstile secret key
```

The R2 and D1 bindings come from `wrangler.toml` (names `WALL` and `DB`). If the dashboard doesn't
show them, add them under Settings → Bindings with those names.

**Rate limit** against floods: Cloudflare dashboard → your domain → Security → WAF → Rate limiting
rules → Create rule: *URI Path equals `/api/wall`* and *Request Method equals `POST`*, 5 requests
per 10 minutes per IP, action Block. (The free plan includes one rule; this is the one to use it on.)

Deploy as usual (push to `main`). Then open `/wall/admin/`, paste the token, and approve.

## Trying it locally

Enable both binding blocks in `wrangler.toml` before running the local migration.

```sh
cp .dev.vars.example .dev.vars                     # test token + Cloudflare's always-pass Turnstile secret
pnpm wrangler d1 migrations apply lumassets-wall --local
pnpm dev:wall                                       # builds, then serves the site and /api on http://localhost:8788
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
