const fs = require('fs');
const path = require('path');

// Зачем ? — извлекаем KNOWN_DAEMONS из ws-ssh/index.js и сохраняем в JSON конфиг
function parseKnownDaemons(wsSshPath) {
  const content = fs.readFileSync(wsSshPath, 'utf8');
  const arrStart = content.indexOf('const KNOWN_DAEMONS');
  if (arrStart === -1) return [];
  const bracketStart = content.indexOf('[', arrStart);
  if (bracketStart === -1) return [];
  let i = bracketStart;
  let depth = 0;
  let arrBody = '';
  for (; i < content.length; i++) {
    const ch = content[i];
    arrBody += ch;
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  // Находим все объекты { id: 'uuid', name: '...' }
  const objRe = /\{([^}]+)\}/g;
  const idRe = /id\s*:\s*['"]([0-9a-fA-F-]{36})['"]/i;
  const nameRe = /name\s*:\s*['"]([^'"]+)['"]/i;
  const results = [];
  let m;
  while ((m = objRe.exec(arrBody)) !== null) {
    const objText = m[1];
    const idMatch = objText.match(idRe);
    if (!idMatch) continue;
    const id = idMatch[1];
    const nameMatch = objText.match(nameRe);
    const name = nameMatch ? nameMatch[1] : id;
    results.push({ id, name });
  }
  return results;
}

function writeKnownDaemons(outPath) {
  const wsSsh = path.resolve(__dirname, '..', '..', 'ws-ssh', 'index.js');
  let arr = [];
  try {
    arr = parseKnownDaemons(wsSsh);
  } catch (e) {
    console.error('Не удалось распарсить ws-ssh/index.js:', e.message);
  }
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(arr, null, 2), 'utf8');
    console.log(`Сохранено ${arr.length} демонов в ${outPath}`);
  } catch (e) {
    console.error('Ошибка записи known-daemons.json:', e.message);
  }
}

if (require.main === module) {
  const out = path.resolve(__dirname, 'known-daemons.json');
  writeKnownDaemons(out);
}

module.exports = { parseKnownDaemons, writeKnownDaemons };

