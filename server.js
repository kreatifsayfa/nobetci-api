import express from 'express';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 8787;

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
    }
  });
  if (!res.ok) throw new Error(`Kaynak erişim hatası: ${res.status}`);
  return await res.text();
}

function parsePharmacies(html) {
  const $ = cheerio.load(html);
  const items = [];

  // adiyaman.eczaneleri.org yapısı
  const cards = $('li.media');

  cards.each((_, el) => {
    const root = $(el);
    const h4 = root.find('h4').first();
    const district = h4.find('span.label').first().text().replace(/\s+/g, ' ').trim() || null;

    // label'ı çıkartıp eczane adını al
    h4.find('span.label').remove();
    const name = h4.text().replace(/\s+/g, ' ').trim() || null;

    const text = root.find('.media-body').text().replace(/\s+/g, ' ').trim();
    const phoneMatch = text.match(/(0\s*\d{3}\s*\d{3}\s*\d{2}\s*\d{2}|\+?90\s*\d{3}\s*\d{3}\s*\d{2}\s*\d{2})/);

    let address = text;
    if (name) address = address.replace(name, '').trim();
    if (district) address = address.replace(district, '').trim();
    if (phoneMatch) address = address.replace(phoneMatch[0], '').trim();

    if (!name && !address) return;

    items.push({
      name,
      district,
      phone: phoneMatch ? phoneMatch[0].replace(/\s+/g, ' ') : null,
      address: address || null,
      raw: text.slice(0, 400)
    });
  });

  return items;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'nobetci-api' });
});

app.get('/api/nobetci/adiyaman', async (_req, res) => {
  try {
    const sourceUrl = 'https://adiyaman.eczaneleri.org/';
    const html = await fetchHtml(sourceUrl);
    const pharmacies = parsePharmacies(html);

    res.json({
      ok: true,
      city: 'adiyaman',
      source: sourceUrl,
      fetchedAt: new Date().toISOString(),
      count: pharmacies.length,
      pharmacies
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`nobetci-api running on :${PORT}`);
});
