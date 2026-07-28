# Brian Hamachek's Book Recommendations

The source for [brianhama.com](https://brianhama.com) — a curated shelf of the best books from the 1,500+ I've read, organized by category. Every recommendation is available as an audiobook.

## How it works

The site is fully static, hosted on GitHub Pages:

- **`index.html`** — the page shell; renders the shelf client-side
- **`books.json`** — the entire book catalog (categories, titles, authors, blurbs, cover URLs, Audible links)
- **`styles.css`** — all styling

## Adding a book

Books are added through an automated pipeline:

1. Open a [new issue](../../issues/new/choose) using the **Add a book** template — paste an Audible URL or ASIN and pick a category.
2. A GitHub Action fetches the title, author, description, and cover from Audible (catalog API, with audnex.us and page-scrape fallbacks), and commits the book straight to `main`.
3. The site redeploys automatically; the book is live in a minute or two.

Only the repository owner's issues trigger the pipeline — issues from other users are closed automatically.

### Scripts

- `scripts/add-book.mjs <ASIN> --category "<name>"` — add one book locally
- `scripts/backfill-blurbs.mjs [--all]` — fill in missing blurbs/covers (or re-distill all blurbs with `--all`); also runs via the **Backfill missing blurbs** workflow

## Local development

No build step. Serve the directory and open it:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```
