#!/usr/bin/env node
// Render the link preview card from the trip's own cover page.
//
//   node tools/make-og-card.mjs [path/to/index.html]
//
// Writes og-cover.jpg (1200x630) next to it, plus og-cover.json recording
// which cover photo and title it was made from, so check-trip.mjs can tell
// when the card has gone stale.
//
// Why render the page rather than crop the photo: cover photos are usually
// portrait, and every preview surface crops to landscape, so a raw crop loses
// the title and most of the picture. Rendering the real cover gives a card
// that matches what people see when they tap through.
//
// Two things the render has to work around:
//   - Leaflet is stubbed. The cover sits above the map, the map is never
//     visible in the shot, and loading it would need network and tiles.
//   - Fonts are fetched over the network and inlined as data URLs, because a
//     headless browser behind a proxy often cannot reach fonts.gstatic.com
//     even when the host can. Without this the title renders in Times.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { readTrip } from './trip.mjs';

const file = process.argv[2] || 'index.html';
const dir = dirname(file);
const { trip } = readTrip(file);

const chromium = await loadChromium();

async function loadChromium() {
  // Bare specifiers resolve from this file's directory, which is the framework
  // checkout, not the trip folder the command was run in. Try both, so an
  // install in either place works.
  const tries = [
    () => import('playwright'),
    () => import(createRequire(join(process.cwd(), 'noop.js')).resolve('playwright'))
  ];
  for (const attempt of tries) {
    try {
      // Playwright ships as CommonJS, so the named export is not always
      // visible through the ESM bridge. Fall back to the default export.
      const pw = await attempt();
      const c = pw.chromium ?? pw.default?.chromium;
      if (c) return c;
    } catch { /* try the next location */ }
  }
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  console.error(
    'This script needs Playwright. Install it once, where package.json lives:\n' +
    `  cd ${pkgRoot} && npm install\n` +
    'That pulls in Playwright and its Chromium build.'
  );
  process.exit(1);
}

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Caveat:wght@600;700' +
  '&family=Great+Vibes&family=Quicksand:wght@500;600;700&display=swap';

// Leaflet's API surface, reduced to the calls the engine makes on load.
const LEAFLET_STUB = `
  const noop = () => {};
  const chain = () => { const o = {
    addTo: () => o, bindPopup: () => o, openPopup: noop,
    pad: () => o, once: noop, clearLayers: noop, on: () => o
  }; return o; };
  window.L = {
    map: () => ({ fitBounds: noop, getZoom: () => 14, once: noop, flyTo: noop,
      invalidateSize: noop, project: () => ({ subtract: () => ({}) }), unproject: () => ({}) }),
    control: { zoom: () => ({ addTo: noop }) },
    tileLayer: chain, layerGroup: chain, polyline: chain, marker: chain,
    divIcon: (o) => o, latLngBounds: chain
  };
`;

console.log('fetching fonts...');
const fontCss = await inlineFonts();

const server = createServer((req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const path = join(dir, name);
  if (!existsSync(path)) { res.writeHead(404).end('not found'); return; }
  const type = name.endsWith('.jpg') ? 'image/jpeg'
    : name.endsWith('.html') ? 'text/html' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }).end(readFileSync(path));
}).listen(0);
const port = server.address().port;

console.log('rendering cover at 1200x630...');
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce'   // skip the letter-by-letter animation, land on the end state
});

await page.route('**/leaflet*.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: LEAFLET_STUB }));
await page.route('**/leaflet*.css', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: fontCss }));

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
await page.evaluate(async () => { await document.fonts.ready; });
await page.waitForTimeout(500);

const loaded = await page.evaluate(() =>
  [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
if (!loaded.includes('Caveat')) {
  console.warn('  warning: Caveat did not load, the title will be in a fallback face');
}
if (errors.length) console.warn('  page errors:', errors.join('; '));

const jpeg = await page.screenshot({ type: 'jpeg', quality: 88 });
await browser.close();
server.close();

const out = join(dir, 'og-cover.jpg');
writeFileSync(out, jpeg);

const coverPath = join(dir, 'cover.jpg');
writeFileSync(join(dir, 'og-cover.json'), JSON.stringify({
  renderedAt: new Date().toISOString(),
  coverSha256: existsSync(coverPath)
    ? createHash('sha256').update(readFileSync(coverPath)).digest('hex')
    : null,
  coverTitle: `${trip.cover.line1} ${trip.cover.line2}`
}, null, 2) + '\n');

console.log(`\nwrote ${out} (${Math.round(jpeg.length / 1024)}KB)`);
if (jpeg.length > 600 * 1024) {
  console.warn('  warning: over ~600KB, WhatsApp may refuse to show it');
}
console.log('wrote og-cover.json so check-trip.mjs can spot a stale card');

async function inlineFonts() {
  const res = await fetch(FONT_CSS, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36' }
  });
  const css = await res.text();

  // Google serves one @font-face per unicode subset. Only latin is needed, and
  // taking all of them would make the inlined CSS several megabytes.
  const out = [];
  const re = /\/\* latin \*\/\s*@font-face \{([^}]+)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const block = m[1];
    const url = block.match(/url\((https:[^)]+)\)/)?.[1];
    const family = block.match(/font-family: '([^']+)'/)?.[1];
    const weight = block.match(/font-weight: (\d+)/)?.[1] || '400';
    if (!url || !family) continue;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    out.push(`@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
      `font-display:block;src:url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2');}`);
  }
  if (!out.length) throw new Error('could not fetch any fonts, check network access');
  return out.join('\n');
}
