# Adıyaman Nöbetçi Eczane API (Ücretsiz)

Kaynak: `https://adiyaman.eczaneleri.org/`

## Kurulum

```bash
cd nobetci-api
npm install
npm start
```

## Endpointler

- `GET /health`
- `GET /api/nobetci/adiyaman`
- `GET /api/nobetci/adiyaman?refresh=true` (cache bypass)

Dönen yanıtta tarih doğrulama alanları:
- `dutyRangeText`
- `pageDateText`
- `stale` (true ise kaynak tarihi bugün/yarınla uyuşmuyor olabilir)

Örnek:

```bash
curl http://127.0.0.1:8787/api/nobetci/adiyaman
```
