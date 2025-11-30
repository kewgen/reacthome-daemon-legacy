# Подключение к Yandex Managed OpenSearch

## Порт и Endpoint

Для Yandex Cloud Managed Service for OpenSearch используется:

- **Порт:** `9200` (стандартный порт OpenSearch HTTP API)
- **Протокол:** `HTTPS` (обязательно, только SSL/TLS соединения)
- **Endpoint для Bulk API:** `/_bulk` (для массовой отправки событий)

## Формат URL

URL должен содержать полный адрес с портом:

```
https://<FQDN>:9200
```

Где `<FQDN>` - это полное доменное имя хоста с ролью `DATA` из вашего кластера.

**Реальный URL для кластера:**
```
https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200
```

⚠️ **Важно:** URL должен включать порт `:9200` в конце!

## OpenSearch Dashboards

**URL дашборда:**
```
https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net/app/home#/
```

Дашборд доступен по тому же хосту, что и API, но без указания порта и с путем `/app/home#/`.

**Авторизация:**
- Используйте те же учетные данные, что и для API (Basic Auth)
- Пользователь: `admin` (или значение из `OPENSEARCH_USER`)
- Пароль: значение из переменной окружения `OPENSEARCH_PASSWORD`

## Endpoints, используемые в системе

### 1. Проверка доступности
```
GET https://<FQDN>:9200/_cluster/health
```

### 2. Проверка/создание индекса
```
HEAD https://<FQDN>:9200/<index-name>
PUT https://<FQDN>:9200/<index-name>
```

### 3. Отправка событий (Bulk API)
```
POST https://<FQDN>:9200/_bulk
Content-Type: application/x-ndjson
```

### 4. Поиск событий
```
GET https://<FQDN>:9200/<index-name>/_doc/<doc-id>
POST https://<FQDN>:9200/<index-name>/_search
```

## Аутентификация

Используется **Basic Authentication** через заголовок:

```
Authorization: Basic <base64(user:password)>
```

## SSL/TLS

Обязательно использование SSL-сертификата Yandex Cloud:

1. Скачать сертификат:
   ```bash
   wget "https://storage.yandexcloud.net/cloud-certs/CA.pem" \
        --output-document ~/.opensearch/root.crt
   ```

2. Использовать в HTTPS Agent:
   ```javascript
   const httpsAgent = new https.Agent({
     ca: fs.readFileSync('~/.opensearch/root.crt'),
     rejectUnauthorized: true
   });
   ```

## Проверка подключения

```bash
curl -X GET "https://<FQDN>:9200/_cluster/health" \
     -u admin:password \
     --cacert ~/.opensearch/root.crt
```

## Источники

- [Документация Yandex Cloud: Подключение к OpenSearch](https://yandex.cloud/ru/docs/managed-opensearch/operations/connect)

