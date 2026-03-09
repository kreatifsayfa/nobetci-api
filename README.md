# Nöbetçi Eczane API (Türkiye Geneli)

Türkiye'deki nöbetçi eczane verilerini şehir bazında JSON olarak sunar.

## Canlı API

Base URL:

`https://nobetci-eczane.kreatif.tr`

### Hızlı test

- Sağlık kontrolü:  
  `https://nobetci-eczane.kreatif.tr/health`
- Adıyaman örneği:  
  `https://nobetci-eczane.kreatif.tr/api/nobetci/adiyaman`
- Şehir listesi:  
  `https://nobetci-eczane.kreatif.tr/api/nobetci/cities`

---

## Endpointler

### `GET /health`
Servis ayakta mı kontrolü.

### `GET /api/nobetci/cities`
Tüm şehirlerin slug listesini döner (varsayılan Türkiye 81 il).

Opsiyonel:
- `includeKktc=true` → KKTC'yi de listeye dahil eder.

### `GET /api/nobetci/:city`
Belirli bir şehir için nöbetçi eczaneleri döner.

Örnekler:
- `/api/nobetci/adiyaman`
- `/api/nobetci/ankara`
- `/api/nobetci/izmir`

Not:
- Endpoint varsayılan olarak **taze veri** çekmek üzere ayarlanmıştır.
- İstersen yine de `?refresh=true` verebilirsin.

### `GET /api/nobetci-all?limit=81`
Birden fazla şehrin verisini tek cevapta döner.

Not:
- Varsayılan olarak her şehir için **taze veri** çekilir (`refresh=true`).

---

Not:
- Kaynak site geçici olarak erişilemezse API 502 yerine `ok:false` ve güvenli boş/fallback payload döner.
- Bu durumda `fromCacheFallback=true` olabilir ve `fallbackReason` alanı hata sebebini taşır.

## Yanıt alanları

Şehir endpointinde (`/api/nobetci/:city`) şu alanlar döner:

- `fetchedAt` → verinin çekildiği zaman
- `dutyRangeText` → kaynak sayfadaki nöbet aralığı metni
- `pageDateText` → kaynak sayfadaki tarih metni
- `sectionsCount` → kaynakta tespit edilen nöbet blok sayısı
- `stale` → tarih uyuşmazlığı veya kaynak erişim hatası sonrası cache fallback durumunda `true`
- `fromCacheFallback` → canlı çekim başarısız olup cache verisi döndüyse `true`
- `pharmacies[]`:
  - `name`
  - `district`
  - `phone`
  - `address`
  - `note`

---

## Lokal kurulum (opsiyonel)

```bash
cd nobetci-api
npm install
npm start
```

Lokalde varsayılan port: `8787`

Lokal test:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/nobetci/adiyaman
```


## Otomatik güncelleme

Sunucu açıldığında şehir verileri arka planda otomatik yenilenir ve belirli aralıklarla tekrar çekilir.

Environment değişkenleri:
- `ENABLE_CITY_AUTO_REFRESH=true|false` (varsayılan: `true`)
- `CITY_AUTO_REFRESH_MS` (varsayılan: `300000` = 5 dakika)
