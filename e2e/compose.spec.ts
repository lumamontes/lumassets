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
  await expect(layers(page).first().getByRole('button')).toHaveAttribute('aria-pressed', 'true');
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

  await page.getByLabel('Background', { exact: true }).fill('#102030');
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

test('an excluded layer keeps its own ink, closed-area fill and background in exports', async ({ page }) => {
  await page.goto('/compose/');
  await page.locator('#own-file').setInputFiles({
    name: 'Closed square.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="20" y="20" width="60" height="60" fill="none" stroke="black" stroke-width="8"/></svg>'),
  });
  await expect(layers(page)).toHaveCount(1);
  await openSection(page, 'Look');
  await page.locator('#color').fill('#0044ff');
  await page.getByLabel('Fill color', { exact: true }).fill('#ffee11');
  await page.getByLabel('Layer background color', { exact: true }).fill('#22cc44');

  await page.getByRole('tab', { name: 'Everything' }).click();
  await addEffect(page, '#pane-all', 'RGB split');
  await openSection(page, 'Exclude layers');
  await page.getByRole('checkbox', { name: /Closed square/ }).check();
  await expect(page.getByRole('checkbox', { name: /Closed square/ })).toBeChecked();

  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG' }).click()]);
  const bytes = readFileSync((await png.path())!);
  const colors = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const surface = document.createElement('canvas');
    surface.width = image.naturalWidth;
    surface.height = image.naturalHeight;
    const ctx = surface.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const colors = new Set<number>();
    const pixels = ctx.getImageData(0, 0, surface.width, surface.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 255) colors.add(pixels[i] * 65536 + pixels[i + 1] * 256 + pixels[i + 2]);
    }
    return [0x0044ff, 0xffee11, 0x22cc44].map((color) => colors.has(color));
  }, bytes.toString('base64'));
  expect(colors).toEqual([true, true, true]);

  const [svg] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Export SVG')]);
  const text = readFileSync((await svg.path())!, 'utf8');
  expect(text).toContain('fill="#22cc44"');
  expect(text).toContain('data:image/png;base64,');
  expect(text).not.toContain('<g filter="url(#fx-all)">');
  await page.locator('#open').setInputFiles((await svg.path())!);
  await expect(page.locator('#status')).toHaveText('Opened the composition.');
  await layers(page).first().getByRole('button').click();
  await openSection(page, 'Look');
  await expect(page.getByLabel('Fill color', { exact: true })).toHaveValue('#ffee11');
  await page.getByRole('tab', { name: 'Everything' }).click();
  await openSection(page, 'Exclude layers');
  await expect(page.getByRole('checkbox', { name: /Closed square/ })).toBeChecked();
  await page.getByRole('button', { name: 'Add quadrado-1', exact: true }).click();
  await expect(layers(page)).toHaveCount(2);
  await expect(page.locator('.global-fx')).toBeVisible();
  const [mixed] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG' }).click()]);
  expect(readFileSync((await mixed.path())!).subarray(1, 4).toString()).toBe('PNG');
});

