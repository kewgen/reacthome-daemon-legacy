const sqlite = require('better-sqlite3');
const path = require('path');

let db = null;
let query = null;
let isInitialized = false;

// Безопасная инициализация
try {
    const dbPath = path.join(process.cwd(), 'var', 'lang', 'ru.db');
    db = sqlite(dbPath);
    
    // Проверка наличия таблицы (безопасно, используем try-catch)
    try {
        const checkTable = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='forms'
        `);
        const tableExists = checkTable.get();
        
        if (tableExists) {
            query = db.prepare(`
                SELECT DISTINCT f1.text
                FROM forms f1
                JOIN forms f2 ON f1.lemma = f2.lemma
                WHERE f2.text = ?
            `);
            isInitialized = true;
        } else {
            console.warn('[ASSIST] Таблица forms не найдена в ru.db, морфология отключена');
        }
    } catch (tableError) {
        console.warn('[ASSIST] Ошибка при проверке таблицы forms:', tableError.message);
        console.warn('[ASSIST] Морфология отключена');
    }
} catch (error) {
    console.warn('[ASSIST] Не удалось инициализировать морфологию:', error.message);
}

const getAllForms = (lemma) => {
    if (!isInitialized || !query) {
        return []; // Возвращаем пустой массив, если БД не инициализирована
    }
    
    try {
        return query.all(lemma.toLowerCase()).map(row => row.text);
    } catch (error) {
        console.warn(`[ASSIST] Ошибка при получении форм для "${lemma}":`, error.message);
        return []; // Возвращаем пустой массив при ошибке
    }
}

module.exports.getAllForms = getAllForms
