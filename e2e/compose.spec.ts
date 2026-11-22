import { expect, test, type Page } from '@playwright/test';

/** Opens a collapsed section in the properties panel. */
const section = (page: Page, name: string) => page.locator('details.group > summary', { hasText: name }).first();
async function openSection(page: Page, name: string) {
  const s = section(page, name);
  if (!(await s.evaluate((el) => (el.parentElement as HTMLDetailsElement).open))) await s.click();
}
/** Adds an effect from the effect menu in a pane ('#pane-layer' or '#pane-all'). */
async function addEffect(page: Page, pane: string, label: string) {
  await page.locator(`${pane} .fx-picker > summary`).click();
  await page.locator(`${pane} .picker-grid`).getByRole('menuitem', { name: label, exact: true }).click();
}
import { readFileSync } from 'node:fs';
const published = (JSON.parse(readFileSync('data/assets.json', 'utf8')) as { id: string; name: string; status: string; version: string }[])
  .filter((a) => a.status === 'published');

const layers = (page: Page) => page.locator('#layers > li');
/** Clicks an item of the toolbar's "More" menu. */
async function fromMore(page: Page, name: string) {
  await page.locator('#more > summary').click();
  await page.locator('#more').getByRole('button', { name, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  // The editor asks before leaving with unsaved layers; accept so tests can navigate.
  page.on('dialog', (d) => d.accept());
});

test('adds an asset from a detail page link', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(layers(page)).toHaveCount(1);
  await expect(layers(page).first()).toContainText(published.find((a) => a.id === 'sq3-19')!.name);
  await expect(page).toHaveURL(/\/compose\/$/); // ?add= is cleaned up
});

