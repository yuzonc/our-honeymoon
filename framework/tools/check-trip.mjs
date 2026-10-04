#!/usr/bin/env node
// Preflight a trip before you deploy it.
//
//   node tools/check-trip.mjs [path/to/index.html]
//
// Exits non-zero on an error. Warnings do not fail the run but are usually
// worth a look. Every check here exists because the mistake is easy to make
// and invisible until someone is standing in the wrong street.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { readTrip, renderMeta, currentMeta } from './trip.mjs';

const file = process.argv[2] || 'index.html';
const dir = dirname(file);

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const { trip, html } = readTrip(file);

/* ---------- shape ---------- */

const need = (obj, path) => {
  const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  if (v === undefined || v === null || v === '') err(`TRIP.${path} is missing`);
  return v;
};

need(trip, 'url');
need(trip, 'title');
need(trip, 'header.line');
need(trip, 'header.sub');
need(trip, 'cover.line1');
need(trip, 'cover.line2');
need(trip, 'cover.cta');
need(trip, 'share.title');
need(trip, 'share.description');
need(trip, 'share.imageAlt');
need(trip, 'overview.tab');
need(trip, 'overview.title');
need(trip, 'overview.color');

/* ---------- the deployed URL ---------- */

if (trip.url) {
  if (!/^https:\/\//.test(trip.url)) {
    err(`TRIP.url must be an absolute https URL, got "${trip.url}" — scrapers do not resolve relative paths`);
  }
  if (/example\.vercel\.app/.test(trip.url)) {
    err('TRIP.url is still the template placeholder, set it to the real deployed URL');
  }
}

/* ---------- days and stops ---------- */

const days = trip.days || [];
if (!days.length) err('TRIP.days is empty');

const colors = new Map();
let seenExtras = false;

days.forEach((day, di) => {
  const where = `days[${di}] (${day.name || 'unnamed'})`;
  if (!day.name) err(`${where}: missing name`);
  if (!day.full) err(`${where}: missing full`);
  if (!/^#[0-9a-fA-F]{6}$/.test(day.color || '')) {
    err(`${where}: color must be a 6-digit hex like "#C94F4F", got "${day.color}"`);
  } else if (colors.has(day.color)) {
    warn(`${where}: reuses the colour of ${colors.get(day.color)}, the routes will be hard to tell apart`);
  } else {
    colors.set(day.color, where);
  }

  if (day.extras) seenExtras = true;
  else if (seenExtras) warn(`${where}: a normal day appears after an extras day, put extras days last`);

  const stops = day.stops || [];
  if (!stops.length) { err(`${where}: has no stops`); return; }

  stops.forEach((s, si) => {
    const at = `${where} stop ${si + 1} (${s.n || 'unnamed'})`;
    for (const f of ['t', 'n', 'd', 'q']) {
      if (!s[f]) err(`${at}: missing ${f}`);
    }
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') {
      err(`${at}: lat and lng must be numbers`);
      return;
    }
    if (s.lat < -90 || s.lat > 90) err(`${at}: lat ${s.lat} is out of range`);
    if (s.lng < -180 || s.lng > 180) err(`${at}: lng ${s.lng} is out of range`);
    if (s.lat === 0 && s.lng === 0) err(`${at}: coordinates are 0,0`);
    if (day.extras && !s.e) warn(`${at}: on an extras day but has no emoji badge (e)`);
    if ((s.n || '').length > 28) warn(`${at}: name is ${s.n.length} chars, it may wrap awkwardly in the list`);
  });

  // A single mistyped digit puts a stop in the next country, and nothing on
  // the page looks wrong until you are standing there. Measure each stop
  // against its nearest neighbour rather than the day's centre, so this still
  // works on a two-stop day.
  const near = stops.filter(s => !s.away && typeof s.lat === 'number' && typeof s.lng === 'number');
  if (near.length === 2) {
    const km = haversine([near[0].lat, near[0].lng], [near[1].lat, near[1].lng]);
    if (km > 60) {
      err(`${where}: "${near[0].n}" and "${near[1].n}" are ${Math.round(km)}km apart. ` +
          'Check both sets of coordinates, or mark one `away: true` if that is deliberate.');
    } else if (km > 25) {
      warn(`${where}: "${near[0].n}" and "${near[1].n}" are ${Math.round(km)}km apart`);
    }
  } else if (near.length > 2) {
    near.forEach((s, si) => {
      const km = Math.min(...near
        .filter((_, k) => k !== si)
        .map(o => haversine([s.lat, s.lng], [o.lat, o.lng])));
      if (km > 60) {
        err(`${where} stop "${s.n}": ${Math.round(km)}km from the nearest other stop that day. ` +
            'Check the coordinates, or mark it `away: true` if that is deliberate.');
      } else if (km > 25) {
        warn(`${where} stop "${s.n}": ${Math.round(km)}km from the nearest other stop that day`);
      }
    });
  }

  // Times should climb through the day. Crossing midnight is legitimate, so
  // this only warns.
  if (!day.extras) {
    const timed = stops.map((s, i) => ({ i, n: s.n, m: toMinutes(s.t) })).filter(s => s.m !== null);
    for (let k = 1; k < timed.length; k++) {
      if (timed[k].m < timed[k - 1].m) {
        warn(`${where}: "${timed[k].n}" (${stops[timed[k].i].t}) comes after ` +
             `"${timed[k - 1].n}" (${stops[timed[k - 1].i].t}) but is earlier in the day`);
      }
    }
  }
});

