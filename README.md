# zine-fold

**[zine-fold.com](https://zine-fold.com)**

Turns a PDF into a **fold-ready** PDF: one output page per side of paper, already
imposed. You print it 1-per-sheet with plain duplex — no "multiple pages per
sheet", no booklet mode, nothing for the print driver to get wrong.

Five layouts, grouped by finished page size.

**Mini zines** — eight panels to a sheet side, so pages are an eighth of the
sheet (2.75 × 4.25 in from Letter):

| Layout | Sheets | Sides | Result |
| --- | --- | --- | --- |
| **8-page** | 1 per zine | single-sided | Classic fold-and-slit pocket zine |
| **12-page** | 1 per zine | duplex | 4×2 per side, 3 cuts, 4 hidden faces |

**Micro zines** — sixteen panels to a sheet side, so pages are a sixteenth
(2.13 × 2.75 in from Letter), on portrait stock:

| Layout | Sheets | Sides | Result |
| --- | --- | --- | --- |
| **16-page, River Cut** | 1 per zine | single-sided | 4×4 grid, 3 slits, snaking route |
| **16-page, -Ɪ- cut** | 1 per zine | single-sided | 4×4 grid, 5 slits, spiral route |

**Half-sheet** — two panels to a sheet side, for something closer to a book:

| Layout | Sheets | Sides | Result |
| --- | --- | --- | --- |
| **Booklet** | 1..N | duplex | Saddle-stitched, 1..N signatures |

It runs entirely in the browser. Nothing is uploaded; the PDF never leaves the
machine, which also means there's no file size limit and it works offline.

That last part is enforced, not just intended — see [Privacy](#privacy).

---

## Running it

### Locally

```sh
npm install
npm run dev          # http://localhost:5173
```

### Cloudflare (primary)

The app is a pile of static files, so it deploys as an assets-only Worker — no
server code, no bindings, free tier.

```sh
npx wrangler login     # once
npm run deploy         # build + publish -> https://zine-fold.com
npm run deploy:preview # publish a preview URL without touching production
```

`wrangler.jsonc` points at `dist/`. Response headers live in `public/_headers`,
which Vite copies into the build and Cloudflare parses at upload time.

Three hostnames serve the app:

| Hostname | Source |
| --- | --- |
| `zine-fold.com` | Custom Domain, canonical |
| `www.zine-fold.com` | Custom Domain |
| `zine-fold.dusty-jewett.workers.dev` | `workers_dev: true` |

The first two are declared as Custom Domains in `wrangler.jsonc` rather than only
in the dashboard, so routing lives in version control and a fresh `wrangler
deploy` reproduces it. The Worker *is* the origin, so Cloudflare owns the DNS
records and certificates — nothing to set up by hand.

The zone has to exist in the same Cloudflare account before a Custom Domain
route will deploy; a route pointing at an unknown zone fails the deploy. Newly
created hostnames also take a few minutes to resolve and get a certificate, so a
handshake failure right after a deploy is usually just provisioning.

`index.html` carries a canonical link to the apex, which keeps search engines
from treating www as a duplicate. If you want www to actually *redirect*, add a
Redirect Rule in the dashboard (**Rules → Redirect Rules**,
`www.zine-fold.com/*` → `https://zine-fold.com/$1`, 301) — that is zone config,
not something wrangler owns. Setting `workers_dev: false` drops the
`workers.dev` alias if you'd rather have fewer public URLs.

### Self-hosting via Docker (alternative)

Still supported if you want it on the NAS, or offline:

```sh
docker compose up -d --build     # http://<nas>:8088
```

`nginx.conf` mirrors the headers from `public/_headers`. Change the host port in
`docker-compose.yml` if 8088 is taken. There's no backend, no volume, no state —
updating is just a rebuild.

---

## Printing

**Print at 100% / "Actual Size".** Every print dialog defaults to some flavour of
"fit to page", which shrinks the sheet a few percent and pulls your margins off
the fold lines. This is the single most common way to get a wonky zine.

The output pages are already the size of the paper you picked, oriented the way
that layout needs — landscape for the 8-page zine and the booklet, portrait for
the two 16-page folds. Let the driver place them; don't override the orientation
yourself. The picker under *Paper* shows the sheet and finished page size.

### Mini and micro zines

The 8-page and both 16-page folds are single-sided — nothing else to configure.
The 12-page mini zine is duplex; treat it like the booklet below.

### Booklet

Print **double-sided**, and match the app's *Printer flip setting* to what your
driver actually does:

- **Flip on short edge** — the usual correct choice for landscape sheets. Backs
  come out upright, so the app doesn't rotate them.
- **Flip on long edge** — the app pre-rotates every back side 180° to compensate.

If a test fold comes out with every other side upside down, **change the setting
in the app, not the printer.** Both settings produce a correct booklet from the
same printer configuration; they just move the compensation around.

If duplex misbehaves entirely, set *Output* to **Two files, for manual duplex**:
print the fronts, flip the stack, print the backs.

---

## Check it before you print 40 pages

Hit **Test document**. You get a numbered PDF sized exactly to one panel of the
current layout. Load it back in, print, fold. If the pages read 1, 2, 3, … in
order and none are upside down, your settings are right.

*Length* defaults to exactly one zine or signature. Choosing 8, 16, 24 or 32
instead lets you check a run that spans several — the covers are marked per
zine, so you can see where each one starts and ends, and the last zine pads
with blanks. 24 pages in a 16-page layout is the awkward case worth trying.

This is worth doing once per printer. It is much faster than reasoning about
duplex flip conventions, and it's the ground truth if anything below disagrees
with your paper.

---

## Folding the 8-page mini zine

The sheet is laid out as four columns by two rows, with the top row printed
upside down:

```
         col 0     col 1     col 2     col 3
      +---------+---------+---------+---------+
row 0 |    5    |    4    |    3    |    2    |   prints upside down
      +---------+~~~~~~~~~~~~~~~~~~~+---------+   cut these two panels only
row 1 |    6    |    7    |    8    |    1    |
      +---------+---------+---------+---------+

      ---  fold        ~~~  cut
```

Page 1 is the front cover, bottom right.

1. Crease all eight panels: fold in half left-to-right, again left-to-right,
   then once top-to-bottom. Unfold.
2. Fold in half top-to-bottom and **cut the marked line** — the middle half of
   the folded edge. Unfold.
3. Fold top-to-bottom again, with the `6 7 8 1` row facing out.
4. Push the left and right ends toward each other. The slit opens into a plus
   shape; collapse it so page 1 lands on the front.

A document longer than 8 pages becomes several independent 8-page zines.

## The two micro zine folds

Both put sixteen panels on one side of a **portrait** sheet — 2.13 × 2.75 in
pages from Letter, a quarter the area of a mini zine page — and both are
scissors-only: no duplex, no staples, no trimming. They differ in how the reading order is routed across the grid, and
therefore in where the paper has to be slit.

Consecutive pages must stay joined, so every boundary between neighbouring
panels that the route does *not* travel through has to be cut. That means the
slits are not a separate fact to get wrong: `strip.ts` derives them from the
panel map, and the same derivation reproduces the 8-page zine's long-established
centre slit, which is how it's checked.

### River Cut

```
         col 0     col 1     col 2     col 3
      +---------+---------+---------+---------+
row 0 |    4    |    3    |    2    |    1    |   prints upside down
      +---------+~~~~~~~~~~~~~~~~~~~~~~~~~~~~~+   cut in from the RIGHT — col 0 is the hinge
row 1 |    5    |    6    |    7    |    8    |
      +~~~~~~~~~~~~~~~~~~~~~~~~~~~~~+---------+   cut in from the LEFT  — col 3 is the hinge
row 2 |    12   |    11   |    10   |    9    |   prints upside down
      +---------+~~~~~~~~~~~~~~~~~~~~~~~~~~~~~+   cut in from the RIGHT — col 0 is the hinge
row 3 |    13   |    14   |    15   |    16   |
      +---------+---------+---------+---------+

      ---  fold        ~~~  cut
```

The route simply snakes along each row and turns at alternating ends. Each slit
stops one panel short, and the spared panel is the hinge into the next row:
`4→5` on the left, `8→9` on the right, `12→13` on the left again. The slits
enter from alternating edges — the meander the name refers to.

1. Crease all sixteen panels: fold in half and in half again both ways. Unfold.
2. Cut the three lines. Each stops at a fold, not the edge.
3. Concertina the strip, following the numbers from page 1 at the top right.
4. Press flat with page 1 facing out.

### -Ɪ- cut

```
         col 0     col 1     col 2     col 3
      +---------+---------+---------+---------+
row 0 |    9    |    8    |    7    |    6    |   prints upside down
      +---------+~~~~~~~~~~~~~~~~~~~+---------+   top crossbar of the Ɪ
row 1 |    10   |    11   ~    4    |    5    |
      +~~~~~~~~~+---------~---------+~~~~~~~~~+   a dash in from each edge
row 2 |    13   |    12   ~    3    |    2    |   prints upside down
      +---------+~~~~~~~~~~~~~~~~~~~+---------+   bottom crossbar of the Ɪ
row 3 |    14   |    15   |    16   |    1    |
      +---------+---------+---------+---------+

      ---  fold        ~~~  cut
```

Page 1 is the front cover, bottom right.

The route spirals instead: out from the cover at the bottom right, up around
the right half, across the top, then back down the left. Pages 16 and 1 finish
side by side and that boundary is left uncut — it is the spine the zine wraps
shut on, exactly as pages 8 and 1 do in the 8-page fold.

Slitting everything the route doesn't use leaves a vertical stroke down the
middle with a crossbar at each end, plus a short dash at either edge on the
centre line. That shape is the name.

Adapted from the Idaho Commission for Libraries template, renumbered so the
front cover is page 1 and the back cover is page 16.

A document longer than 16 pages becomes several independent zines, either way.

## The 12-page mini zine

The only mini zine here that uses both sides of the paper. Eight panels per side
on a landscape sheet — same panel size as the 8-page zine, 2.75 × 4.25 in on
Letter — folded and cut into twelve pages.

```
FRONT

         col 0     col 1     col 2     col 3
      +---------+---------+---------+---------+
row 0 |    8    |    7    ~    6    |    5    |   prints upside down
      +~~~~~~~~~+---------+---------+~~~~~~~~~+   a dash in from each edge; the stroke rises through row 0
row 1 |    11   |    12   |    1    |    2    |
      +---------+---------+---------+---------+

      ---  fold        ~~~  cut

BACK  (the sheet flipped left-to-right)

         col 0     col 1     col 2     col 3
      +---------+---------+---------+---------+
row 0 |    4    |         |         |    9    |   prints upside down
      +---------+---------+---------+---------+
row 1 |    3    |         |         |    10   |
      +---------+---------+---------+---------+
```

Eight panels carry sixteen faces but only twelve pages. Flipping the sheet
left-to-right pairs front column *c* with back column *3−c*, putting **8/9**,
**5/4**, **11/10** and **2/3** back-to-back on four leaves.

The middle two columns have nothing on their reverse. Those four faces — the
front cover, the back cover and the centre spread — finish buried in the folds,
visible only if you unfold the whole sheet. That makes them a good hiding place
if you want a secret panel; leave a note there by hand after printing.

Print it **double-sided** and match the *Printer flip setting*, exactly as for
the booklet. Short-edge flip is what the layout assumes.

Longer documents become several independent 12-page zines.

## Assembling the booklet

Each signature is a stack of sheets folded together and stapled through the
spine. **Sheets per signature** controls how thick each stack is.

Thick single signatures bow badly at the fold — the inner pages creep outwards
and need trimming. Four to six sheets per signature, stacked into several
signatures, folds and staples much more cleanly. The last signature
automatically shrinks to fit rather than padding out with blanks, so 24 pages at
4 sheets/signature binds as 4 + 2 sheets with nothing wasted.

Sheets come out of the printer in order, outermost first. Keep each signature's
stack together, fold, staple twice through the spine.

---

## Privacy

The app reads your file with `FileReader` and builds the output PDF in memory.
After the page loads it makes **no network requests at all** — no upload, no
CDN, no analytics, no telemetry.

That is backed by the Content-Security-Policy in `public/_headers`, which sets
`connect-src 'none'`. `fetch`, `XMLHttpRequest`, `WebSocket` and `sendBeacon`
are all refused by the browser, *including back to this origin*. A dependency
that turned malicious could not quietly POST your document anywhere, because
there is nowhere it is permitted to POST to. `script-src 'self'` likewise means
no third-party code can run, which is what blocks the analytics beacon
Cloudflare injects at the edge.

Measured, not assumed — `npm run test:browser` asserts the refusals as
behaviour, because the APIs lie about it: `sendBeacon()` returns `true` and
`form.submit()` throws nothing even when CSP has blocked them. The
`securitypolicyviolation` event is the only honest signal.

**What this does not cover:** CSP has no directive restricting top-level
navigation, so `location = 'https://elsewhere/?data=…'` is still reachable by
script. This closes every practical exfiltration channel, but it is a narrowed
surface rather than an absolute guarantee.

---

## Options worth knowing

- **Page range** — `1-12, 15, 20-18`. Descending ranges run backwards, which is
  a quick way to reverse a section. Blank means every page.
- **Scaling** — *Fit whole page* letterboxes and never crops. *Fill panel* crops
  the overflow, which is what you want when the source aspect doesn't match the
  panel. *Stretch* distorts.
- **Margins** — *Around each panel* is applied to all four sides of every panel;
  *Extra at paper edge* is added only where a panel meets the paper's edge, so
  content stays clear of the non-printable border without pulling away from the
  folds.
- **Stamp page numbers** — small red numbers in each panel corner, for debugging
  a fold without generating a separate test document.

Pages that carry a `/Rotate` flag are honoured — the imposed sheet shows the page
the way a viewer does, and scales it by its *displayed* dimensions.

---

## Development

```sh
npm run typecheck     # tsc --noEmit
npm test              # imposition checks — reads output back with pdf.js
npm run build         # typecheck + production bundle into dist/
npm run test:browser  # drives the built app in headless Chrome (needs dist/)
npm run test:all      # all of the above, in order
npm run test:live     # same browser suite, against the deployed site
```

`test:live` is `test:browser` with `ZINE_URL` set, so a release can be smoke
tested through the real CDN and its real response headers. Point it anywhere:

```sh
ZINE_URL=https://zine-fold.dusty-jewett.workers.dev/ npm run test:browser
```

### CI

`.github/workflows/ci.yml` runs typecheck, imposition tests, build and browser
tests on every push and pull request. Chrome is preinstalled on GitHub's Ubuntu
runners, so the browser suite needs no extra setup, and nothing in CI needs
credentials.

Deploys are run from a workstation, not CI, so no Cloudflare token is stored in
the repo. The `smoke` job runs `test:live` against production and is manual
(**Actions → CI → Run workflow**) — it only loads a public URL, so it needs no
secrets either. To deploy from CI instead, add a `CLOUDFLARE_API_TOKEN` secret
with the *Edit Cloudflare Workers* template and a job running `npm run deploy`.

`npm test` is the interesting one. It builds numbered documents, imposes them,
then re-reads the **output** PDF with pdf.js and asserts where each glyph landed
and which way up it is — so the placement maths is checked against an independent
reader rather than against itself. `test:browser` speaks CDP to headless Chrome
directly (no Playwright/Puppeteer dependency) and pulls the preview blob back out
of the page to confirm the real UI produces the same bytes. It serves the actual
`public/_headers`, so the suite fails if the production CSP ever breaks the app.

### Layout of the code

```
src/imposition/
  types.ts      Box / Slot / SheetPlan — a layout is just data
  place.ts      the actual drawing: rotation anchors, fit modes, clipping
  paper.ts      paper sizes and orientation
  strip.ts      shared single-sided machinery; derives slits from a panel map
  mini8.ts      8-page mini zine    — panel map only
  river-cut.ts  16-page micro zine  — panel map only
  i-cut.ts      16-page micro zine  — panel map only
  duplex12.ts   12-page mini zine   — two-sided, slits recorded not derived
  booklet.ts    saddle-stitch plan, signature packing
src/render.ts   walks a plan and emits the PDF
src/main.ts     UI wiring
```

A layout is a pure function from `(pageCount, options)` to an `ImpositionPlan` —
a list of sheets, each holding slots (which source page, which rectangle, rotated
or not) plus fold and cut marks. `render.ts` doesn't know what a zine is.

The three single-sided zines are panel maps and nothing else; `strip.ts` works
out where the paper has to be slit. Another one of those is a dozen lines. A new
two-sided fold needs its own planner, because the slits can't be derived — see
the note under the 12-page zine.

### Not supported yet

- Non-PDF input (images, `.docx`). `render.ts` takes a pdf-lib `PDFDocument`, so
  image input mainly needs a loader that wraps each image in a page.
- Creep compensation for thick signatures.

---

## License

MIT — see [LICENSE](LICENSE).