test('adding another drawing keeps the live canvas background with Everything effects', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(layers(page)).toHaveCount(1);
  await page.getByRole('tab', { name: 'Everything' }).click();
  await addEffect(page, '#pane-all', 'RGB split');

  const background = page.getByLabel('Background', { exact: true });
  const overlay = page.locator('.global-fx');
  await expect(overlay).toBeVisible();
  // A color picker can deliver a live input before its final change event.
  await background.evaluate((input: HTMLInputElement) => {
    input.value = '#102030';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(overlay).toHaveCSS('background-color', 'rgb(16, 32, 48)');

  await page.locator('#picker button').first().click();
  await expect(layers(page)).toHaveCount(2);
  await expect(background).toHaveValue('#102030');
  await expect(overlay).toHaveCSS('background-color', 'rgb(16, 32, 48)');

  const [saved] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Save file')]);
  const file = JSON.parse(readFileSync((await saved.path())!, 'utf8'));
  expect(file.canvas.background).toBe('#102030');
});

test('finishing a color pick cannot overwrite a different layer background', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(layers(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Add fofolete', exact: true }).click();
  await expect(layers(page)).toHaveCount(2);
  const picker = page.getByLabel('Layer background color', { exact: true });
  await openSection(page, 'Look');
  await picker.fill('#661177');
  await page.getByRole('tab', { name: 'Everything' }).click();
  await addEffect(page, '#pane-all', 'RGB split');
  await openSection(page, 'Exclude layers');
  await page.getByRole('checkbox', { name: /fofolete/ }).check();

  await layers(page).first().getByRole('button').click();
  await picker.evaluate((input: HTMLInputElement) => {
    input.value = '#ffffff';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await layers(page).last().getByRole('button').click();
  await expect(picker).toHaveValue('#661177');
  // Deliver the first layer's final picker event after the selection has moved.
  await picker.evaluate((input: HTMLInputElement) => {
    input.value = '#ffffff';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(picker).toHaveValue('#661177');
  const [saved] = await Promise.all([page.waitForEvent('download'), fromMore(page, 'Save file')]);
  const file = JSON.parse(readFileSync((await saved.path())!, 'utf8'));
  expect(file.layers.map((layer: { background: string }) => layer.background)).toEqual(['#ffffff', '#661177']);
});

test('Everything effects keep the selected layer outline and rotation handle visible', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(layers(page)).toHaveCount(1);
  await openSection(page, 'Make more');
  await page.getByRole('button', { name: 'Mirror left–right' }).click();
  await expect(layers(page)).toHaveCount(2);
  await page.getByRole('tab', { name: 'Everything' }).click();
  await addEffect(page, '#pane-all', 'RGB split');

  await layers(page).last().getByRole('button').click();
  await expect(page.locator('#layer-fields')).toBeEnabled();
  await expect(page.locator('.global-fx')).toBeVisible();
  await expect(page.locator('canvas.lower-canvas')).toHaveCSS('opacity', '0');
  const handles = page.locator('canvas.upper-canvas');
  await expect.poll(() => handles.evaluate((surface: HTMLCanvasElement) => {
    const pixels = surface.getContext('2d')!.getImageData(0, 0, surface.width, surface.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);

  const grip = await handles.evaluate((surface: HTMLCanvasElement) => {
    const { width, height } = surface;
    const pixels = surface.getContext('2d')!.getImageData(0, 0, width, height).data;
    const first = pixels.findIndex((value, index) => index % 4 === 3 && value > 100);
    if (first < 0) throw new Error('Selection controls are missing');
    const top = Math.floor(first / 4 / width);
    const xs = Array.from({ length: width }, (_, x) => x).filter((x) => pixels[(top * width + x) * 4 + 3] > 100);
    const rect = surface.getBoundingClientRect();
    return {
      x: rect.left + ((xs[0] + xs.at(-1)!) / 2) * rect.width / width,
      y: rect.top + top * rect.height / height + 12,
    };
  });
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 48, grip.y + 12, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#rotation')).not.toHaveValue('0');
});

test('refreshing Everything does not interrupt resizing a newly added layer', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(layers(page)).toHaveCount(1);
  await page.getByRole('tab', { name: 'Everything' }).click();
  await addEffect(page, '#pane-all', 'RGB split');
  const preview = page.locator('.global-fx img');
  await expect(preview).toBeVisible();

  const beforeAdd = (await preview.getAttribute('src'))!;
  await page.getByRole('button', { name: 'Add fofolete', exact: true }).click();
  await expect(layers(page)).toHaveCount(2);
  await expect(preview).not.toHaveAttribute('src', beforeAdd);
  const selected = layers(page).last().getByRole('button');
  await expect(selected).toHaveAttribute('aria-pressed', 'true');

  const corner = await page.locator('canvas.upper-canvas').evaluate((surface: HTMLCanvasElement) => {
    const { width, height } = surface;
    const pixels = surface.getContext('2d')!.getImageData(0, 0, width, height).data;
    const last = pixels.findLastIndex((value, index) => index % 4 === 3 && value > 100);
    if (last < 0) throw new Error('No resize handles');
    const pixel = Math.floor(last / 4);
    const rect = surface.getBoundingClientRect();
    return {
      x: rect.left + (pixel % width) * rect.width / width - 2,
      y: rect.top + Math.floor(pixel / width) * rect.height / height - 4,
    };
  });
  const size = page.locator('#scale');
  const original = Number(await size.inputValue());
  const beforeRefresh = (await preview.getAttribute('src'))!;
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  // Queue the same redraw that runs after a drawing is added, while the handle is held.
  await page.locator('#opacity').evaluate((input: HTMLInputElement) => {
    input.value = '0.9';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(preview).not.toHaveAttribute('src', beforeRefresh);
  await page.mouse.move(corner.x + 48, corner.y + 48, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => Number(await size.inputValue())).toBeGreaterThan(original);
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
});

test('a newly added layer stays selected if clicked while its image is loading', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(layers(page)).toHaveCount(1);
  const raster = await page.locator('#boot').evaluate((el) => JSON.parse(el.textContent!).assets.find((asset: { id: string }) => asset.id === 'av-02').raster);
  let releaseImage!: () => void;
  const loading = new Promise<void>((resolve) => { releaseImage = resolve; });
  await page.route(new URL(raster, page.url()).href, async (route) => {
    await loading;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Add fofolete', exact: true }).click();
    const added = layers(page).last().getByRole('button', { name: /fofolete/ });
    await expect(added).toHaveAttribute('aria-pressed', 'true');
    await added.click();
    await expect(added).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#layer-fields')).toBeEnabled();
  } finally {
    releaseImage();
  }
});

test('an SVG export stays tied to the artwork present when export starts', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(layers(page)).toHaveCount(1);
  const embed = await page.locator('#boot').evaluate((el) => JSON.parse(el.textContent!).assets.find((asset: { id: string }) => asset.id === 'sq3-19').embed);
  let finish!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const fetching = new Promise<void>((resolve) => { started = resolve; });
  await page.route(new URL(embed, page.url()).href, async (route) => {
    started();
    await pending;
    await route.continue();
  });
  const downloaded = page.waitForEvent('download');
  try {
    await fromMore(page, 'Export SVG');
    await fetching;
    await page.getByRole('button', { name: 'Add fofolete', exact: true }).click();
    await expect(layers(page)).toHaveCount(2);
  } finally {
    finish();
  }
  const svg = readFileSync((await (await downloaded).path())!, 'utf8');
  expect(svg).toContain('id="asset-sq3-19"');
  expect(svg.includes('id="asset-av-02"')).toBe(false);
  expect(svg.includes('href="undefined"')).toBe(false);
});

test('a slow drawing does not undo a size edit on a layer already on the canvas', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(layers(page)).toHaveCount(1);
  await openSection(page, 'Look');
  await page.locator('#color').fill('#e9009d');

  const countInk = () => page.locator('canvas.lower-canvas').evaluate((surface: HTMLCanvasElement) => {
    const pixels = surface.getContext('2d')!.getImageData(0, 0, surface.width, surface.height).data;
    let pink = 0;
    let black = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 190 && pixels[i + 1] < 40 && pixels[i + 2] > 110 && pixels[i + 2] < 190) pink++;
      if (pixels[i] < 30 && pixels[i + 1] < 30 && pixels[i + 2] < 30 && pixels[i + 3] > 240) black++;
    }
    return { pink, black };
  });
  await expect.poll(async () => (await countInk()).pink).toBeGreaterThan(100);
  const original = (await countInk()).pink;
  const raster = await page.locator('#boot').evaluate((el) => JSON.parse(el.textContent!).assets.find((asset: { id: string }) => asset.id === 'av-02').raster);
  let finish!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const fetching = new Promise<void>((resolve) => { started = resolve; });
  await page.route(new URL(raster, page.url()).href, async (route) => {
    started();
    await pending;
    await route.continue();
  });
  let blackBefore = 0;
  try {
    await page.getByRole('button', { name: 'Add fofolete', exact: true }).click();
    await fetching;
    await layers(page).first().getByRole('button').click();
    await openSection(page, 'Size & position');
    await page.locator('#scale').fill('0.55');
    await expect.poll(async () => (await countInk()).pink).toBeGreaterThan(original * 1.5);
    blackBefore = (await countInk()).black;
  } finally {
    finish();
  }
  await expect.poll(async () => (await countInk()).black).toBeGreaterThan(blackBefore + 150);
  expect((await countInk()).pink).toBeGreaterThan(original * 1.5);
  await expect(page.locator('#scale')).toHaveValue('0.55');
});

test('a PNG keeps its original layers while encoding even if Composer changes', async ({ page }) => {
  await page.goto('/compose/?add=sq3-19');
  await expect(layers(page)).toHaveCount(1);
  await page.getByRole('tab', { name: 'Everything' }).click();
  await addEffect(page, '#pane-all', 'RGB split');
  await expect(page.locator('.global-fx')).toBeVisible();

  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...options) {
      HTMLCanvasElement.prototype.toBlob = toBlob;
      const target = this;
      document.addEventListener('finish-test-encoding', () => toBlob.call(target, callback, ...options), { once: true });
      document.body.dataset.encodingPaused = 'true';
    };
  });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  try {
    await expect(page.locator('body')).toHaveAttribute('data-encoding-paused', 'true');
    await page.getByRole('button', { name: 'Add fofolete', exact: true }).click();
    await expect(layers(page)).toHaveCount(2);
  } finally {
    await page.evaluate(() => document.dispatchEvent(new Event('finish-test-encoding')));
  }
  await page.locator('#open').setInputFiles((await (await downloaded).path())!);
  await expect(page.locator('#status')).toHaveText('Opened the composition.');
  await expect(layers(page)).toHaveCount(1);
});
