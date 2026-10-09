/* ==========================================================================
   GALLERY — every photo of a product, found without anyone adding them.

   A collected item starts with the one picture that was framed. Most shops
   publish the rest of the product's photos for search engines and link
   previews, in full and in order, and that is read here:

     1. structured data — the page's JSON-LD Product, whose `image` lists the
        gallery (Shopify, Salesforce Commerce — Flos — and most big retailers);
     2. share previews — og:image / twitter:image, when (1) is missing;
     3. the page's own gallery — only on a live page (the overlay's), where
        the pictures' real sizes are known, so a large product shot can be
        told from a thumbnail, swatch or icon.

   Shared by the overlay (a live document) and the background worker (a
   fetched page, as text — a service worker has no DOM, hence the plain
   parsing of fromHtml). Both clean the result the same way: absolute http(s)
   links only, no icons, logos, swatches or SVGs, the same photo at several
   sizes counted once, and the photo the item was collected from left out
   (it is already the item's first image), capped at MAX.
   ========================================================================== */
(function (root) {
  const MAX = 8;

  // Query parameters that only choose a size or format: two links differing
  // only in these are the same photo.
  const SIZE_PARAMS = new Set(['w', 'width', 'h', 'height', 'sw', 'sh', 'sm', 'size', 'q', 'quality',
    'fit', 'crop', 'fm', 'format', 'auto', 'dpr', 'v', 'sfrm', 'strip', 'bgcolor', 'wid', 'hei',
    'qlt', 'fmt', 'op_sharpen', 'resmode', 'imwidth', 'imheight', 'scale', 'trim']);
  const JUNK = /logo|icon|sprite|swatch|placeholder|favicon|badge|payment|flag|rating|star[-_]|avatar|loader|spinner|blank\.|pixel|tracking/i;

  function absolute(u, base) {
    if (!u || typeof u !== 'string') return null;
    u = u.trim().replace(/&amp;/g, '&');
    if (!u || u.startsWith('data:')) return null;
    try {
      const url = new URL(u, base);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch (e) { return null; }
  }

  // The same photo at another size has the same key.
  function photoKey(u) {
    try {
      const url = new URL(u);
      for (const k of [...url.searchParams.keys()]) {
        if (SIZE_PARAMS.has(k.toLowerCase())) url.searchParams.delete(k);
      }
      let path = url.pathname
        .replace(/_(\d+x\d*|\d*x\d+)(@\dx)?(?=\.\w+$)/i, '')   // Shopify _800x800
        .replace(/\/(?:w|h|c|q)_[^/]+(?=\/)/g, '');            // Cloudinary /w_800/
      // The file itself — its folder and name — not the whole address: a
      // shop often serves one photo both directly and through an image
      // service, under different hosts and prefixes (Flos's
      // /on/demandware.static/… and /dw/image/v2/…/on/demandware.static/…).
      const tail = decodeURIComponent(path).split('/').filter(Boolean).slice(-2).join('/');
      return (tail + (url.search || '')).toLowerCase();
    } catch (e) { return u; }
  }

  function clean(urls, exclude) {
    const skip = new Set((exclude || []).filter(Boolean).map(photoKey));
    const seen = new Set();
    const out = [];
    for (const u of urls) {
      if (!u || JUNK.test(u) || /\.svg(\?|$)/i.test(u)) continue;
      const key = photoKey(u);
      if (seen.has(key) || skip.has(key)) continue;
      seen.add(key);
      out.push(u);
      if (out.length >= MAX) break;
    }
    return out;
  }

  // ---------- structured data ----------

  // Every object in a JSON-LD blob, @graph and nesting included.
  function* walk(node) {
    if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
    if (!node || typeof node !== 'object') return;
    yield node;
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') yield* walk(v);
    }
  }
  const isProduct = (o) => {
    const t = o['@type'];
    return (Array.isArray(t) ? t : [t]).some((x) => /^(Product|ProductGroup|IndividualProduct)$/i.test(String(x || '')));
  };
  function imagesOf(img, base) {
    const out = [];
    for (const x of Array.isArray(img) ? img : [img]) {
      if (typeof x === 'string') out.push(absolute(x, base));
      else if (x && typeof x === 'object') out.push(absolute(x.contentUrl || x.url || x['@id'], base));
    }
    return out.filter(Boolean);
  }

  /* The product's photos from its JSON-LD. When a page carries several
     products (a listing, "you may also like"), the one that is this item —
     same link, or a name that matches — not simply the first. */
  function fromJsonLd(blobs, base, hint) {
    const products = [];
    for (const text of blobs) {
      let data;
      try { data = JSON.parse(text); } catch (e) { continue; }
      for (const o of walk(data)) if (isProduct(o) && o.image) products.push(o);
    }
    if (!products.length) return [];
    const want = (hint && hint.title || '').toLowerCase();
    const wantUrl = hint && hint.productUrl ? photoKey(hint.productUrl.split('#')[0]) : '';
    const score = (p) => {
      let s = 0;
      const u = absolute(p.url || p['@id'], base);
      if (u && wantUrl && photoKey(u.split('#')[0]) === wantUrl) s += 10;
      const n = String(p.name || '').toLowerCase();
      if (want && n && (n.includes(want) || want.includes(n))) s += 5;
      return s;
    };
    products.sort((a, b) => score(b) - score(a));
    // A listing with several products and nothing that matches this item:
    // its images belong to other products, so none are taken.
    if (products.length > 1 && score(products[0]) === 0) return [];
    return imagesOf(products[0].image, base);
  }

  // ---------- a fetched page (text) ----------

  function attrs(tag) {
    const out = {};
    const re = /([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m;
    while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
    return out;
  }

  /* The product's own gallery, in a fetched page. Without a layout there is
     no telling a product shot from a thumbnail by size, so the photos are
     read only from INSIDE the page's gallery — the first element whose class
     says gallery or product slider and that holds at least two photos.
     Anything further down the page (related products, "you may also like")
     is never looked at. Each photo is taken at its largest size up to
     LARGEST px wide, sharp in the panel without fetching a 3000px file. */
  const LARGEST = 1600;
  const GALLERY_CLASS = /(?:^|[\s_-])(?:[\w-]*gallery[\w-]*|[\w-]*pdp-slider[\w-]*|product-?images?|primary-images|product-media|pdp-media|product-gallery)(?=$|[\s"'])/i;

  // Where an element that opens at `start` closes, by counting nested
  // tags of its own name.
  function elementEnd(html, start, tag) {
    const re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'gi');
    re.lastIndex = start;
    let depth = 0, m;
    while ((m = re.exec(html))) {
      if (/\/>$/.test(m[0])) continue;
      depth += m[1] ? -1 : 1;
      if (depth === 0) return re.lastIndex;
    }
    return Math.min(html.length, start + 60000);
  }

  function photosIn(chunk, base) {
    const best = new Map();   // photoKey -> { url, w }
    const offer = (u, w) => {
      const url = absolute(u, base);
      if (!url || JUNK.test(url) || /\.svg(\?|$)/i.test(url)) return;
      const key = photoKey(url);
      const cur = best.get(key);
      const fits = (x) => x > 0 && x <= LARGEST;
      // Bigger wins, as long as it is within LARGEST; an unsized one only
      // stands in until a sized one turns up.
      if (!cur || (fits(w) && (!fits(cur.w) || w > cur.w))) best.set(key, { url, w });
    };
    const tags = chunk.match(/<(img|source)\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const a = attrs(tag);
      for (const set of [a.srcset, a['data-srcset']]) {
        if (!set) continue;
        for (const part of set.split(/,(?=\s*\S+\s+\d+[wx])|,\s+/)) {
          const [u, d] = part.trim().split(/\s+/);
          const w = d && /w$/.test(d) ? parseInt(d, 10) : 0;
          offer(u, w);
        }
      }
      for (const k of ['data-src', 'data-zoom', 'data-zoom-image', 'data-large', 'src']) {
        if (a[k]) offer(a[k], 0);
      }
    }
    return [...best.values()].map((v) => v.url);
  }

  function galleryFromHtml(html, base) {
    const open = /<([a-z][\w-]*)\b[^>]*\bclass\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;
    let m;
    while ((m = open.exec(html))) {
      const cls = m[3] ?? m[4] ?? '';
      if (!GALLERY_CLASS.test(' ' + cls + ' ')) continue;
      const end = elementEnd(html, m.index, m[1]);
      const photos = photosIn(html.slice(m.index, end), base);
      if (photos.length >= 2) return photos;
      open.lastIndex = Math.max(open.lastIndex, m.index + 1);
    }
    return [];
  }

  function fromHtml(html, pageUrl, hint) {
    if (!html) return [];
    const blobs = [];
    const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) blobs.push(m[1].trim());
    let found = fromJsonLd(blobs, pageUrl, hint);

    // Structured data that names only the main shot (Flos does): the rest
    // of the product's photos come from its gallery.
    if (found.length < 2) found = found.concat(galleryFromHtml(html, pageUrl));

    if (!found.length) {
      const metas = html.match(/<meta\b[^>]*>/gi) || [];
      for (const tag of metas) {
        const a = attrs(tag);
        const key = (a.property || a.name || '').toLowerCase();
        if (/^(og:image(:secure_url|:url)?|twitter:image(:src)?)$/.test(key)) found.push(absolute(a.content, pageUrl));
      }
    }
    return clean(found.filter(Boolean), hint && hint.exclude);
  }

  // ---------- a live page (the overlay's) ----------

  function fromDocument(doc, pageUrl, hint) {
    const blobs = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent || '');
    let found = fromJsonLd(blobs, pageUrl, hint);

    if (!found.length) {
      for (const meta of doc.querySelectorAll('meta[property^="og:image"], meta[name^="twitter:image"]')) {
        if (/^(og:image(:secure_url|:url)?|twitter:image(:src)?)$/i.test(meta.getAttribute('property') || meta.getAttribute('name') || '')) {
          found.push(absolute(meta.getAttribute('content'), pageUrl));
        }
      }
    }

    // The gallery on the page itself: large pictures inside something that
    // calls itself a gallery or carousel. Only here, where real sizes are
    // known — a fetched page has no layout to tell a product shot from a
    // thumbnail by.
    if (found.length < 2) {
      const galleries = doc.querySelectorAll(
        '[class*="gallery" i], [class*="carousel" i], [class*="slider" i], [class*="product-image" i], ' +
        '[class*="productimage" i], [class*="pdp" i] [class*="media" i], [data-testid*="gallery" i]');
      for (const g of galleries) {
        for (const img of g.querySelectorAll('img')) {
          const w = img.naturalWidth || 0, h = img.naturalHeight || 0;
          if (Math.min(w, h) < 400) continue;
          found.push(absolute(img.currentSrc || img.src, pageUrl));
        }
      }
    }
    return clean(found.filter(Boolean), hint && hint.exclude);
  }

  root.DecidioGallery = { fromHtml, fromDocument, clean, photoKey, MAX };
})(typeof self !== 'undefined' ? self : this);
