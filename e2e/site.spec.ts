import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

const assets = JSON.parse(readFileSync('data/assets.json', 'utf8')) as { id: string; slug: string; name: string; status: string; collection: string }[];
const published = assets.filter((a) => a.status === 'published');
const drafts = assets.filter((a) => a.status !== 'published');
const sample = published.find((a) => a.id === 'sq3-19') ?? published[0];
const cells = 'ul#grid > li:visible';

test('home is the grid, without the editor bundle', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('lumassets · Drawings by Luma Montes');
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /I drew these little monsters/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/generated\/og\/site\.png\?v=drawings-by-luma$/);
  await expect(page.locator(cells)).toHaveCount(published.length);
  const scripts = await page.locator('script[src]').evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).src));
  expect(scripts.join(' ')).not.toMatch(/fabric|editor/i);
});

test('drafts are not shown', async ({ page }) => {
  await page.goto('/');
  for (const d of drafts) await expect(page.locator(`#grid > li[data-id="${d.id}"]`)).toHaveCount(0);
});

test('search and filters update the grid, the count and the URL', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Search assets').fill(sample.name);
  await expect(page.locator(cells).first()).toHaveAttribute('data-id', sample.id);
  await expect(page.locator('#count')).toContainText(`of ${published.length}`);
  await expect(page).toHaveURL(/\?q=/);

  await page.getByLabel('Search assets').fill('');
  await page.getByRole('button', { name: 'Quadrados 3' }).click();
  await expect(page.locator(cells)).toHaveCount(published.filter((a) => a.collection === 'quadrados-3').length);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Quadrados 3' })).toHaveAttribute('aria-pressed', 'true');

  // an open drawing that a filter hides closes, instead of lingering in the panel
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const inOne = published.find((a) => a.collection === 'quadrados-1')!;
  await page.goto(`/#${inOne.slug}`);
  await expect(page.locator('#panel')).toBeVisible();
  await page.getByRole('button', { name: 'Quadrados 1' }).click();
  await expect(page.locator('#panel')).toBeVisible();
  await page.getByRole('button', { name: 'Quadrados 3' }).click();
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page).not.toHaveURL(/#/);

  await page.getByLabel('Search assets').fill('zzzz-nothing');
  await expect(page.locator('#empty')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator(cells)).toHaveCount(published.length);
});

