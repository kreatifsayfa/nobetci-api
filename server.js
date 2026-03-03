import express from 'express';

const app = express();
const PORT = process.env.PORT || 8787;

const ORIGIN = 'http://www.eczaneler.gen.tr';
const PROXY_PREFIX = 'https://r.jina.ai/http://www.eczaneler.gen.tr';
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map();

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0' }
  });
  if (!res.ok) throw new Error(`Kaynak hatası: ${res.status}`);
  return await res.text();
}

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function setCache(key, data) {
  cache.set(key, { at: Date.now(), data });
}

async function fetchCityIndex() {
  const key = 'cityIndex';
  const cached = getCache(key);
  if (cached) return cached;

  const text = await fetchText(`${PROXY_PREFIX}/`);
  const regex = /\[([^\]]+)\]\((http:\/\/www\.eczaneler\.gen\.tr\/nobetci-[^)]+)\s+"[^"]*"\)\((\d+)\)/g;

  const cities = [];
  for (const m of text.matchAll(regex)) {
    const city = m[1].trim();
    const href = m[2].trim();
    const count = Number(m[3] || 0);
    const slug = href.split('/').pop().replace('nobetci-', '');
    cities.push({ city, slug, href, approxCount: count });
  }

  setCache(key, cities);
  return cities;
}

function parsePharmaciesFromMarkdown(md) {
  const cleaned = md
    .replace(/!\[Image[^\]]*\]\([^\)]*\)/g, '')
    .replace(/\r/g, '');

  const linkRe = /\[([^\]]+)\]\((https?:\/\/www\.eczaneler\.gen\.tr\/eczane\/[^)]+)\)/g;
  const matches = [...cleaned.matchAll(linkRe)];
  const items = [];

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];

    const name = cur[1].trim();
    const detailUrl = cur[2].trim();

    const start = (cur.index ?? 0) + cur[0].length;
    const end = next ? (next.index ?? cleaned.length) : cleaned.length;
    const block = cleaned.slice(start, end);

    const lines = block
      .split('\n')
      .map((l) => l.replace(/[*_`>#]/g, '').trim())
      .filter(Boolean);

    let address = null;
    let note = null;
    let district = null;
    let phone = null;

    for (const line of lines) {
      if (!phone) {
        const p = line.match(/(0\s*\(\d{3}\)\s*\d{3}[\-\s]?\d{2}[\-\s]?\d{2}|0\s*\d{3}\s*\d{3}\s*\d{2}\s*\d{2}|\+90\s*\d{3}\s*\d{3}\s*\d{2}\s*\d{2})/);
        if (p) {
          phone = p[0].replace(/\s+/g, ' ').trim();
          continue;
        }
      }

      if (!note && line.startsWith('»')) {
        note = line.replace(/^»\s*/, '').trim();
        continue;
      }

      if (!address && /\//.test(line)) {
        address = line;
        continue;
      }

      if (!district && !/\//.test(line) && line.length < 40) {
        district = line;
      }
    }

    if (!district && address) {
      const m = address.match(/([^\/]+)\s*\/\s*[^\/]+$/);
      if (m) district = m[1].trim();
    }

    items.push({
      name,
      district,
      phone,
      address,
      note,
      detailUrl
    });
  }

  return items;
}

async function fetchCityPharmacies(slug) {
  const key = `city:${slug}`;
  const cached = getCache(key);
  if (cached) return cached;

  const md = await fetchText(`${PROXY_PREFIX}/nobetci-${slug}`);
  const pharmacies = parsePharmaciesFromMarkdown(md);
  const out = {
    ok: true,
    citySlug: slug,
    source: `${ORIGIN}/nobetci-${slug}`,
    fetchedAt: new Date().toISOString(),
    count: pharmacies.length,
    pharmacies
  };

  setCache(key, out);
  return out;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'nobetci-api', source: 'eczaneler.gen.tr (via r.jina.ai)' });
});

app.get('/api/nobetci/cities', async (_req, res) => {
  try {
    const cities = await fetchCityIndex();
    res.json({ ok: true, count: cities.length, cities, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/nobetci/:city', async (req, res) => {
  try {
    const slug = String(req.params.city || '').toLowerCase().trim();
    const data = await fetchCityPharmacies(slug);
    res.json(data);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/nobetci-all', async (req, res) => {
  try {
    const cities = await fetchCityIndex();
    const limit = Math.max(1, Math.min(81, Number(req.query.limit || 81)));
    const selected = cities.slice(0, limit);

    const results = [];
    for (const c of selected) {
      try {
        const cityData = await fetchCityPharmacies(c.slug);
        results.push({ city: c.city, slug: c.slug, count: cityData.count, pharmacies: cityData.pharmacies });
      } catch (e) {
        results.push({ city: c.city, slug: c.slug, ok: false, error: e.message, pharmacies: [] });
      }
    }

    res.json({
      ok: true,
      source: `${ORIGIN}`,
      fetchedAt: new Date().toISOString(),
      cityCount: results.length,
      totalPharmacies: results.reduce((a, b) => a + (b.count || 0), 0),
      results
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`nobetci-api running on :${PORT}`);
});
