#!/usr/bin/env node

/**
 * Определение проекта демона по его Daemon ID
 * Использование: node scripts/identify-daemon-project.js <DAEMON_ID>
 * 
 * Зачем: Определить, какой это демон (pochta/почтовая или mindal/лучистое)
 */

const WebSocket = require('ws');

const DAEMON_ID = process.argv[2] || 'fd6765f1-ed61-4ae4-8d72-9a078a9f4316';
const WS_URI = process.env.REACTHOME_WS_URI || `wss://gate.reacthome.net/${DAEMON_ID}`;

async function identifyDaemon() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ ОПРЕДЕЛЕНИЕ ПРОЕКТА ДЕМОНА                               ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Daemon ID: ${DAEMON_ID}`);
  console.log(`WebSocket: ${WS_URI}\n`);
  
  const ws = new WebSocket(WS_URI, ['listen']);
  const messages = [];
  let projectFound = null;
  
  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 15000);
  
  ws.on('open', () => {
    console.log(`[✓] Подключено к ${WS_URI}\n`);
    console.log('[STEP 1] Запрашиваем список всех объектов...\n');
    ws.send(JSON.stringify({ type: 'list' }));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      messages.push(message);
      
      if (message.type === 'list' && message.state) {
        const entityIds = message.state.map(([id]) => id);
        console.log(`[✓] Найдено объектов: ${entityIds.length}\n`);
        console.log('[STEP 2] Запрашиваем данные всех объектов...\n');
        ws.send(JSON.stringify({ type: 'get', state: entityIds }));
        
        setTimeout(() => {
          clearTimeout(timeout);
          analyzeProject();
        }, 5000);
      }
    } catch (error) {
      console.error('❌ Ошибка парсинга:', error.message);
    }
  });
  
  function analyzeProject() {
    console.log('[STEP 3] Анализ проекта...\n');
    
    // 1. Ищем сам демон
    const daemon = messages.find(m => 
      m.type === 'ACTION_SET' && m.id === DAEMON_ID
    );
    
    if (daemon) {
      console.log(`[✓] Найден демон:\n`);
      console.log(`   ID: ${daemon.id}`);
      console.log(`   Тип: ${daemon.payload?.type || '—'}`);
      console.log(`   Token: ${daemon.payload?.token?.length || 0} токенов\n`);
    }
    
    // 2. Ищем проекты (PROJECT)
    const projects = messages.filter(m => 
      m.type === 'ACTION_SET' && 
      (m.payload?.type === 'project' || m.payload?.type === 'PROJECT')
    );
    
    if (projects.length > 0) {
      console.log(`[✓] Найдено проектов: ${projects.length}\n`);
      
      projects.forEach((proj, idx) => {
        const title = proj.payload?.title || proj.payload?.code || '—';
        const code = proj.payload?.code || '—';
        console.log(`[${idx + 1}] Проект: "${title}"`);
        console.log(`    ID: ${proj.id}`);
        console.log(`    Code: ${code}`);
        console.log(`    Тип: ${proj.payload?.type}`);
        
        // Определяем, pochta или mindal
        const projectName = title.toLowerCase();
        const codeName = (code || '').toLowerCase();
        
        // Проверяем по названию и коду
        if (projectName.includes('pochta') || projectName.includes('почтовая') || 
            projectName.includes('архитекторов') || codeName.includes('pochta')) {
          console.log(`    🏠 Проект: ПОЧТОВАЯ (pochta)`);
          projectFound = 'pochta';
        } else if (projectName.includes('mindal') || projectName.includes('лучистое') ||
                   codeName.includes('mindal')) {
          console.log(`    🏠 Проект: ЛУЧИСТОЕ (mindal)`);
          projectFound = 'mindal';
        } else {
          // "ЖК Архитекторов" обычно соответствует pochta (почтовая)
          if (projectName.includes('архитекторов')) {
            console.log(`    🏠 Проект: ПОЧТОВАЯ (pochta) - по умолчанию для "ЖК Архитекторов"`);
            projectFound = 'pochta';
          } else {
            console.log(`    🏠 Проект: ${title} (неизвестный, требуется ручная проверка)`);
          }
        }
        console.log('');
      });
    } else {
      console.log('⚠️  Проекты не найдены\n');
    }
    
    // 3. Ищем устройства с известными локациями
    const sites = messages.filter(m => 
      m.type === 'ACTION_SET' && 
      (m.payload?.type === 'site' || m.payload?.type === 'SITE')
    );
    
    if (sites.length > 0) {
      console.log(`[✓] Найдено локаций: ${sites.length}\n`);
      
      // Показываем первые 5 локаций
      sites.slice(0, 5).forEach((site, idx) => {
        const title = site.payload?.title || site.payload?.code || '—';
        console.log(`[${idx + 1}] ${title} (${site.id.substring(0, 8)}...)`);
      });
      
      if (sites.length > 5) {
        console.log(`    ... и ещё ${sites.length - 5} локаций\n`);
      } else {
        console.log('');
      }
    }
    
    // 4. Вывод результата
    console.log(`╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║ РЕЗУЛЬТАТ                                                ║`);
    console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
    
    if (projectFound) {
      console.log(`✅ Демон: ${DAEMON_ID}`);
      console.log(`✅ Проект: ${projectFound.toUpperCase()}`);
      if (projectFound === 'pochta') {
        console.log(`✅ Название: ПОЧТОВАЯ\n`);
      } else {
        console.log(`✅ Название: ЛУЧИСТОЕ\n`);
      }
    } else {
      console.log(`⚠️  Проект не определён автоматически`);
      console.log(`   Проверьте проекты вручную выше\n`);
    }
    
    console.log(`📊 Статистика:`);
    console.log(`   Всего объектов: ${messages.length}`);
    console.log(`   Проектов: ${projects.length}`);
    console.log(`   Локаций: ${sites.length}`);
    console.log('');
    
    ws.close();
    process.exit(0);
  }
  
  ws.on('error', (error) => {
    console.error('❌ Ошибка WebSocket:', error.message);
    clearTimeout(timeout);
    process.exit(1);
  });
}

identifyDaemon();

