#!/usr/bin/env node
// Adds a book to books.json by fetching its metadata from Audible.
//
// Usage: node scripts/add-book.mjs <ASIN> --category "Fiction" [--blurb "Custom blurb"]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BOOKS_JSON = join(dirname(fileURLToPath(import.meta.url)), '..', 'books.json');
const AFFILIATE_TAG = 'brianhamachek-20';

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { asin: null, category: null, blurb: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--category') args.category = argv[++i];
    else if (argv[i] === '--blurb') args.blurb = argv[++i];
    else rest.push(argv[i]);
  }
  if (rest.length !== 1) fail('usage: add-book.mjs <ASIN or Audible URL> --category "<name>"');
  // Accept a bare ASIN or a full Audible/Amazon product URL.
  const m = rest[0].match(/(?:^|\/pd\/(?:[^/]+\/)?|\/dp\/)([A-Z0-9]{10})(?:[/?]|$)/i);
  if (!m) fail(`could not find an ASIN in "${rest[0]}"`);
  args.asin = m[1].toUpperCase();
  return args;
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function stripHtml(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function truncateBlurb(s, max = 320) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf(' '))).trim() + '...';
}

async function fetchProductPage(asin) {
  const url = `https://www.audible.com/pd/${asin}?ipRedirectOverride=true`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) fail(`Audible returned HTTP ${res.status} for ${url}`);
  return res.text();
}

function extractMetadata(html, asin) {
  const meta = { title: null, author: null, blurb: null, cover: null };

  // Primary source: JSON-LD blocks (Audible embeds an Audiobook/Book object).
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let parsed;
    try { parsed = JSON.parse(m[1]); } catch { continue; }
    for (const obj of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!/Audiobook|Book|Product/.test(String(obj['@type']))) continue;
      meta.title ||= obj.name;
      meta.cover ||= Array.isArray(obj.image) ? obj.image[0] : obj.image;
      if (!meta.blurb && obj.description) meta.blurb = stripHtml(obj.description);
      if (!meta.author && obj.author) {
        const authors = Array.isArray(obj.author) ? obj.author : [obj.author];
        meta.author = authors.map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean).join(', ');
      }
    }
  }

  // Fallbacks: Open Graph tags and the <title>.
  const og = (prop) => html.match(new RegExp(`<meta[^>]+property="og:${prop}"[^>]+content="([^"]+)"`))?.[1];
  meta.title ||= og('title')?.replace(/ \| Audible.*$/i, '');
  meta.cover ||= og('image');
  meta.blurb ||= html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/)?.[1];

  if (!meta.title || !meta.author) {
    fail(`could not extract metadata for ${asin} — the page layout may have changed or the ASIN may be invalid`);
  }
  meta.title = decodeEntities(meta.title).trim();
  meta.author = decodeEntities(meta.author).trim();
  meta.blurb = truncateBlurb(stripHtml(meta.blurb || ''));
  // Normalize cover to the 200px rendition used across the site.
  meta.cover = (meta.cover || '').replace(/\._SL\d+_\./, '._SL200_.').replace(/(\.jpg)$/i, '$1');
  return meta;
}

const { asin, category, blurb } = parseArgs(process.argv.slice(2));
if (!category) fail('--category is required');

const data = JSON.parse(readFileSync(BOOKS_JSON, 'utf8'));
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
const cat = data.categories.find(
  (c) => norm(c.name) === norm(category) || norm(c.name).endsWith(norm(category))
);
if (!cat) {
  fail(`unknown category "${category}". Available: ${data.categories.map((c) => c.name).join(' | ')}`);
}

const dup = data.categories.flatMap((c) => c.books).find((b) => b.link.includes(asin));
if (dup) fail(`"${dup.title}" (${asin}) is already on the site`);

const html = await fetchProductPage(asin);
const meta = extractMetadata(html, asin);
if (blurb) meta.blurb = blurb;

const book = {
  title: meta.title,
  author: meta.author,
  blurb: meta.blurb,
  cover: meta.cover,
  link: `http://www.audible.com/pd/${asin}/?ref=nosim&tag=${AFFILIATE_TAG}`,
};
cat.books.unshift(book);
data.lastUpdated = new Date().toLocaleDateString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles',
});

writeFileSync(BOOKS_JSON, JSON.stringify(data, null, 2) + '\n');
console.log(`Added "${book.title}" by ${book.author} to "${cat.name}".`);
