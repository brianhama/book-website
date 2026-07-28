// Shared helpers for fetching book metadata from Audible.

export function decodeEntities(s) {
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

export function stripHtml(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function truncateBlurb(s, max = 320) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf(' '))).trim() + '...';
}

export async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw lastErr;
}

// Audible's public catalog API: reliable for title/author/cover, but its
// description fields are not always populated.
export async function fromCatalogApi(asin) {
  const url = `https://api.audible.com/1.0/catalog/products/${asin}?response_groups=contributors,product_desc,product_extended_attrs,media&image_sizes=500`;
  const res = await fetchWithRetry(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Audible/3.70 Android' },
  });
  const product = (await res.json()).product;
  if (!product?.title) throw new Error('catalog API returned no product');
  const images = product.product_images || {};
  return {
    title: product.subtitle ? `${product.title}: ${product.subtitle}` : product.title,
    author: (product.authors || []).map((a) => a.name).join(', '),
    blurb: truncateBlurb(stripHtml(product.publisher_summary || product.merchandising_summary || '')),
    cover: images['500'] || Object.values(images)[0] || '',
  };
}

// audnex.us: community-run Audible metadata API with reliable descriptions.
export async function fromAudnex(asin) {
  const res = await fetchWithRetry(`https://api.audnex.us/books/${asin}`, {
    headers: { Accept: 'application/json' },
  });
  const book = await res.json();
  if (!book?.title) throw new Error('audnex returned no book');
  return {
    title: book.subtitle ? `${book.title}: ${book.subtitle}` : book.title,
    author: (book.authors || []).map((a) => a.name).join(', '),
    blurb: truncateBlurb(stripHtml(book.summary || book.description || '')),
    cover: book.image || '',
  };
}

// Last resort: scrape the product page's JSON-LD (bot-gated from datacenter IPs).
export async function fromProductPage(asin) {
  const res = await fetchWithRetry(`https://www.audible.com/pd/${asin}?ipRedirectOverride=true`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  const html = await res.text();
  const meta = { title: null, author: null, blurb: '', cover: '' };
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let parsed;
    try { parsed = JSON.parse(m[1]); } catch { continue; }
    for (const obj of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!/Audiobook|Book|Product/.test(String(obj['@type']))) continue;
      meta.title ||= obj.name;
      meta.cover ||= Array.isArray(obj.image) ? obj.image[0] : obj.image;
      if (!meta.blurb && obj.description) meta.blurb = truncateBlurb(stripHtml(obj.description));
      if (!meta.author && obj.author) {
        const authors = Array.isArray(obj.author) ? obj.author : [obj.author];
        meta.author = authors.map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean).join(', ');
      }
    }
  }
  if (!meta.title) throw new Error('no JSON-LD metadata on product page');
  meta.title = decodeEntities(meta.title).trim();
  meta.author = decodeEntities(meta.author || '').trim();
  return meta;
}

// Merge sources until all fields are filled: catalog API first, then audnex,
// then the product page. Later sources only fill fields still missing.
export async function getMetadata(asin) {
  const sources = [fromCatalogApi, fromAudnex, fromProductPage];
  const meta = { title: '', author: '', blurb: '', cover: '' };
  const errors = [];
  for (const source of sources) {
    if (meta.title && meta.author && meta.blurb && meta.cover) break;
    try {
      const got = await source(asin);
      for (const k of Object.keys(meta)) meta[k] ||= got[k] || '';
    } catch (e) {
      errors.push(`${source.name}: ${e.message}`);
    }
  }
  if (!meta.title || !meta.author) {
    throw new Error(`could not resolve metadata for ${asin} (${errors.join('; ')})`);
  }
  meta.cover = meta.cover.replace(/\._SL\d+_\./, '._SL200_.');
  return meta;
}
