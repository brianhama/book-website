#!/usr/bin/env node
// Adds a book to books.json by fetching its metadata from Audible.
//
// Usage: node scripts/add-book.mjs <ASIN> --category "Fiction - Literary & Classics" [--blurb "Custom blurb"]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getMetadata } from './audible-meta.mjs';

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
  const m = rest[0].match(/(?:^|\/pd\/(?:[^/]+\/)?|\/dp\/)([A-Z0-9]{10})(?:[/?]|$)/i);
  if (!m) fail(`could not find an ASIN in "${rest[0]}"`);
  args.asin = m[1].toUpperCase();
  return args;
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

let meta;
try {
  meta = await getMetadata(asin);
} catch (e) {
  fail(e.message);
}
if (blurb) meta.blurb = blurb;

cat.books.unshift({
  title: meta.title,
  author: meta.author,
  blurb: meta.blurb,
  cover: meta.cover,
  link: `http://www.audible.com/pd/${asin}/?ref=nosim&tag=${AFFILIATE_TAG}`,
});
data.lastUpdated = new Date().toLocaleDateString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles',
});

writeFileSync(BOOKS_JSON, JSON.stringify(data, null, 2) + '\n');
console.log(`Added "${meta.title}" by ${meta.author} to "${cat.name}".`);
