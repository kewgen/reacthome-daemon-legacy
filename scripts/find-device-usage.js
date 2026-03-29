#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const DEVICE_ID = process.argv[2] || '50:85:48:15:00:f1';

async function findUsage() {
  console.log(`\n🔍 ПОИСК ИСПОЛЬЗОВАНИЯ УСТРОЙСТВА ${DEVICE_ID}\n`);
  console.log(`[INFO] Подключение к ${WS_URI}...`);
  
  const ws = new WebSocket(WS_URI);
  const messages = [];
  
  const timeout = setTimeout(() => {
    console.log('[ERROR] Таймаут');
    ws.close();
    process.exit(1);
  }, 15000);
  
  ws.on('open', () => {
    console.log('[INFO] Подключение установлено\n');
    
    // Запрашиваем список всех устройств
    ws.send(JSON.stringify({ type: 'list' }));
    
    setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      
      analyze(messages);
      
    }, 5000);
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
    } catch (e) {}
  });
  
  ws.on('error', (error) => {
    console.error('[ERROR]:', error.message);
    clearTimeout(timeout);
    process.exit(1);
  });
}

async function analyze(messages) {
  // Получаем список всех устройств
  const listMsg = messages.find(m => m.type === 'ACTION_LIST');
  if (!listMsg || !listMsg.payload) {
    console.log('❌ Не удалось получить список устройств\n');
    return;
  }
  
  const allDevices = listMsg.payload;
  console.log(`📊 Всего устройств в системе: ${allDevices.length}\n`);
  
  // Ищем устройство по ID
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('🔎 1. ПРЯМОЙ ПОИСК УСТРОЙСТВА\n');
  
  const deviceMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === DEVICE_ID);
  if (deviceMsg && deviceMsg.payload) {
    const device = deviceMsg.payload;
    console.log(`  ✅ Устройство найдено: ${DEVICE_ID}`);
    console.log(`  Данные:`, JSON.stringify(device, null, 2));
    
    // Проверяем тип
    if (device.type) {
      console.log(`\n  Тип: ${device.type}`);
    }
    if (device.title || device.code || device.name) {
      const name = [device.title, device.code, device.name].filter(Boolean).join(' / ');
      console.log(`  Название: ${name}`);
    }
    if (device.bind) {
      console.log(`  Bind (привязка): ${device.bind}`);
    }
  } else {
    console.log(`  ⚠️  Устройство не найдено напрямую`);
  }
  
  // Ищем использование как bind
  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('🔗 2. ПОИСК ИСПОЛЬЗОВАНИЯ КАК BIND (Где это устройство привязано)\n');
  
  let foundAsBinding = false;
  
  for (const id of allDevices) {
    const msg = messages.find(m => m.type === 'ACTION_SET' && m.id === id);
    if (msg && msg.payload && msg.payload.bind === DEVICE_ID) {
      foundAsBinding = true;
      
      const channel = msg.payload;
      console.log(`  ✅ Найдена привязка!\n`);
      console.log(`    Канал: ${id}`);
      
      // Парсим ID канала
      const parts = id.split('/');
      if (parts.length === 3) {
        const [mac, type, index] = parts;
        console.log(`    MAC родительского устройства: ${mac}`);
        console.log(`    Тип канала: ${type}`);
        console.log(`    Индекс: ${index}`);
        
        // Ищем родительское устройство
        const parentMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === mac);
        if (parentMsg && parentMsg.payload) {
          const parent = parentMsg.payload;
          const parentName = [parent.title, parent.code, parent.name].filter(Boolean).join(' / ');
          console.log(`    \n    📦 Родительское устройство: ${parentName || mac}`);
          console.log(`       Тип: ${parent.type} (0x${parent.type?.toString(16)?.toUpperCase() || 'N/A'})`);
          console.log(`       IP: ${parent.ip || 'не указан'}`);
          console.log(`       Статус: ${parent.online ? '🟢 Online' : '🔴 Offline'}`);
        }
      }
      
      console.log(`\n    📄 Данные канала:`);
      console.log(JSON.stringify(channel, null, 2));
      console.log('');
    }
  }
  
  if (!foundAsBinding) {
    console.log(`  ⚠️  Устройство нигде не используется как bind\n`);
  }
  
  // Ищем по части ID (может быть UUID)
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('🔍 3. ПОИСК ПО СОДЕРЖАНИЮ ID (частичное совпадение)\n');
  
  const similar = allDevices.filter(id => 
    typeof id === 'string' && id.toLowerCase().includes(DEVICE_ID.toLowerCase())
  );
  
  if (similar.length > 0) {
    console.log(`  Найдено похожих ID: ${similar.length}\n`);
    similar.forEach(id => {
      console.log(`    - ${id}`);
      const msg = messages.find(m => m.type === 'ACTION_SET' && m.id === id);
      if (msg && msg.payload) {
        const dev = msg.payload;
        const name = [dev.title, dev.code, dev.name].filter(Boolean).join(' / ');
        if (name) {
          console.log(`      Название: ${name}`);
        }
        if (dev.type) {
          console.log(`      Тип: ${dev.type}`);
        }
      }
      console.log('');
    });
  } else {
    console.log(`  ⚠️  Похожих ID не найдено\n`);
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
}

findUsage().catch(console.error);



















