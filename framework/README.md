# Trip app framework

A standard way to build and ship the map-and-timeline trip app, so every trip
after the first one is content work rather than engineering work.

This is lifted from the Amsterdam honeymoon app. Everything here is either
code that app runs, or a rule learned from a bug it actually hit.

---

## What the app is

One HTML file, no build step, no dependencies you install. A map with a
colour-coded route per day, a scrolling timeline under it, a cover page, and
an optional notes page. It is a phone app in the only sense that matters on a
trip: you open the link, it works, nobody installs anything.

Three things keep it simple, and they are worth protecting:

- **No build.** The file you edit is the file that deploys. You can open
  `index.html` off a USB stick on a bad hotel wifi and it still works.
- **No API keys.** Leaflet with OpenStreetMap tiles. Nothing to rotate,
  nothing to leak, nothing that bills you.
- **No backend.** Static hosting. A trip app has no users, no state and no
  writes. Keep it that way.

---

## The one rule

**Content lives in `TRIP`. The engine never gets edited per trip.**

`index.html` has two halves, separated by markers:

```
/* TRIP:DATA:START */     everything about this specific trip
const TRIP = { ... };
/* TRIP:DATA:END */       the engine, byte-identical across all your trips
```

When you want to change something for one trip, change `TRIP`. If you cannot,
the schema is missing a field: add the field to the engine and to every trip,
rather than forking the engine. The moment two trips have different engines,
a fix to one stops reaching the other, and you are maintaining four apps.

The Amsterdam app learned this the hard way. Its FAQ was hand-written markup
in the body, the cover title was duplicated in an `aria-label` and in a JS
array, and the header was hardcoded. Every one of those is a place a second
trip would have had to touch the engine.

---

## Starting a trip

Once, ever, so the card renderer has a browser:

```bash
cd framework && npm install
```

Then per trip:

```bash
cp -r framework/template my-trip
cd my-trip
cp ~/photos/the-good-one.jpg cover.jpg
# edit the TRIP block in index.html
node ../framework/tools/sync-meta.mjs index.html
node ../framework/tools/make-og-card.mjs index.html
node ../framework/tools/check-trip.mjs index.html
```

Serve it locally with anything: `npx http-server -p 8080 .` and open
`http://localhost:8080`.

The template ships with a two-day example trip and a placeholder `cover.jpg`,
so it runs before you have written a word.

---

## The TRIP schema

### Top level

| Field | What it is |
|---|---|
| `url` | The real deployed URL. Link previews need absolute URLs, so this must be correct before you share the link. |
| `title` | Browser tab title. |
| `header` | `{ line, accent, color, sub }`. `accent` is the character in `line` that gets coloured, usually `♥`. |
| `cover` | `{ line1, line2, stamp, cta }`. `line1` is the small handwritten line, `line2` the big script one. Omit `stamp` to drop the rubber stamp. |
| `share` | `{ title, description, imageAlt }` for link previews. |
| `overview` | `{ tab, title, color }` for the all-days view. |
| `faq` | The notes page, or `{ enabled: false }`. |
| `days` | The itinerary. |

### A day

```js
{
  name: "Day 1: Fri",                    // tab label, keep it short
  full: "Friday, London to the canals",  // the line over the timeline
  color: "#C94F4F",                      // route, pins and tab
  extras: false,                         // see below
  stops: [ ... ]
}
```

`extras: true` turns a day into an unordered pick-and-choose list: no route
line, no "full route" link, emoji badges instead of numbers, and it is left
out of the overview. Use it for the "if we have time" pile. Put extras days
last.

### A stop

| Field | Required | What it is |
|---|---|---|
| `t` | yes | Time label, `"09:30"`. On an extras day, a category word like `"eat"`. |
| `n` | yes | Name. Over ~28 characters wraps awkwardly. |
| `d` | yes | The practical note: booking, walking time, closing time. The thing you would otherwise have to look up again. |
| `q` | yes | Google Maps search string. Be specific: `"Cafe Bern Amsterdam"`, not `"Bern"`. |
| `lat`, `lng` | yes | Decimal degrees. |
| `why` | no | One italic line on why it is worth the detour. |
| `book` | no | `true` adds a "book" badge. |
| `e` | no | Emoji badge replacing the number, for extras days. |
| `lf` | no | A "look for this" line inside the popup. |
| `away` | no | `true` keeps the stop out of the map's auto-zoom. |

