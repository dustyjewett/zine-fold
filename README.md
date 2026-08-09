# zine-fold

Live at **[zine-fold.dusty-jewett.workers.dev](https://zine-fold.dusty-jewett.workers.dev)**
— moving to **zine-fold.com** once the registration completes.

Turns a PDF into a **fold-ready** PDF: one output page per side of paper, already
imposed. You print it 1-per-sheet with plain duplex — no "multiple pages per
sheet", no booklet mode, nothing for the print driver to get wrong.

Two layouts:

| Layout | Sheets | Sides | Result |
| --- | --- | --- | --- |
| **8-page mini-zine** | 1 per zine | single-sided | Classic fold-and-slit pocket zine |
| **Half-page booklet** | 1..N | duplex | Saddle-stitched booklet, 1..N signatures |

It runs entirely in the browser. Nothing is uploaded; the PDF never leaves the
machine, which also means there's no file size limit and it works offline.

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

### The domain

`zine-fold.com` and `www.zine-fold.com` are declared as Custom Domains in
`wrangler.jsonc`. The Worker *is* the origin, so Cloudflare creates and manages
the DNS records and certificates on deploy — there is nothing to set up by hand.

**One prerequisite:** the `zine-fold.com` zone has to already exist in the same
Cloudflare account. If you bought it through Cloudflare Registrar it already
does. If you bought it elsewhere, add the site in the dashboard and repoint the
nameservers first, otherwise the first `npm run deploy` fails on the route.

Both hostnames serve the app. `index.html` carries a canonical link to the apex,
which is enough to keep search engines from treating www as a duplicate. If you
want www to actually redirect, add a Redirect Rule in the dashboard
(**Rules → Redirect Rules**, `www.zine-fold.com/*` → `https://zine-fold.com/$1`,
301) — that's zone config, not something wrangler owns.

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

The output pages are already the size of the paper you picked, in landscape.
Let the driver rotate them onto portrait stock; don't set landscape yourself.

### Mini-zine

Single-sided. Nothing else to configure.

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

This is worth doing once per printer. It is much faster than reasoning about
duplex flip conventions, and it's the ground truth if anything below disagrees
with your paper.

---

## Folding the mini-zine

The sheet is laid out as four columns by two rows, with the top row printed
upside down:

```
+-----+-----+-----+-----+
|  ᘔ5 |  ᘔ4 |  ᘔ3 |  ᘔ2 |   <- upside down
+-----+-----+-----+-----+
|  6  |  7  |  8  |  1  |   <- page 1 is the front cover
+-----+-----+-----+-----+
```

1. Crease all eight panels: fold in half left-to-right, again left-to-right,
   then once top-to-bottom. Unfold.
2. Fold in half top-to-bottom and **cut the dashed line** — the middle half of
   the folded edge. Unfold.
3. Fold top-to-bottom again, with the `6 7 8 1` row facing out.
4. Push the left and right ends toward each other. The slit opens into a plus
   shape; collapse it so page 1 lands on the front.

A document longer than 8 pages becomes several independent mini-zines of 8.

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
ZINE_URL=https://zine-fold.com/ npm run test:browser
```

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
  types.ts     Box / Slot / SheetPlan — a layout is just data
  place.ts     the actual drawing: rotation anchors, fit modes, clipping
  paper.ts     paper sizes
  mini8.ts     8-up mini-zine plan
  booklet.ts   saddle-stitch plan, signature packing
src/render.ts  walks a plan and emits the PDF
src/main.ts    UI wiring
```

A layout is a pure function from `(pageCount, options)` to an `ImpositionPlan` —
a list of sheets, each holding slots (which source page, which rectangle, rotated
or not) plus fold/cut marks. `render.ts` doesn't know what a zine is. Adding a
quarter-page or 16-page layout means writing one more planner; nothing else
changes.

### Not supported yet

- Non-PDF input (images, `.docx`). `render.ts` takes a pdf-lib `PDFDocument`, so
  image input mainly needs a loader that wraps each image in a page.
- 16-page mini-zines (a different fold with two slits).
- Creep compensation for thick signatures.
