import express from 'express';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 8787;

const ORIGIN = 'https://www.eczaneler.gen.tr';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat
const ENABLE_CITY_AUTO_REFRESH = String(process.env.ENABLE_CITY_AUTO_REFRESH || 'true') === 'true';
const REFRESH_HOURS = [12, 23]; // İstanbul GMT+3 saat 12:00 ve 23:59
const REFRESH_MINUTE = 59; // 23:59 için dakika

const cache = new Map();

async function fetchHTML(url) {
  const bust = `_=${Date.now()}`;
  const sep = url.includes('?') ? '&' : '?';
  const cacheSafeUrl = `${url}${sep}${bust}`;

  const res = await fetch(cacheSafeUrl, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache, no-store, max-age=0',
      'pragma': 'no-cache'
    }
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

  const html = await fetchHTML(`${ORIGIN}/`);
  const $ = cheerio.load(html);

  const cities = [];
  $('a[href*="/nobetci-"]').each((i, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    const city = $el.text().trim();

    if (href && city && href.includes('/nobetci-')) {
      const slug = href.split('/').pop().replace('nobetci-', '');
      cities.push({ city, slug, approxCount: 0 });
    }
  });

  setCache(key, cities);
  return cities;
}

async function fetchCityPharmacies(slug, forceRefresh = false) {
  const key = `city:${slug}`;
  const cached = getCache(key);

  if (!forceRefresh && cached) {
    return cached;
  }

  try {
    const html = await fetchHTML(`${ORIGIN}/nobetci-${slug}`);
    const $ = cheerio.load(html);

    // Nöbetçi dönem metinlerini al (alert-warning div'ler)
    const dutyRangeTexts = [];
    $('.alert-warning').each((i, el) => {
      const text = $(el).text().trim();
      if (text) dutyRangeTexts.push(text);
    });

    // Aktif dönemi bul (bugün veya yarının tarihini içeren)
    const trMonths = ['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];
    const trDays = { 'pazar': 'Pazar', 'pazartesi': 'P.tesi', 'salı': 'Salı', 'çarşamba': 'Çarş', 'perşembe': 'Perş', 'cuma': 'Cuma', 'cumartesi': 'C.tesi' };
    const now = new Date();
    const tomorrow = new Date(Date.now() + 24*60*60*1000);
    const fmt = (d) => `${d.getDate()} ${trMonths[d.getMonth()]}`;
    const markerToday = fmt(now).toLowerCase();
    const markerTomorrow = fmt(tomorrow).toLowerCase();

    let dutyRangeText = dutyRangeTexts.find(t =>
      t.toLowerCase().includes(markerToday) && t.toLowerCase().includes(markerTomorrow)
    ) || dutyRangeTexts.find(t =>
      t.toLowerCase().includes(markerToday)
    ) || dutyRangeTexts[dutyRangeTexts.length - 1] || null;

    // Eczane satırlarını parse et
    const pharmacies = [];
    $('td.border-bottom').each((i, el) => {
      const $row = $(el);
      const $isim = $row.find('.isim').first();
      const name = $isim.text().trim();

      if (!name) return;

      // Adres bilgisi - ikinci col-lg-6 div
      const $addressDiv = $row.find('.col-lg-6').first();
      const addressHtml = $addressDiv.html() || '';
      const addressLines = $addressDiv.contents().filter((i, el) => el.nodeType === 3).map((i, el) => $(el).text().trim()).get();

      let address = null;
      let note = null;

      // Adres satırlarını kontrol et
      for (const line of addressLines) {
        if (line && line.length > 10 && !line.includes('»')) {
          address = line;
          break;
        }
      }

      // Not kontrolü (» ile başlayan)
      const $italic = $addressDiv.find('.font-italic');
      if ($italic.length) {
        note = $italic.text().trim();
      }

      // İlçe bilgisi - bg-info ve bg-secondary span'ler
      let district = null;
      const $districts = $addressDiv.find('span[class*="bg-"]');
      if ($districts.length >= 2) {
        district = $districts.eq(1).text().trim();
      } else if ($districts.length === 1) {
        district = $districts.eq(0).text().trim();
      }

      // Telefon numarası - col-lg-3 div, regex ile çıkar
      const phoneText = $row.find('.col-lg-3').text().trim() || '';
      const phoneMatch = phoneText.match(/0\s*\(\d{3}\)\s*\d{3}[\-\s]?\d{2}[\-\s]?\d{2}|0\s*\d{3}\s*\d{3}\s*\d{2}\s*\d{2}|\+90\s*\d{3}\s*\d{3}\s*\d{2}\s*\d{2}/);
      const phone = phoneMatch ? phoneMatch[0].replace(/\s+/g, ' ').trim() : null;

      // İlçe normalizasyonu
      if (district) {
        district = district.replace(/\s+/g, ' ').trim();
        if (/^Merkez\s+/i.test(district)) district = 'Merkez';
        if (/\s+Merkez$/i.test(district)) district = district.replace(/\s+Merkez$/i, '').trim() || 'Merkez';
      }

      pharmacies.push({
        name,
        district,
        phone,
        address,
        note
      });
    });

    const out = {
      ok: true,
      citySlug: slug,
      fetchedAt: new Date().toISOString(),
      count: pharmacies.length,
      dutyRangeText: dutyRangeText,
      pageDateText: null,
      sectionsCount: 1,
      stale: false,
      fromCacheFallback: false,
      pharmacies
    };

    // Stale kontrolü
    const fullText = (dutyRangeText || '').toLowerCase();
    if (fullText && !fullText.includes(markerToday) && !fullText.includes(markerTomorrow)) {
      out.stale = true;
    }

    setCache(key, out);
    return out;
  } catch (e) {
    if (cached) {
      return {
        ...cached,
        stale: true,
        fromCacheFallback: true,
        fallbackReason: e.message,
        fallbackAt: new Date().toISOString()
      };
    }

    throw e;
  }
}


async function refreshAllCities() {
  const allCities = await fetchCityIndex();
  const cities = allCities.filter((c) => c.slug !== 'kibris');

  for (const city of cities) {
    try {
      await fetchCityPharmacies(city.slug, true);
    } catch (e) {
      console.error(`[refresh] ${city.slug} yenilenemedi: ${e.message}`);
    }
  }

  console.log(`[refresh] ${cities.length} şehir güncellendi`);
}

// Bir sonraki güncelleme saatini hesapla (12:00 veya 23:59)
function getNextRefreshTime() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Bugünkü 12:00 geçtiyse, 23:59'u bekle, yoksa 12:00'ı bekle
  let targetHour, targetMinute;

  if (currentHour < 12 || (currentHour === 12 && currentMinute === 0)) {
    targetHour = 12;
    targetMinute = 0;
  } else if (currentHour < 23 || (currentHour === 23 && currentMinute < 59)) {
    targetHour = 23;
    targetMinute = REFRESH_MINUTE;
  } else {
    // 23:59'i geçtik, yarının 12:00'ını bekle
    targetHour = 12;
    targetMinute = 0;
  }

  const target = new Date(now);
  target.setHours(targetHour, targetMinute, 0, 0);

  // Eğer hedef zaman geçmişse, bir sonraki güne ayarla
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return target;
}

