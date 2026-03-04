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

function splitDutySections(md) {
  const cleaned = md
    .replace(/!\[Image[^\]]*\]\([^\)]*\)/g, '')
    .replace(/\r/g, '');

  const rangeRe = /(\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+(?:Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar)\s+akşamından\s+\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+(?:Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar)\s+sabahına\s+kadar\.?)/gi;
  const ranges = [...cleaned.matchAll(rangeRe)].map((m) => ({ text: m[1], idx: m.index || 0 }));

  if (!ranges.length) return [{ rangeText: null, block: cleaned }];

  const out = [];
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges[i].idx + ranges[i].text.length;
    const end = i + 1 < ranges.length ? ranges[i + 1].idx : cleaned.length;
    out.push({ rangeText: ranges[i].text, block: cleaned.slice(start, end) });
  }
  return out;
}

function pickActiveSection(md) {
  const sections = splitDutySections(md);
  const trMonths = ['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];
  const now = new Date();
  const tomorrow = new Date(Date.now() + 24*60*60*1000);
  const markerToday = `${now.getDate()} ${trMonths[now.getMonth()]}`;
  const markerTomorrow = `${tomorrow.getDate()} ${trMonths[tomorrow.getMonth()]}`;

  let selected = sections.find((s) => {
    const t = (s.rangeText || '').toLowerCase();
    return t.includes(markerToday) && t.includes(markerTomorrow);
  });

  if (!selected) {
    selected = sections.find((s) => (s.rangeText || '').toLowerCase().includes(markerToday));
  }

  if (!selected) selected = sections[sections.length - 1];

  const pageDateMatch = md.replace(/\s+/g, ' ').match(/\((\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+(?:Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar))\)/i);

  return {
    dutyRangeText: selected?.rangeText || null,
    pageDateText: pageDateMatch ? pageDateMatch[1] : null,
    block: selected?.block || md,
    sectionsCount: sections.length
  };
}

function parsePharmaciesFromMarkdown(block) {

  const linkRe = /\[([^\]]+)\]\((https?:\/\/www\.eczaneler\.gen\.tr\/eczane\/[^)]+)\)/g;
  const matches = [...block.matchAll(linkRe)];
  const items = [];

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];

    const name = cur[1].trim();


    const start = (cur.index ?? 0) + cur[0].length;
    const end = next ? (next.index ?? block.length) : block.length;
    const rowBlock = block.slice(start, end);

    const lines = rowBlock
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

    // İlçe normalizasyonu
    if (district) {
      district = district.replace(/\s+/g, ' ').trim();
      if (/^Merkez\s+/i.test(district)) district = 'Merkez';
      if (/\s+Merkez$/i.test(district)) district = district.replace(/\s+Merkez$/i, '').trim() || 'Merkez';
    }

    items.push({
      name,
      district,
      phone,
      address,
      note
    });
  }

  return items;
}

async function fetchCityPharmacies(slug) {
  const key = `city:${slug}`;
  const cached = getCache(key);
  if (cached) return cached;

  const md = await fetchText(`${PROXY_PREFIX}/nobetci-${slug}`);
  const active = pickActiveSection(md);
  const pharmacies = parsePharmaciesFromMarkdown(active.block);

  const out = {
    ok: true,
    citySlug: slug,
    fetchedAt: new Date().toISOString(),
    count: pharmacies.length,
    dutyRangeText: active.dutyRangeText,
    pageDateText: active.pageDateText,
    sectionsCount: active.sectionsCount,
    stale: false,
    pharmacies
  };

  // Basit stale kontrolü: sayfada bugün/yarın metni yoksa şüpheli kabul et
  const trMonths = ['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];
  const now = new Date();
  const tomorrow = new Date(Date.now() + 24*60*60*1000);
  const fmt = (d) => `${d.getDate()} ${trMonths[d.getMonth()]}`;
  const markerToday = fmt(now);
  const markerTomorrow = fmt(tomorrow);
  const fullText = `${active.dutyRangeText || ''} ${active.pageDateText || ''}`.toLowerCase();
  if (fullText && !fullText.includes(markerToday) && !fullText.includes(markerTomorrow)) {
    out.stale = true;
  }

  setCache(key, out);
  return out;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'nobetci-api' });
});

app.get('/api/nobetci/cities', async (req, res) => {
  try {
    const includeKktc = String(req.query.includeKktc || 'false') === 'true';
    const allCities = await fetchCityIndex();
    const cities = includeKktc ? allCities : allCities.filter((c) => c.slug !== 'kibris');
    res.json({ ok: true, count: cities.length, cities, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/nobetci/:city', async (req, res) => {
  try {
    const slug = String(req.params.city || '').toLowerCase().trim();
    const refresh = String(req.query.refresh || 'false') === 'true';
    if (refresh) cache.delete(`city:${slug}`);

    const data = await fetchCityPharmacies(slug);
    res.json(data);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/nobetci-all', async (req, res) => {
  try {
    const includeKktc = String(req.query.includeKktc || 'false') === 'true';
    const allCities = await fetchCityIndex();
    const cities = includeKktc ? allCities : allCities.filter((c) => c.slug !== 'kibris');
    const limit = Math.max(1, Math.min(cities.length, Number(req.query.limit || cities.length)));
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
