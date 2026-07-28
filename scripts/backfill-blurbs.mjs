#!/usr/bin/env node
// Fills in missing blurbs (and covers) for books already in books.json.
// With --all, re-fetches and re-distills the blurb for every book.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getMetadata } from './audible-meta.mjs';

const refreshAll = process.argv.includes('--all');
const BOOKS_JSON = join(dirname(fileURLToPath(import.meta.url)), '..', 'books.json');
const data = JSON.parse(readFileSync(BOOKS_JSON, 'utf8'));

let fixed = 0, failed = 0;
for (const cat of data.categories) {
  for (const book of cat.books) {
    if (!refreshAll && book.blurb && book.cover) continue;
    const m = book.link.match(/\/pd\/([A-Z0-9]{10})/i);
    if (!m) continue;
    try {
      const meta = await getMetadata(m[1].toUpperCase());
      if (meta.blurb && (refreshAll || !book.blurb)) {
        if (book.blurb !== meta.blurb) { book.blurb = meta.blurb; fixed++; console.log(`blurb: ${book.title}`); }
      }
      if (!book.cover && meta.cover) { book.cover = meta.cover; console.log(`cover: ${book.title}`); }
    } catch (e) {
      failed++;
      console.error(`failed: ${book.title} — ${e.message}`);
    }
  }
}

writeFileSync(BOOKS_JSON, JSON.stringify(data, null, 2) + '\n');
console.log(`Done. ${fixed} blurbs updated, ${failed} failures.`);