**On `away`:** a departure station or home airport is often hundreds of
kilometres from the rest of the day. Including it in the map bounds zooms out
until the actual route is a smudge. Mark it `away: true`.

The Amsterdam app did this with a hardcoded `s.lng > 3` test, which silently
means "is it east of the Netherlands". That works for exactly one trip. The
flag says what you mean and travels.

---

## Writing good trip content

The engine is the easy half. These are what make the app worth opening:

- **`d` is for things you would otherwise re-look-up.** "Booked, arrive
  16:35". "Tram 2/12 to Centraal". "Terrace closes 20:00". Not "a nice
  museum".
- **`why` earns the detour.** One line, concrete. "Europe's highest swing, out
  over the edge with the whole city below your feet" beats "great views".
- **One unplanned hour a day.** Put it in as a real stop. It stops the day
  reading like a schedule you are failing to keep.
- **Name the backup.** The best places have queues. An extras entry next to
  the first choice saves the afternoon.
- **Colours should be distinguishable on a phone, in sun.** The four from the
  honeymoon app work well together and are a reasonable default:
  `#C94F4F` red, `#4A7BA6` blue, `#6B8F5E` green, `#DE8A3C` orange, plus
  `#B85F9E` for extras and `#8A7256` for the overview.

---

## The tools

All three are plain Node, no install except Playwright for the card renderer.

### `sync-meta.mjs`

Rewrites the `<head>` link preview block from `TRIP`.

This exists because **link scrapers do not run JavaScript.** WhatsApp,
iMessage, Slack and Twitter read the raw HTML and stop. So share metadata
cannot be rendered at runtime like the rest of the chrome, and would otherwise
be a second copy of your title and description that quietly drifts out of
step. This makes `TRIP` the source and the `<head>` a generated artefact.

Run it after any change to `TRIP.url`, `TRIP.title` or `TRIP.share`.

### `make-og-card.mjs`

Renders `og-cover.jpg`, the 1200x630 image people see when the link is pasted
into a chat.

It screenshots your own cover page rather than cropping the photo. Cover
photos are portrait; every preview surface crops to landscape. A raw crop
loses the title and most of the picture. Rendering the real cover gives a card
that matches what people see when they tap through.

It also writes `og-cover.json`, recording the SHA-256 of the `cover.jpg` it
was built from, so `check-trip.mjs` can tell when the card has gone stale.

Two things it works around, both of which cost real time to discover:

- Leaflet is stubbed out. The cover sits above the map and the map is never
  visible in the shot, so loading it would only add a network dependency.
- Fonts are downloaded and inlined as data URLs. A headless browser behind a
  proxy often cannot reach `fonts.gstatic.com` even when the host can, and the
  failure is silent: the title renders in Times and looks almost right.

### `check-trip.mjs`

Preflight. Exits non-zero on an error. Run it before every deploy.

It checks required fields, hex colours, coordinate ranges, that the deployed
URL is absolute https and not the placeholder, that the preview tags match
`TRIP`, that `cover.jpg` and `og-cover.jpg` exist, that the card is 1200x630
and under WhatsApp's ~600KB limit, and that the card was rendered from the
current cover photo and title.

Two checks earn their keep:

- **Coordinate outliers.** Each stop is measured against its nearest
  neighbour that day. Over 25km warns, over 60km errors. A single mistyped
  digit puts a stop in the next country, and nothing on the page looks wrong
  until you are standing in the wrong street.
- **Stale preview card.** Covered below. It is the bug this framework most
  wants to prevent.

---

## Deploying

Vercel, from the GitHub repo. One repo per trip, `main` is live.

1. Push the trip to its own GitHub repo.
2. Import it at vercel.com. No framework preset, no build command, output
   directory is the repo root. It is static files.
3. Vercel gives you a URL like `my-trip-gray.vercel.app`. Put that in
   `TRIP.url`, re-run `sync-meta.mjs`, commit, push.

Step 3 is easy to skip and breaks every link preview, because the URL is not
known until after the first deploy. `check-trip.mjs` fails on the placeholder
for this reason.

