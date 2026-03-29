#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const SITE_ID = 'a2841fed-ec2c-4a58-865a-5ae17316010f';

async function getSite() {
  const ws = new WebSocket(WS_URI);
  
  const messages = [];
  const timeout = setTimeout(() => {
    ws.close();
    process.exit(1);
  }, 10000);
  
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'get', state: [SITE_ID] }));
    
    setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      
      const siteMsgs = messages.filter(m => 
        m.type === 'ACTION_SET' && m.id === SITE_ID
      );
      
      if (siteMsgs.length > 0) {
        const payload = siteMsgs[0].payload || {};
        console.log(`📍 Локация: ${payload.title || payload.code || 'Не указано'}`);
      }
    }, 2000);
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
    } catch (e) {}
  });
  
  ws.on('error', () => {
    clearTimeout(timeout);
    process.exit(1);
  });
}

getSite().catch(() => {});