test('clicking a drawing opens the panel; keyboard moves and closes it', async ({ page }) => {
  await page.goto('/');
  await page.locator(`#grid > li[data-id="${sample.id}"] a`).click();
  const panel = page.locator('#panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(sample.name);
  await expect(page).toHaveURL(new RegExp(`#${sample.slug}$`));

  await page.keyboard.press('ArrowRight');
  await expect(panel.getByRole('heading', { level: 2 })).not.toHaveText(sample.name);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('a #slug link opens that drawing', async ({ page }) => {
  await page.goto(`/#${sample.slug}`);
  await expect(page.locator('#panel h2')).toHaveText(sample.name);
});

test('panel: one click to copy or download, in any colour', async ({ page, context, browserName }) => {
  await page.goto(`/#${sample.slug}`);

  const svg = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download SVG' }).click()]);
  expect(svg[0].suggestedFilename()).toBe(`lumassets-${sample.slug}.svg`);
  expect(readFileSync((await svg[0].path())!, 'utf8')).toContain('CC0 1.0');

  await page.getByRole('radio', { name: 'White' }).click();
  const png = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PNG' }).click()]);
  expect(png[0].suggestedFilename()).toMatch(new RegExp(`^lumassets-${sample.slug}-ffffff-\\d+\\.png$`));
  expect(readFileSync((await png[0].path())!).subarray(1, 4).toString()).toBe('PNG');

  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only here');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('radio', { name: 'Black' }).click();
  await page.getByRole('button', { name: 'Copy SVG' }).click();
  await expect(page.locator('#p-copy')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('<svg');
});

test('apply to all, and download everything shown as a ZIP', async ({ page }) => {
  await page.goto(`/#${sample.slug}`);
  await page.getByRole('radio', { name: 'White' }).click();
  await page.getByRole('button', { name: 'Apply to all' }).click();
  await expect(page.locator('#grid')).toHaveClass(/tinted/);
  await expect(page.getByRole('button', { name: /All in this color/ })).toBeVisible();

  await page.getByRole('button', { name: 'Quadrados 3' }).click();
  const shown = published.filter((a) => a.collection === 'quadrados-3').length;
  await page.locator('#zip > summary').click();
  await expect(page.locator('#zip-what')).toHaveText(`${shown} drawings, in #ffffff.`);
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download ZIP' }).click()]);
  expect(zip.suggestedFilename()).toBe('quadrados-3-ffffff-svg.zip');
  const bytes = readFileSync((await zip.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  // one entry per drawing, plus LICENSE.txt (count the central-directory headers)
  expect(bytes.toString('latin1').split('PK\x01\x02').length - 1).toBe(shown + 1);

  await page.getByRole('button', { name: /All in this color/ }).click();
  await expect(page.locator('#grid')).not.toHaveClass(/tinted/);
});

test('unknown pages return 404', async ({ page }) => {
  const res = await page.goto('/nothing-here/');
  expect(res?.status()).toBe(404);
});

for (const [name, path] of [['home', '/'], ['home with panel', `/#${sample.slug}`], ['about', '/about/'], ['compose', '/compose/']]) {
  test(`no serious accessibility issues: ${name}`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  });
}

test('the wall page explains itself when the API is not there (static preview)', async ({ page }) => {
  await page.goto('/wall/');
  await expect(page.getByRole('heading', { name: 'Wall' })).toBeVisible();
  await expect(page.locator('#state')).toHaveText(/isn't available|Nothing here yet/);
  await page.goto('/wall/admin/');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});

test('wall artwork opens in place, copies its own link, and restores focus on close', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: async () => { document.body.dataset.shareOpened = 'true'; } });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (url: string) => { document.body.dataset.copiedLink = url; } } });
  });
  const makePost = (id: string, title: string, author: string | null) => ({
    id, title, author, createdAt: '2026-11-22T00:00:00Z', width: 1600, height: 1000, image: '/favicon.svg',
  });
  await page.route('**/api/wall?limit=30', (route) => route.fulfill({
    json: { posts: [makePost('adyspfn372ys', 'eu na madrugada', 'luma faz um teste'), makePost('fghjkmn12345', 'Another drawing', null)] },
  }));
  await page.goto('/wall/');
  const first = page.locator('#wall .label').getByRole('link', { name: 'eu na madrugada' });
  await expect(first).toHaveAttribute('href', '/wall/post/adyspfn372ys/');
  await first.click();

  const viewer = page.getByRole('dialog', { name: 'eu na madrugada' });
  await expect(viewer).toBeVisible();
  await expect(page).toHaveURL(/\/wall\/$/);
  await expect(viewer.getByText('by luma faz um teste')).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Close artwork' })).toBeFocused();
  await expect(viewer.getByRole('link', { name: 'Remix' })).toHaveAttribute('href', '/compose/?wall=adyspfn372ys');
  await viewer.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(viewer.getByRole('status')).toHaveText('Link copied.');
  await expect(page.locator('body')).toHaveAttribute('data-copied-link', new URL('/wall/post/adyspfn372ys/', page.url()).href);
  await expect(page.locator('body')).not.toHaveAttribute('data-share-opened', 'true');

  await viewer.getByRole('button', { name: 'Next artwork' }).click();
  await expect(page.getByRole('dialog', { name: 'Another drawing' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(first).toBeFocused();
  await expect(page).toHaveURL(/\/wall\/$/);
});

test('touch Composer can add, size and export a drawing', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch coverage');
  await page.goto('/compose/');
  await page.getByRole('button', { name: 'Add fofolete', exact: true }).tap();
  const layer = page.locator('#layers > li').getByRole('button', { name: /fofolete/ });
  await expect(layer).toHaveAttribute('aria-pressed', 'true');
  await page.getByText('Size & position', { exact: true }).tap();
  await page.getByLabel('Size', { exact: true }).fill('0.5');
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG' }).tap()]);
  expect(readFileSync((await png.path())!).subarray(1, 4).toString()).toBe('PNG');
  await expect(layer).toHaveAttribute('aria-pressed', 'true');
});

test('public pages fit a 320 px screen without sideways scrolling', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Narrow phone coverage');
  await page.setViewportSize({ width: 320, height: 568 });

  async function expectNoOverflow() {
    const width = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(width.viewport).toBe(320);
    expect(width.content).toBe(width.viewport);
  }

  await page.goto('/');
  await expectNoOverflow();
  await page.locator('#grid .cell').first().tap();
  await expect(page.locator('#panel')).toBeVisible();
  await expectNoOverflow();
  for (const path of ['/compose/', '/wall/', '/about/']) {
    await page.goto(path);
    await expectNoOverflow();
  }
});

test('Google Analytics waits for opt-in and records generated downloads once', async ({ page, baseURL }) => {
  const production = 'https://lumassets.bibliotecadezines.workers.dev';
  await page.route(`${production}/**`, async (route) => {
    const relative = route.request().url().slice(production.length);
    await route.fulfill({ response: await route.fetch({ url: new URL(relative, baseURL).href }) });
  });
  await page.route('https://static.cloudflareinsights.com/**', (route) => route.abort());
  await page.route('https://www.googletagmanager.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }));

  await page.goto(production);
  await expect(page.getByRole('button', { name: 'Allow analytics' })).toBeVisible();
  const tag = page.locator('script[src*="googletagmanager.com"]');
  await expect(tag).toHaveCount(0);
  await page.getByRole('button', { name: 'No thanks' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Allow analytics' })).toBeHidden();
  await page.getByRole('button', { name: 'Analytics settings' }).click();
  await page.getByRole('button', { name: 'Allow analytics' }).click();
  await expect(tag).toHaveCount(1);
  await page.locator('#grid .cell').first().click();
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download SVG', exact: true }).click(),
  ]);
  const events = await page.evaluate(() => (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer
    .map((entry) => Array.from(entry)).filter(([command, name]) => command === 'event' && name === 'file_download'));
  expect(events).toEqual([['event', 'file_download', {
    file_name: 'library-drawing.svg', file_extension: 'svg', download_type: 'library-svg',
  }]]);
});