test('add, duplicate, delete, undo and redo', async ({ page }) => {
  await page.goto('/compose/');
  await page.locator('#picker button').first().click();
  await expect(layers(page)).toHaveCount(1);

  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(layers(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(layers(page)).toHaveCount(1);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(layers(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(layers(page)).toHaveCount(1);
});

test('layer properties apply and are undoable', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(page.locator('#layer-fields')).toBeEnabled();
  await openSection(page, 'Look');
  await page.locator('#blend').selectOption('multiply');
  await expect(page.locator('#blend')).toHaveValue('multiply');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#blend')).toHaveValue('normal');
});

test('the toolbar: no title field, extra actions tucked in More', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(page.getByLabel('Composition title')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save file' })).toBeHidden();
  await page.locator('#more > summary').click();
  await expect(page.getByRole('button', { name: 'Save file' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Save file' })).toBeHidden();
});

test('exports PNG and SVG', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(layers(page)).toHaveCount(1);

  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG' }).click()]);
  expect(png.suggestedFilename()).toMatch(/^lumassets-\d{8}-\d{4}\.png$/);
  const pngBytes = readFileSync((await png.path())!);
  expect(pngBytes.subarray(1, 4).toString()).toBe('PNG');

  const [svg] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Export SVG')]);
  expect(svg.suggestedFilename()).toMatch(/^lumassets-\d{8}-\d{4}\.svg$/);
  const svgText = readFileSync((await svg.path())!, 'utf8');
  expect(svgText).toContain('<svg');
  expect(svgText).toContain('sq3-19');
  // traced drawings stay vectors inside the exported SVG
  expect(svgText).toContain('data:image/svg+xml');
  await expect(page.locator('#status')).toHaveText('Exported SVG.');
});

test('saves a composition file and opens it again', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(layers(page)).toHaveCount(1);

  const [saved] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Save file')]);
  const path = (await saved.path())!;
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  expect(doc.format).toBe('lumassets-composition');
  expect(doc.layers[0]).toMatchObject({ assetId: 'sq3-19', assetVersion: published.find((a) => a.id === 'sq3-19')!.version });
  expect(doc.provenance.assets[0].id).toBe('sq3-19');

  await fromMore(page, 'Clear canvas');
  await expect(layers(page)).toHaveCount(0);
  await page.locator('#open').setInputFiles(path);
  await expect(layers(page)).toHaveCount(1);
});

test('refuses a composition with a missing asset', async ({ page }) => {
  await page.goto('/compose/');
  const doc = {
    format: 'lumassets-composition', formatVersion: 1, title: 'Broken',
    canvas: { width: 800, height: 600, background: null },
    layers: [{ assetId: 'gone-99', assetVersion: '1.0.0', x: 1, y: 1, scale: 1, rotation: 0, opacity: 1, blendMode: 'normal', color: null }],
  };
  await page.locator('#open').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.locator('#status')).toContainText('gone-99');
  await expect(layers(page)).toHaveCount(0);
});

test('effects: add, tweak, shuffle, reorder, surprise, reset layer; they survive save and SVG export', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(page.locator('#layer-fields')).toBeEnabled();
  const fx = page.locator('#fx-list > li');

  await addEffect(page, '#pane-layer', 'Warp');
  await addEffect(page, '#pane-layer', 'Misprint');
  await expect(fx).toHaveCount(2);
  await fx.nth(0).getByRole('button', { name: /Switch off/ }).click();
  await expect(fx.nth(0)).toHaveClass(/off/);
  await fx.nth(0).getByRole('button', { name: /Switch on/ }).click();
  await expect(page.locator('#layer-fields')).toBeEnabled(); // the layer stays selected

  await fx.nth(1).getByRole('button', { name: /Move up/ }).click();
  await expect(fx.locator('.fx-name')).toContainText(['Misprint', 'Warp']);
  await fx.nth(0).getByRole('button', { name: /Shuffle/ }).click();
  await expect(fx).toHaveCount(2);

  await page.locator('#pane-layer').getByRole('button', { name: 'Surprise', exact: true }).click();
  await expect(fx).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(fx.locator('.fx-name')).toContainText(['Misprint', 'Warp']);

  const [svg] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Export SVG')]);
  const text = readFileSync((await svg.path())!, 'utf8');
  expect(text).toContain('<filter id="fx-0"');
  expect(text).toContain('feDisplacementMap');

  const [saved] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Save file')]);
  const doc = JSON.parse(readFileSync((await saved.path())!, 'utf8'));
  expect(doc.layers[0].effects.map((e: { type: string }) => e.type)).toEqual(['misprint', 'warp']);

  await page.getByRole('button', { name: 'Reset layer' }).click();
  await expect(fx).toHaveCount(0);
});

test('duplicated layers have their own effects', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await addEffect(page, '#pane-layer', 'Blur');
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await page.locator('#fx-list > li').first().getByRole('button', { name: /Remove/ }).click();
  await page.locator('#layers button').first().click(); // the original
  await expect(page.locator('#fx-list .fx-name')).toContainText(['Blur']);
});

test('generators: scatter, mirror and kaleidoscope make copies in one undo step', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  const layers = page.locator('#layers > li');
  await openSection(page, 'Make more');
  await page.getByLabel('Copies').fill('5');
  await page.getByRole('button', { name: 'Scatter', exact: true }).click();
  await expect(layers).toHaveCount(6);
  await page.getByRole('button', { name: 'Mirror left–right' }).click();
  await expect(layers).toHaveCount(7);
  await page.getByLabel('Kaleidoscope segments').fill('4');
  await page.getByRole('button', { name: 'Kaleidoscope' }).click();
  await expect(layers).toHaveCount(10);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(layers).toHaveCount(7);
});

test('effects on everything: preview, PNG and live SVG filter around all layers', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await openSection(page, 'Make more');
  await page.getByRole('button', { name: 'Mirror left–right' }).click();
  await page.getByRole('tab', { name: 'Everything' }).click();
  await addEffect(page, '#pane-all', 'RGB split');
  await expect(page.locator('#gfx-list .fx-name')).toContainText(['RGB split']);
  await expect(page.locator('.global-fx')).toBeVisible();
  await page.getByRole('tab', { name: 'Layer', exact: true }).click();
  await expect(page.locator('#layer-fields')).toBeEnabled(); // selection kept

  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG' }).click()]);
  expect(readFileSync((await png.path())!).subarray(1, 4).toString()).toBe('PNG');
  const [svg] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Export SVG')]);
  expect(readFileSync((await svg.path())!, 'utf8')).toContain('<g filter="url(#fx-all)">');

  const [saved] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Save file')]);
  expect(JSON.parse(readFileSync((await saved.path())!, 'utf8')).effects[0].type).toBe('rgbsplit');
});

