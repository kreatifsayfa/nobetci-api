# Nöbetçi Eczane API (Türkiye Geneli)

Canlı servis: `https://nobetci-eczane.kreatif.tr`

Bu API artık **API key + domain doğrulama + attribution denetimi** ile çalışır.

## Attribution Kuralı
API kullanan sitede görünür şekilde şu ifade bulunmalıdır:

`Developed by kreatif.tr`

Periyodik denetimde bu ifade yoksa istemci key'i otomatik `blocked` olur.

---

## Genel endpointler

- `GET /health`
- `GET /api/nobetci/cities`
- `GET /api/nobetci/:city`
- `GET /api/nobetci-all?limit=81`

> `/api/*` çağrılarında `x-api-key` zorunludur.

Örnek:
```bash
curl 'https://nobetci-eczane.kreatif.tr/api/nobetci/adiyaman' \
  -H 'x-api-key: YOUR_KEY' \
  -H 'x-client-domain: example.com'
```

---

## Admin endpointleri (x-admin-token gerekli)

- `POST /admin/client`
- `PATCH /admin/client/:key`
- `GET /admin/clients`

### 1) Client oluştur
```bash
curl -X POST 'https://nobetci-eczane.kreatif.tr/admin/client' \
  -H 'content-type: application/json' \
  -H 'x-admin-token: ADMIN_TOKEN' \
  -d '{
    "key":"CLIENT_KEY_123",
    "name":"my-site",
    "domains":["example.com"],
    "requireAttribution":true
  }'
```

### 2) Client durum/domain güncelle
```bash
curl -X PATCH 'https://nobetci-eczane.kreatif.tr/admin/client/CLIENT_KEY_123' \
  -H 'content-type: application/json' \
  -H 'x-admin-token: ADMIN_TOKEN' \
  -d '{"status":"active","domains":["example.com","www.example.com"]}'
```

### 3) Client listesi
```bash
curl 'https://nobetci-eczane.kreatif.tr/admin/clients' \
  -H 'x-admin-token: ADMIN_TOKEN'
```

---

## Environment

- `PORT` (default `8787`)
- `ADMIN_TOKEN` (zorunlu, prod'da değiştir)

---

## Not

`/api/nobetci/:city` varsayılan olarak taze veri çeker (refresh davranışı aktif). Tarih alanları:
- `dutyRangeText`
- `pageDateText`
- `stale`