function scheduleNextRefresh() {
  const nextTime = getNextRefreshTime();
  const now = new Date();
  const delay = nextTime - now;

  console.log(`[refresh] Sonraki güncelleme: ${nextTime.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })} (${Math.round(delay / 60000)} dakika sonra)`);

  setTimeout(async () => {
    console.log(`[refresh] Planlanan güncelleme başladı: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    try {
      await refreshAllCities();
    } catch (e) {
      console.error(`[refresh] Planlanan güncelleme hatası: ${e.message}`);
    }
    // Bir sonraki güncellemeyi planla
    scheduleNextRefresh();
  }, delay);
}

function startAutoRefresh() {
  if (!ENABLE_CITY_AUTO_REFRESH) return;

  // Başlangıçta bir kez çalıştır (cache'i doldurmak için)
  refreshAllCities().catch((e) => {
    console.error(`[refresh] Başlangıç güncellemesi hatası: ${e.message}`);
  });

  // Sonra planlı güncellemeleri başlat
  scheduleNextRefresh();
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
    // Varsayılanı true yaptık: her istek güncel çekim
    const refresh = String(req.query.refresh || 'false') === 'true';

    const data = await fetchCityPharmacies(slug, refresh);
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
        const refresh = String(req.query.refresh || 'false') === 'true';
        const cityData = await fetchCityPharmacies(c.slug, refresh);
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

startAutoRefresh();

app.listen(PORT, () => {
  console.log(`nobetci-api running on :${PORT}`);
});
