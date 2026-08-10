# How to Make a Zine

An 8-page mini zine about making 8-page mini zines, built with this project.

| File | What it is |
| --- | --- |
| `how-to-make-a-zine.pdf` | Eight panel-sized pages in reading order |
| `how-to-make-a-zine-imposed.pdf` | The same, fold-ready on one sheet of Letter |

**To print:** open the imposed file, print **single-sided at 100% / Actual Size**,
fold in half three times, cut the dashed line, and collapse it so page 1 faces out.

Rebuild with `npm run example` from the repo root.

## The joke that had to be true

The page-order map on page 4 is not drawn by hand. It is rendered from
`planMini8` — the same function the site uses — so the panel positions, the
inverted top row and the position of the slit all come from the code. A zine
that teaches you the layout cannot end up teaching a stale one.

Page 8 relies on a real property of this fold: an 8-page mini zine uses only one
side of the sheet, so the back of the zine you are holding is blank. That is
your next zine.

## Adding artwork

The zine is complete as it stands — every page is set, and without images the
space goes back to the text. But zines want pictures. Drop files in `images/`
and they are picked up automatically on the next `npm run example`:

| File | Where | Shape | Suggested pixels (300 dpi) |
| --- | --- | --- | --- |
| `cover.png` or `.jpg` | Behind the title, full bleed at 50% over black | portrait, about 2:3 | 825 × 1275 |
| `collage.png` or `.jpg` | Page 5, under the list | landscape, about 2.4:1 | 690 × 290 |
| `stack.png` or `.jpg` | Page 7, under the list | landscape, about 2.7:1 | 690 × 260 |

What suits it: **high-contrast black and white**. The whole zine is set for a
photocopier, so mid-greys will mush. Line art, hard-threshold photos, scanned
texture and cut-paper collage all work; soft gradients do not. The cover image
sits at half opacity over black, so something graphic and simple reads best —
busy photographs disappear.

If you want a slot removed rather than filled, delete its `optionalImage` call
in `build.ts`; the layout closes up on its own.
