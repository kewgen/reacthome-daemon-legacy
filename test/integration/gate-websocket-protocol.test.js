#!/usr/bin/env node

/**
 * Интеграционный тест протокола Gate WebSocket
 * 
 * Зачем: Проверяем реальное взаимодействие с Gate WebSocket,
 *        включая отправку LIST/GET запросов и обработку ответов.
 * 
 * ВАЖНО: Этот тест требует реального подключения к Gate WebSocket.
 *        Для запуска без реального подключения используйте моки.
 * 
 * Запуск:
 *   GATE_URL=wss://gate.reacthome.net/test-uuid node test/integration/gate-websocket-protocol.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GATE_URL = process.env.GATE_URL || 'wss://gate.reacthome.net/d31775ae-19e8-40c9-81df-d6d672379563';
const PROTOCOL = 'listen';

// Зачем: Парсинг сообщений с возможным UUID префиксом
function parseGateMaybePrefixedJson(dataString) {
  try {
    return JSON.parse(dataString);
  } catch (_) {
    if (typeof dataString === 'string' && dataString.length >= 36) {
      const possibleSessionId = dataString.substring(0, 36);
      if (UUID_REGEX.test(possibleSessionId)) {
        const messageStr = dataString.substring(36);
        try {
          return JSON.parse(messageStr);
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  }
}

// Зачем: Проверка, что URI ведёт на Gate
function isGateWebSocketUri(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === 'wss:' && u.hostname === 'gate.reacthome.net';
  } catch (_) {
    return false;
  }
}

test('Gate WebSocket: подключение и LIST запрос', { timeout: 10000 }, async () => {
  if (process.env.RUN_INTEGRATION_NETWORK !== '1') {
    console.log('⚠️  Пропуск теста: RUN_INTEGRATION_NETWORK!=1 (сетевой тест)');
    return;
  }
  if (!isGateWebSocketUri(GATE_URL)) {
    console.log('⚠️  Пропуск теста: GATE_URL не указывает на Gate WebSocket');
    return;
  }
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATE_URL, PROTOCOL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Таймаут подключения к Gate'));
    }, 8000);
    
    let listReceived = false;
    
    ws.on('open', () => {
      // Зачем: Отправляем LIST запрос чистым JSON (без UUID префикса)
      const listRequest = { type: 'list' };
      ws.send(JSON.stringify(listRequest));
    });
    
    ws.on('message', (data) => {
      const message = parseGateMaybePrefixedJson(data.toString());
      
      if (!message) return;
      
      // Зачем: Проверяем получение ответа LIST
      if (message.type === 'list' || message.type === 'LIST') {
        listReceived = true;
        assert(Array.isArray(message.state), 'LIST должен содержать массив state');
        
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });
    
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
});

test('Gate WebSocket: GET запрос и ACTION_SET ответ', { timeout: 15000 }, async () => {
  if (process.env.RUN_INTEGRATION_NETWORK !== '1') {
    console.log('⚠️  Пропуск теста: RUN_INTEGRATION_NETWORK!=1 (сетевой тест)');
    return;
  }
  if (!isGateWebSocketUri(GATE_URL)) {
    console.log('⚠️  Пропуск теста: GATE_URL не указывает на Gate WebSocket');
    return;
  }
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATE_URL, PROTOCOL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Таймаут получения данных'));
    }, 12000);
    
    let listReceived = false;
    let deviceId = null;
    
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'list' }));
    });
    
    ws.on('message', (data) => {
      const message = parseGateMaybePrefixedJson(data.toString());
      
      if (!message) return;
      
      if ((message.type === 'list' || message.type === 'LIST') && !listReceived) {
        listReceived = true;
        const stateList = message.state || [];
        if (Array.isArray(stateList) && stateList.length > 0) {
          deviceId = stateList[0][0]; // Берём первый ID из списка
          
          // Зачем: Отправляем GET запрос чистым JSON
          const getRequest = { type: 'get', state: [deviceId] };
          ws.send(JSON.stringify(getRequest));
        }
      }
      
      if ((message.type === 'action_set' || message.type === 'ACTION_SET') && message.id === deviceId) {
        assert(message.payload, 'ACTION_SET должен содержать payload');
        
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });
    
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
});

test('Gate WebSocket: проверка формата сообщений (UUID префикс)', { timeout: 10000 }, async () => {
  if (process.env.RUN_INTEGRATION_NETWORK !== '1') {
    console.log('⚠️  Пропуск теста: RUN_INTEGRATION_NETWORK!=1 (сетевой тест)');
    return;
  }
  if (!isGateWebSocketUri(GATE_URL)) {
    console.log('⚠️  Пропуск теста: GATE_URL не указывает на Gate WebSocket');
    return;
  }
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATE_URL, PROTOCOL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Таймаут проверки формата'));
    }, 8000);
    
    let messagesReceived = 0;
    let hasPrefixed = false;
    let hasPlain = false;
    
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'list' }));
    });
    
    ws.on('message', (data) => {
      const rawStr = data.toString();
      
      // Зачем: Проверяем, есть ли UUID префикс
      if (rawStr.length >= 36) {
        const prefix = rawStr.substring(0, 36);
        if (UUID_REGEX.test(prefix)) {
          hasPrefixed = true;
        }
      }
      
      // Зачем: Проверяем парсинг как plain JSON
      try {
        JSON.parse(rawStr);
        hasPlain = true;
      } catch (_) {
        // Не plain JSON - это нормально, если есть префикс
      }
      
      messagesReceived++;
      
      if (messagesReceived >= 3) {
        // Зачем: Gate может отправлять сообщения в любом формате
        // Важно, что parseGateMaybePrefixedJson обрабатывает оба случая
        assert(
          hasPrefixed || hasPlain,
          'Должны быть получены сообщения хотя бы в одном формате'
        );
        
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });
    
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
});
