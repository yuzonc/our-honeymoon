#!/usr/bin/env node
// Rewrite the <head> link-preview block from the TRIP object.
//
// Why this exists: link scrapers (WhatsApp, iMessage, Slack, Twitter) do not
// run JavaScript. They read the raw HTML and stop. So the share metadata
// cannot be rendered at runtime like the rest of the chrome, and would
// otherwise be a second copy of the title and description that silently
// drifts. This script makes TRIP the source and the <head> a build artefact.
//
//   node tools/sync-meta.mjs [path/to/index.html]

import { writeFileSync } from 'node:fs';
import { readTrip, renderMeta, replaceMeta, currentMeta } from './trip.mjs';

const file = process.argv[2] || 'index.html';
const { trip, html } = readTrip(file);

const block = renderMeta(trip);
const before = currentMeta(html);

if (before === block) {
  console.log(`${file}: link preview tags already match TRIP, nothing to do`);
  process.exit(0);
}

writeFileSync(file, replaceMeta(html, block));
console.log(`${file}: link preview tags rewritten from TRIP`);
console.log(`  title       ${trip.share.title}`);
console.log(`  url         ${trip.url}`);
console.log(`  image       ${trip.url.replace(/\/?$/, '/')}og-cover.jpg`);
console.log('\nRemember: previews are cached hard. Test with a fresh link or a ?v=2 suffix.');
