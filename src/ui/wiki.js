/**
 * The species page.
 *
 * Wikipedia's REST summary endpoint is CORS-open and returns a clean extract
 * plus a lead image. We look up the scientific name first — for marine species
 * it's usually either the article title or a redirect to it — and fall back to
 * the common name when there's no such article.
 */

const SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

const cache = new Map();

async function lookup(title) {
  const res = await fetch(SUMMARY + encodeURIComponent(title.replace(/ /g, '_')), {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return null;
  const d = await res.json();

  // Disambiguation pages and stubs about something else entirely are worse than
  // nothing — they'd put a page about a rock band under a fish.
  if (d.type === 'disambiguation' || !d.extract) return null;

  return {
    title: d.title,
    extract: d.extract,
    image: d.thumbnail?.source ?? d.originalimage?.source ?? null,
    url: d.content_urls?.desktop?.page ?? null,
    description: d.description ?? null,
  };
}

/** Wikipedia article for a species, or null. Tries scientific name, then common. */
export function articleFor(species) {
  const key = species.sci;
  if (cache.has(key)) return cache.get(key);

  const job = (async () => {
    try {
      const bySci = await lookup(species.sci);
      if (bySci) return bySci;
      if (species.common) return await lookup(species.common);
      return null;
    } catch {
      return null;
    }
  })();

  cache.set(key, job);
  return job;
}
