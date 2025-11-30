# Решение проблемы DNS для OpenSearch

## Проблема

DNS не может разрешить доменное имя `c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net`, хотя браузер может подключиться.

## Возможные решения

### 1. Проверка URL в браузере

Убедитесь, что в браузере открыт именно этот URL:
```
https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200
```

Если используется другой URL (например, через веб-интерфейс Yandex Cloud), используйте его.

### 2. Использование IP адреса напрямую

Если браузер может подключиться, получите IP адрес:

**В браузере (Chrome/Edge):**
1. Откройте DevTools (F12)
2. Перейдите на вкладку Network
3. Откройте URL кластера
4. Найдите запрос и посмотрите IP адрес в деталях запроса

**Или через браузерную консоль:**
```javascript
// В консоли браузера на странице кластера
fetch('https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200/')
  .then(r => console.log('Connected to:', r.url))
```

Затем используйте IP адрес в `.env`:
```env
OPENSEARCH_URL=https://<IP_ADDRESS>:9200
```

⚠️ **Важно:** При использовании IP адреса нужно добавить заголовок `Host`:
```javascript
headers: {
  'Host': 'c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net'
}
```

### 3. Настройка системного DNS

**macOS:**
```bash
# Проверить текущие DNS серверы
scutil --dns | grep nameserver

# Добавить Google DNS (временно)
sudo networksetup -setdnsservers Wi-Fi 8.8.8.8 1.1.1.1

# Или через System Preferences > Network > Advanced > DNS
```

### 4. Использование /etc/hosts

Добавьте запись в `/etc/hosts` (если знаете IP адрес):

```bash
sudo nano /etc/hosts
# Добавить:
<IP_ADDRESS> c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net
```

### 5. Проверка через прокси

Если браузер использует прокси, настройте его для Node.js:

```bash
export HTTP_PROXY=http://proxy:port
export HTTPS_PROXY=http://proxy:port
```

### 6. Использование VPN

Если кластер доступен только через VPN:
1. Подключитесь к VPN Yandex Cloud
2. Запустите тест снова

## Быстрая проверка

Получите IP адрес из браузера и обновите `.env`:

```env
OPENSEARCH_URL=https://<IP_ИЗ_БРАУЗЕРА>:9200
```

Затем запустите тест снова.
