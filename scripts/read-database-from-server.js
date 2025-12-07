const { Level } = require('level');
const path = require('path');

const BRA_ID = 'e79b2e06-8370-452b-9b13-b0b7a0c57313';
const LOCATION_ID = '6b1afa99-9c1e-496e-8bd4-be7e90b71c8d';
const SCRIPT_ID = '41f41ead-2329-4a9e-a455-81da3651c6b4';
const ACTION_TOGGLE_ID = '3c2f6027-8e1d-4aad-a80c-ca84498ffd39';

const DB_PATH = process.env.DB_PATH || '/home/pi/reacthome-daemon/var/db';

async function readDB() {
  try {
    console.error('Opening DB:', DB_PATH);
    const db = new Level(DB_PATH, { valueEncoding: 'json' });
    const results = { bra: null, location: null, script: null, actionToggle: null, count: 0 };
    
    for await (const [key, value] of db.iterator()) {
      results.count++;
      const keyStr = String(key);
      const valueStr = JSON.stringify(value);
      
      if (keyStr === BRA_ID || valueStr.includes(BRA_ID)) {
        results.bra = { key, value };
      }
      if (keyStr === LOCATION_ID || valueStr.includes(LOCATION_ID)) {
        results.location = { key, value };
      }
      if (keyStr === SCRIPT_ID || valueStr.includes(SCRIPT_ID)) {
        results.script = { key, value };
      }
      if (keyStr === ACTION_TOGGLE_ID || valueStr.includes(ACTION_TOGGLE_ID)) {
        results.actionToggle = { key, value };
      }
    }
    
    console.log(JSON.stringify(results, null, 2));
    await db.close();
  } catch (error) {
    console.error('ERROR:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

readDB();