**Previews are cached hard.** WhatsApp and iMessage will keep showing the old
card in any chat where you already shared the link. Test with a fresh link or
a `?v=2` suffix. Facebook's Sharing Debugger forces a re-scrape.

---

## Things that bit us

Each of these cost time on the Amsterdam build. Most are now checked by
tooling; the rest are here so they cost you nothing.

### The cover photo and the preview card drift apart

**The bug.** The cover photo was swapped. `og-cover.jpg` was rendered from the
old one. Link previews kept showing the previous trip's photo and nobody
noticed, because the app itself looked correct.

**Why it was missed.** The cover photo was a 200KB base64 blob on one line of
`index.html`. Every diff of that file masked the blob to stay readable, which
also masked the photo changing.

**The fix.** `cover.jpg` is a separate file, so a changed photo shows up as a
changed file. `make-og-card.mjs` records the photo's checksum and
`check-trip.mjs` fails when it no longer matches.

This is also why the template does **not** inline the cover as base64.
Inlining buys you a single portable file; it costs you reviewable diffs, a
cacheable image and a sane repo. If you want a single file to email to
someone, build one at the end rather than working that way.

### Switching days kept the old scroll position

Rebuilding the list does not move the scrollbar, and the browser's scroll
anchoring puts it back where it was. Day 3 would open halfway down.

Both halves of the fix are needed, and both are in the engine:
`overflow-anchor: none` on `.stops`, and `scrollTop = 0` after rebuilding plus
once more on the next frame.

### The map is laid out behind a full-screen cover

Leaflet measures its container on creation. If that happens while the cover or
notes page is over the top, the map is sized wrong and stays wrong.

`map.invalidateSize()` has to run when the last full-screen layer closes, and
only then. The engine handles both paths: with a notes page it fires on
"on to the map", without one it fires when the cover is removed.

### Hand-merging an edited copy of `index.html`

If you edit the file somewhere else and hand it back, **do not copy it over
the current one.** It is almost certainly based on an older download, and
copying silently reverts everything since.

Diff it against the commit it branched from, not against the current file:

```bash
for c in $(git log --format=%h -8); do
  echo "$c -> $(diff <(git show $c:index.html) their-copy.html | wc -l) lines"
done
```

The commit with the smallest diff is the base. Diff against that to see only
their changes, then replay those onto the current file.

And when you mask anything out of a diff to make it readable, checksum the
masked part separately. That is exactly how the cover photo change got lost.

---

## File layout for a trip

```
my-trip/
  index.html        TRIP block + engine
  cover.jpg         the cover photo, portrait, any size
  og-cover.jpg      generated, 1200x630
  og-cover.json     generated, staleness stamp
  CLAUDE.md         optional, repo conventions
```

Commit all of them, including the generated two. They are deployment inputs,
and a clone with a missing preview card is a broken one.

---

## Before you share the link

```bash
node tools/check-trip.mjs index.html   # must exit 0
```

Then, by hand:

- Open it on an actual phone, not a narrow desktop window. Check the cover,
  the tabs scrolling sideways, and the sheet at the bottom.
- Tap through every day. The map should frame the day without a stray pin
  dragging the zoom out.
- Tap a few stops. Popups should open above the pin, fully visible.
- Paste the link into a chat with yourself and look at the card.

---

## Porting the Amsterdam app onto this

The honeymoon app predates the framework and still has its content tangled
into the engine. It works, so there is no urgency, but if you want it on the
same footing as later trips:

1. Copy `framework/template/index.html` to a scratch file.
2. Move the honeymoon `DAYS` array into `TRIP.days` unchanged. The stop schema
   is identical apart from `away`.
3. Replace the `s.lng > 3` bounds test by marking St Pancras `away: true`.
4. Move the FAQ markup into `TRIP.faq.sections`: each `<section class="qa">`
   becomes `{ q, a: [...] }`, and the phrase list becomes `phrases: [{w, s}]`.
5. Move the cover title, stamp, header line and meta tags into `TRIP`.
6. Extract the inlined base64 cover into `cover.jpg` and drop the data URL.
7. Run all three tools, then diff the rendered page against the live one.
