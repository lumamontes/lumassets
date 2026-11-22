# Adding new drawings

This guide covers the whole path, from a drawing in your notebook to the drawing on the live site. Follow it top to bottom the first time. After that, the [short version](#the-short-version) at the end is usually enough.

```text
 notebook ──▶ scan/photo ──▶ scans/inbox/ ──▶ quick-editor ──▶ data/assets.json ──▶ pnpm dev ──▶ git push
                 (1)            (2)          (3) frame, clean,   (4) description,    (5) check     (6) Cloudflare
                                                 cut, save         status published                   deploys
```

What you end up with for every drawing:

| File | What it is | Committed? |
| --- | --- | --- |
| `assets/vector/<id>.svg` | The drawing as a clean vector: ink only, transparent, recolourable. This is what the site uses. | yes |
| `assets/originals/<collection>/<id>.png` | The cleaned ink at full resolution (black on transparent), kept so it can be traced again later. | yes |
| `data/assets.json` | One catalog entry: id, name, description, tags, collection, status. | yes |
| `scans/<photo>.studio.json` | Your quick-editor progress on that photo (frame, settings, pieces). | local only |
| `scans/inbox/<photo>` | The photo or scan itself. Large files. | **no** (keep a copy in Documents) |

---

## 0. One-time setup

You only do this once per computer.

```sh
brew install uv potrace                          # Python runner + the tracer
uv tool install --editable ~/www/quick-editor    # installs the `quick-editor` command
cd ~/www/lumassets && pnpm install               # the site's packages
```

To check that it worked, both commands below should print something rather than "command not found":

```sh
quick-editor --help
potrace --version
```

After you update the quick-editor code (for example from a new zip), run `uv tool install --editable ~/www/quick-editor --force` again.

---

## 1. Get a good image of the drawing

This is the step that decides the quality. Nothing later can add detail that the scan or photo doesn't have.

### The one rule: 600 px

Every published drawing must come from **at least 600 pixels** across its longest side (`quality.minSourcePixels` in `data/collections.json`). Below that, thin lines merge and edges get blocky. The build refuses to publish smaller drawings unless you mark them as an exception (see [step 7](#7-if-a-drawing-is-under-600-px)).

What decides the pixels is **how big the drawing is on paper** and **the scan resolution**:

```text
pixels = size on paper in cm × dpi ÷ 2.54
```

| Drawing size on paper | at 200 dpi | at 300 dpi | at 600 dpi |
| --- | --- | --- | --- |
| 2 cm | 157 px ❌ | 236 px ❌ | 472 px ❌ (photograph it close up) |
| 3 cm | 236 px ❌ | 354 px ❌ | 709 px ✅ |
| 5 cm | 394 px ❌ | 591 px ❌ | 1181 px ✅ |
| 8 cm | 630 px ✅ | 945 px ✅ | 1890 px ✅ |
| a whole A4 page | 2338 px ✅ | 3507 px ✅ | 7016 px ✅ |

**So: scan at 600 dpi.** Most scanner apps default to 200 or 300 dpi, which is why many of the older Quadrados drawings are under the bar.

### With the scanner (best)

1. Put the page face down, flat, against the corner guides. Close the lid so the page doesn't curl.
2. In the scanner app (Image Capture on the Mac, or the printer's app):
   - **Resolution: 600 dpi.**
   - **Kind: Color** or **Grayscale**. Not "Black & white / text": that throws away the soft edges the tracer needs.
   - **Format: PNG or TIFF.** Avoid JPEG (it adds blotches around lines) and avoid PDF (quick-editor can't open PDFs).
   - Scan the whole page. Turn off "auto-crop" or "detect separate items".
3. Save it somewhere permanent first, for example `~/Documents/scans/`. That's your backup: the inbox isn't committed to git.

### With the phone (when there's no scanner around)

- Daylight from a window, no flash, no shadow of the phone or your hand on the page.
- Hold the phone parallel to the page, straight above it.
- **Get close.** The drawing should fill most of the photo. For small drawings, take one photo per drawing instead of one per page.
- Use the normal camera at full resolution (HEIC or JPG are both fine). Don't send it to yourself through WhatsApp or similar: they shrink and recompress photos. AirDrop it, or use iCloud Photos with "Download originals".

### Things that help

- **Dark pen** traces much better than pencil. Faint pencil works, but needs the "Faint lines" slider and gets a bit grainy.
- Show-through from the other side of the page, spiral binding and fingers can all be erased in quick-editor, but it's quicker if they're not in the picture.
- If you already cut a drawing out in Affinity, **don't use the cut-out**: use the scan it came from. Affinity's SVG export just wraps the pixels it already had (often a smaller copy). If the cut-out is all you have, export it as a **PNG at 100% size** and use that.

---

## 2. Put it in the inbox

Copy the scan or photo into:

```text
~/www/lumassets/scans/inbox/
```

- Any of JPG, PNG, HEIC, AVIF, TIFF, WebP works.
- Name it so you can find it again later, e.g. `monstrinhos-2-600dpi.png`. Avoid renaming it after you start working on it: the progress file in `scans/` is matched by name.
- The inbox is in `.gitignore` on purpose (scans are big). Keep your own copy.

---

## 3. Cut the drawings out with quick-editor

```sh
cd ~/www/lumassets
quick-editor          # or: pnpm studio
```

It opens <http://localhost:4400> in the browser. Pick your photo in the left sidebar. There are four steps along the top.

> Everything is saved as you go (into `scans/<photo>.studio.json`). You can close the tab or stop the command (`Ctrl+C`) at any point and pick up later.

### 3.1 Frame

Tell it where the page is, so it can straighten it.

1. Click **Auto-detect page**. It usually finds the paper's edges.
2. If it's wrong, drag the four corner handles onto the page's corners yourself.
3. For a flat scan, **Whole photo** is fine (the scan is already straight).
4. If the photo is sideways, click **Rotate ⟳** until it's upright.
5. **Next: clean →**

### 3.2 Clean

You're turning "paper + ink + shadows" into "ink only". The preview shows what will count as ink.

Start with the defaults, or **Use last settings** if the previous photo was similar. Then only touch what looks wrong:

| You see… | Move this |
| --- | --- |
| Shadows or a grey gradient turning into black blobs | **Lighting** towards "local" |
| Paper texture or noise showing up as dots | **Grain smoothing** up a bit, and/or **Remove specks** up |
| Faint lines breaking up or disappearing | **Sensitivity** up, and **Faint lines** up |
| Show-through from the back of the page appearing | **Faint lines** down |
| Lines too thin or too thick compared to the paper | **Line weight** |
| White chalk/pen on black paper | **Light ink on dark surface** |

Then fix whatever the sliders can't, using **Areas**:

- **Erase area**: click points around something to remove (spiral binding, a finger, a note in the margin), click the first point to close the shape. `Backspace` undoes a point, `Esc` cancels.
- **Keep only area**: the opposite, only ink inside the shape is kept (handy for a page that curls at the edges).

**Next: pieces →**

### 3.3 Pieces

Each piece becomes one asset on the site.

1. Click **Detect pieces**. It draws a box around each group of strokes.
2. Fix the boxes:
   - **Delete** boxes around things that aren't drawings (smudges, the page edge, text).
   - **Merge** pieces that belong together. Select one, shift-click the others, then Merge. A common case is a drawing that isn't one connected line, like a square with a separate shape inside it, or a face whose eyes don't touch the outline: detection splits those.
   - A drawing was missed? Use the **Box** tool and drag a box around it, or the **Lasso** tool to click points around an odd shape (useful when drawings overlap).
   - Drag a box to move it, drag its corners to resize.
3. **Only this piece's strokes** (on by default) ignores bits of *neighbouring* drawings that poke into the box. Turn it **off** for a piece made of several unconnected parts (otherwise only the biggest part is kept).
4. Want the whole page as an asset too, like "quadrados-1, página inteira"? Draw one more box around everything and turn "Only this piece's strokes" off for it.
5. If detection splits or joins too much, play with **Group strokes closer than** and **Ignore pieces smaller than**, then Detect again.

**Next: review →**

### 3.4 Review & save

Each piece is traced into a vector and shown on a checkerboard (try **Dark** and **Cutout** too, to spot stray specks).

For each piece:

- **Name**: what people see on the site. Current placeholder style: `quadrado-59`, `monstrinho-7`, `avulso-3`. For a whole page: `monstrinhos-2, página inteira`. You can rename later.
- **Tags**: a few words separated by commas: `head, bust, fangs`. They're used by search. Add `full-page` for a whole page (those are listed last in the grid).
- **Collection**: which group it goes in (the chips at the top of the grid). To start a new one, choose **New collection…**, give it a name (e.g. `Monstrinhos 2`) and a short id prefix (e.g. `mon2`). New collections get the same CC0 license as the others.
- **Replaces**: leave on "nothing (new asset)". Only use it to give an *existing* drawing a better scan (see [Variants](#a-a-better-scan-of-a-drawing-thats-already-on-the-site)).
- **Tracing**: sharp corners ↔ round curves. The default is fine for pen lines.
- **Also save a solid backing shape**: optional. Saves an extra silhouette, like a paper cut-out, for placing over busy backgrounds.

Look out for the yellow warning **"Only N px across (aim for 600+)"**. It means this drawing will be blocked from publishing (see [step 7](#7-if-a-drawing-is-under-600-px)). Better to fix it now with a closer photo or a 600 dpi scan.

Untick pieces you don't want, then click **Save checked pieces**. For each piece it:

- writes `assets/vector/<id>.svg` and `assets/originals/<collection>/<id>.png`;
- adds an entry to `data/assets.json` with `"status": "draft"` and an id like `mon-07` (the collection prefix + the next number).

Drafts never appear on the site, so it's safe to save, look, and redo.

---

## 4. Finish the catalog entry

Open `data/assets.json` in your editor. New entries are at the **end** of the file. A freshly saved one looks like this:

```json
{
  "id": "mon-07",
  "name": "monstrinho-7",
  "slug": "monstrinho-7",
  "description": "",
  "aliases": [],
  "tags": ["head", "horns"],
  "collection": "monstrinhos",
  "sourcePath": "assets/vector/mon-07.svg",
  "originalPath": "assets/originals/monstrinhos/mon-07.png",
  "format": "svg",
  "width": 812,
  "height": 990,
  "viewBox": "0 0 812 990",
  "fileSize": 48211,
  "containsRaster": false,
  "license": "inherit",
  "version": "1.0.0",
  "status": "draft",
  "provenance": { "photo": "scans/inbox/monstrinhos-2-600dpi.png", "pixels": 990, "...": "..." }
}
```

Change only these:

| Field | What to do |
| --- | --- |
| `description` | **Required to publish.** One short sentence about what's in the drawing, e.g. `"A round head with two little horns and a crooked smile."` Shown in the side panel and used by search and screen readers. |
| `name` | Change if you like. |
| `slug` | The drawing's link on the site (`lumassets…/#monstrinho-7` opens its panel). Lowercase letters, numbers and single dashes only. Keep it matching the name. Must be unique. |
| `tags` | Fix or add. Lowercase. |
| `aliases` | Other words people might search for, e.g. the file's old name: `["Documento34", "chapéu"]`. Can stay `[]`. |
| `status` | `"draft"` → **`"published"`** when you're happy with it. |

Don't touch: `id` (it's permanent once published: links and other people's compositions point to it), `sourcePath`, `originalPath`, `width`, `height`, `viewBox`, `fileSize`, `containsRaster`, `version`, `provenance`. quick-editor fills those in.

> JSON is picky: every entry is separated by a comma, the last one has no comma after it, and all text is in "double quotes". If the check in the next step says "Unexpected token", look for a missing or extra comma near the line it mentions.

---

## 5. Check it

```sh
pnpm check:catalog
```

It prints `Catalog OK: … published …`, or a list of problems. The usual ones:

| Message | Fix |
| --- | --- |
| `missing "description"` | Write the description (step 4). |
| `duplicate slug "…"` | Two entries have the same slug: change one. |
| `invalid slug` | Only `a-z`, `0-9` and single dashes, no spaces or accents. |
| `source file not found` | The SVG isn't where `sourcePath` says. Did you move or rename it? |
| `traced from only N px` / quality error | See [step 7](#7-if-a-drawing-is-under-600-px). |
| `unknown collection "…"` | The `collection` id doesn't exist in `data/collections.json`. |
| `catalog size … != source …` (warning) | The SVG was changed by hand. Copy the numbers it suggests into the entry. |

Then look at it for real:

```sh
pnpm dev
```

Open <http://localhost:4321> and check that:

- [ ] it's in the grid, under its collection's chip;
- [ ] it looks right at full size: click it, look for stray specks and broken lines;
- [ ] recolouring it in the side panel works (if part of it stays black, there's something odd in the SVG);
- [ ] the SVG and PNG downloads open;
- [ ] in **Compose**, it's in the asset list and can be added to the canvas.

Something looks off (a speck, a missing line, the neighbour's arm in the corner)? Go back to quick-editor, open the same photo (your boxes and settings are still there), fix it, and save again. It updates the same entry: you don't get a duplicate.

Stop the dev server with `Ctrl+C`.

---

## 6. Publish

Run all the checks the deploy would run (build, unit tests, links, browser tests):

```sh
pnpm verify
```

Then commit and push:

```sh
git add assets data
git status                      # look: no files from scans/inbox should be listed
git commit -m "Add monstrinho-7 and monstrinho-8"
git push
```

Cloudflare Pages builds and deploys the site from the push, usually in a few minutes. Check the deploy in the Cloudflare dashboard (Workers & Pages → lumassets → Deployments), then open the live site and find the new drawing.

---

## 7. If a drawing is under 600 px

The build stops with an error naming the drawing. You have three options, best first:

1. **Rescan or rephotograph it** (600 dpi, or the phone closer), put the new file in `scans/inbox/`, and run:

   ```sh
   quick-editor refit mon-07            # preview: finds the drawing in the new photo, opens a before/after page
   quick-editor refit mon-07 --apply    # writes the new vector and updates the entry
   ```

   refit finds the drawing in the new photo by itself, even if it's rotated or at an angle, and only uses it if it has more pixels than before. Run it without an id to do every published drawing at once.

2. **Publish it anyway**, on purpose, by adding a `qualityException` with a reason to its entry:

   ```json
   "qualityException": "Traced from only 490 px: needs a 600 dpi scan."
   ```

   The build then lets it through and lists it as a warning every time, so it doesn't get forgotten. `refit` removes the exception by itself once a better scan fixes the drawing.

3. **Leave it as a draft** until you have a better scan.

---

## Variants

### A. A better scan of a drawing that's already on the site

Two ways, same result (new vector, same id, version bumped, old file listed in `previousSources`):

- **Automatic**: put the scan in `scans/inbox/` and run `quick-editor refit <id> --apply` (as in step 7).
- **By hand**: cut it out in quick-editor as usual, and in Review set **Replaces** to the existing drawing. Its name, tags, description and status stay as they were.

### B. A drawing you already cut out or made digitally

If it's a clean PNG (black lines on white or on transparent), put it in `scans/inbox/` and go through quick-editor as usual: choose **Whole photo** in Frame, the defaults in Clean, and one box in Pieces. The 600 px rule still applies to the PNG's size.

### C. A new collection by hand

Normally quick-editor does this (New collection… in Review). By hand, add an entry to `"collections"` in `data/collections.json`, copying an existing one:

```json
{
  "id": "monstrinhos-2",
  "name": "Monstrinhos 2",
  "description": "",
  "license": "CC0 1.0",
  "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
  "attribution": "Luma Montes",
  "version": "0.1.0",
  "idPrefix": "mon2"
}
```

`id` is used in addresses and in each asset's `collection`. `name` is what the chip shows. `idPrefix` starts the asset ids (`mon2-01`, `mon2-02`…) and must not be used by another collection. The order of collections in this file is the order of the chips.

### D. Hiding or removing a drawing

Set its `status` to `"draft"` (hidden for now) or `"rejected"` (not wanted). Don't delete the entry and **never reuse its id** for another drawing: old links and shared compositions point to it.

### E. Renaming

Change `name` and `slug` freely, and add the old name to `aliases` so search still finds it. The id stays.

---

## Troubleshooting

| Problem | What to do |
| --- | --- |
| `quick-editor: command not found` | Run the install from [step 0](#0-one-time-setup). If it was installed, open a new terminal tab. |
| `potrace not found` | `brew install potrace` |
| My photo isn't in the sidebar | It has to be directly in `scans/inbox/` (not in a subfolder) and be an image (no PDF). Reload the page. |
| quick-editor opens but shows another project | Run it from inside `~/www/lumassets` (it reads `quick-editor.toml` from there). |
| Port 4400 already in use | Another quick-editor is still running: stop it with `Ctrl+C` in its terminal, or run `quick-editor --port 4401`. |
| The trace is blobby, lines merged | Too few pixels: get a closer photo or a 600 dpi scan. Or try **Line weight** a bit thinner. |
| The trace has holes, lines broken | **Sensitivity** and **Faint lines** up in Clean. Pencil? Go over it in pen. |
| Lots of tiny dots | **Remove specks** up, or erase them with an Erase area. |
| A drawing came out in several pieces | Merge them in Pieces (or one box with "Only this piece's strokes" off). |
| `pnpm check:catalog` fails with a JSON error | A comma or a quote in `data/assets.json`. The message gives the line number. |
| The new drawing isn't on the site | Is `status` `"published"`? Restart `pnpm dev`. Check the collection chip you're on. |
| The live site doesn't have it | Did `git push` go through? Is the Cloudflare deploy finished and green? |

---

## The short version

```sh
# 1. scan at 600 dpi, PNG → copy to ~/www/lumassets/scans/inbox/
cd ~/www/lumassets
quick-editor                 # 2. frame → clean → pieces → review: name, tags, collection → Save
# 3. data/assets.json: description + "status": "published"
pnpm check:catalog && pnpm dev   # 4. look at it on localhost:4321
pnpm verify                  # 5. everything green?
git add assets data && git commit -m "Add …" && git push
```
