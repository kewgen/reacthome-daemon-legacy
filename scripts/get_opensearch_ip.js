#!/usr/bin/env node

/**
 * Скрипт для получения IP адреса OpenSearch кластера
 * 
 * Использование:
 * 1. Откройте кластер в браузере: https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200
 * 2. Откройте DevTools (F12) > Console
 * 3. Выполните:
 *    fetch('https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200/')
 *      .then(r => console.log('URL:', r.url))
 * 4. Или на вкладке Network найдите запрос и посмотрите IP в деталях
 * 
 * Затем обновите .env:
 * OPENSEARCH_URL=https://<IP>:9200
 */

console.log(`
Для получения IP адреса OpenSearch кластера:

1. Откройте в браузере:
   https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200

2. Откройте DevTools (F12) > Network tab

3. Обновите страницу (F5)

4. Найдите запрос к кластеру и посмотрите:
   - Remote Address (IP:port)
   - Или в Headers > General > Remote Address

5. Скопируйте IP адрес (без порта)

6. Обновите .env:
   OPENSEARCH_URL=https://<IP>:9200

Альтернативно, в консоли браузера (Console tab):
fetch('https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200/')
  .then(r => {
    console.log('Response URL:', r.url);
    // IP будет виден в Network tab
  })
`);