test('your own drawings: added, edited, saved inside the file and reopened', async ({ page }) => {
  await page.goto('/compose/');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>alert(1)</script><path d="M10 80 50 10 90 80Z" fill="none" stroke="#000" stroke-width="6"/></svg>';
  await page.locator('#own-file').setInputFiles({ name: 'my-triangle.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await expect(page.locator('#own-picker li')).toHaveCount(1);
  await expect(page.locator('#layers > li')).toHaveCount(1);
  await expect(page.locator('#status')).toContainText('my triangle');
  await addEffect(page, '#pane-layer', 'Pixelate');

  const [saved] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Save file')]);
  const file = JSON.parse(readFileSync((await saved.path())!, 'utf8'));
  expect(file.ownAssets).toHaveLength(1);
  expect(file.ownAssets[0].vector).toBe(true);
  expect(Buffer.from(file.ownAssets[0].data.split(',')[1], 'base64').toString()).not.toContain('<script');

  // a fresh page has never seen the drawing: the file brings it along
  await page.goto('/compose/');
  await page.locator('#open').setInputFiles((await saved.path())!);
  await expect(page.locator('#layers > li')).toHaveCount(1);
  await expect(page.locator('#own-picker li')).toHaveCount(1);
});

test('colors: background and ink for all from the bar, live while picking', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await page.locator('details.group > summary', { hasText: 'Make more' }).click();
  await page.getByRole('button', { name: 'Mirror left–right' }).click();
  await expect(page.locator('#layers > li')).toHaveCount(2); // the list is always visible

  await page.getByLabel('Background').fill('#102030');
  await page.getByLabel('Ink for all').fill('#ff0000');
  const [saved] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Save file')]);
  const file = JSON.parse(readFileSync((await saved.path())!, 'utf8'));
  expect(file.canvas.background).toBe('#102030');
  expect(file.layers.map((l: { color: string }) => l.color)).toEqual(['#ff0000', '#ff0000']);

  await page.getByRole('button', { name: 'Original ink' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#status')).toContainText('Undone');
});

test('ink for all also colours drawings added afterwards, until Original ink', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await page.getByLabel('Ink for all').fill('#ff0000');
  await page.locator('#picker button').first().click();
  await expect(page.locator('#layers > li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Original ink' }).click();
  await page.locator('#picker button').first().click();
  await expect(page.locator('#layers > li')).toHaveCount(3);
  const [saved] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Save file')]);
  const file = JSON.parse(readFileSync((await saved.path())!, 'utf8'));
  expect(file.layers.map((l: { color: string | null }) => l.color)).toEqual([null, null, null]);
});

test('ink for all is kept for new drawings', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await page.getByLabel('Ink for all').fill('#ff0000');
  await page.locator('#picker button').first().click();
  await page.locator('#picker button').nth(1).click();
  await expect(page.locator('#layers > li')).toHaveCount(3);
  const [saved] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Save file')]);
  const file = JSON.parse(readFileSync((await saved.path())!, 'utf8'));
  expect(file.layers.map((l: { color: string | null }) => l.color)).toEqual(['#ff0000', '#ff0000', '#ff0000']);
});

test('exported PNGs say where they come from and open here again', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG' }).click()]);
  const bytes = readFileSync((await png.path())!);
  expect(bytes.includes(Buffer.from('lumassets composer'))).toBe(true);
  expect(bytes.includes(Buffer.from('/compose/'))).toBe(true);

  await page.goto('/compose/');
  await page.locator('#open').setInputFiles((await png.path())!);
  await expect(page.locator('#status')).toHaveText('Opened the composition.');
  await expect(page.locator('#layers > li')).toHaveCount(1);
});

test('share: a dialog with a preview, sent only after consent and the spam check', async ({ page }) => {
  // stand-in for Cloudflare Turnstile (the real one needs the network and a real key)
  await page.route('https://challenges.cloudflare.com/**', (r) =>
    r.fulfill({ contentType: 'text/javascript', body: "window.turnstile={render:(el,o)=>{setTimeout(()=>o.callback('t'),10);return 'w'},reset(){}}" }));
  await page.goto('/compose/?add=sq3-19');
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share on the wall' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#share-preview')).toHaveAttribute('src', /^blob:/);
  await expect(dialog.getByRole('button', { name: 'Send' })).toBeDisabled();
  await dialog.getByLabel(/OK to show this publicly/).check();
  await expect(dialog.getByRole('button', { name: 'Send' })).toBeEnabled();
  // `astro preview` has no /api (that's Cloudflare): sending fails politely
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog.locator('#share-status')).not.toHaveText(/Sent!/);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