/* ---------- link preview ---------- */

if (currentMeta(html) !== renderMeta(trip)) {
  err('the <head> link preview tags are out of step with TRIP — run: node tools/sync-meta.mjs ' + file);
}

const coverPath = join(dir, 'cover.jpg');
const ogPath = join(dir, 'og-cover.jpg');

if (!existsSync(coverPath)) {
  err('cover.jpg is missing, the cover page will fall back to flat brown');
}
if (!existsSync(ogPath)) {
  err('og-cover.jpg is missing — run: node tools/make-og-card.mjs ' + file);
} else {
  const og = readFileSync(ogPath);
  const dim = jpegSize(og);
  if (!dim) warn('og-cover.jpg does not look like a JPEG');
  else if (dim.w !== 1200 || dim.h !== 630) {
    warn(`og-cover.jpg is ${dim.w}x${dim.h}, link previews want 1200x630`);
  }
  if (og.length > 600 * 1024) {
    err(`og-cover.jpg is ${Math.round(og.length / 1024)}KB, over WhatsApp's ~600KB preview limit`);
  }

  // The card is rendered from the cover photo. Swap the photo and forget to
  // re-render, and the preview silently keeps showing the old trip.
  const stampPath = join(dir, 'og-cover.json');
  if (!existsSync(stampPath)) {
    warn('og-cover.json is missing, cannot tell whether the preview card matches the current cover photo');
  } else if (existsSync(coverPath)) {
    const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
    const live = sha256(readFileSync(coverPath));
    if (stamp.coverSha256 !== live) {
      err('og-cover.jpg was rendered from a different cover.jpg — run: node tools/make-og-card.mjs ' + file);
    }
    const title = `${trip.cover.line1} ${trip.cover.line2}`;
    if (stamp.coverTitle !== title) {
      err(`og-cover.jpg still shows "${stamp.coverTitle}" but the cover now reads "${title}" — re-render it`);
    }
  }
}

/* ---------- report ---------- */

for (const w of warnings) console.log(`  warn   ${w}`);
for (const e of errors) console.log(`  ERROR  ${e}`);

const dayCount = days.filter(d => !d.extras).length;
const stopCount = days.reduce((n, d) => n + (d.stops || []).length, 0);
console.log(`\n${file}: ${dayCount} days, ${days.length - dayCount} extras lists, ${stopCount} stops`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);

/* ---------- helpers ---------- */


function haversine([lat1, lon1], [lat2, lon2]) {
  const R = 6371, rad = (d) => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function jpegSize(d) {
  let i = 2;
  while (i < d.length) {
    if (d[i] !== 0xFF) { i++; continue; }
    const m = d[i + 1];
    if (m === 0xC0 || m === 0xC1 || m === 0xC2) {
      return { h: d.readUInt16BE(i + 5), w: d.readUInt16BE(i + 7) };
    }
    if (m === 0xD8 || m === 0xD9 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    i += 2 + d.readUInt16BE(i + 2);
  }
  return null;
}
