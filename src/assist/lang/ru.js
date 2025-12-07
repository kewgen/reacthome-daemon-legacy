const sqlite = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;
let query = null;
let isInitialized = false;

// Безопасная инициализация
try {
    const dbDir = path.join(process.cwd(), 'var', 'lang');
    const dbPath = path.join(dbDir, 'ru.db');
    
    // Проверка существования директории
    if (!fs.existsSync(dbDir)) {
        console.warn('[ASSIST] Директория var/lang не найдена, морфология отключена');
        isInitialized = false;
    }
    // Проверка существования файла БД
    else if (!fs.existsSync(dbPath)) {
        console.warn('[ASSIST] Файл ru.db не найден, морфология отключена');
        isInitialized = false;
    }
    else {
        // Открытие БД в режиме только для чтения
        db = sqlite(dbPath, { readonly: true });
        
        // Проверка наличия таблицы
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
                db.close();
                db = null;
            }
        } catch (tableError) {
            console.warn('[ASSIST] Ошибка при проверке таблицы forms:', tableError.message);
            console.warn('[ASSIST] Морфология отключена');
            if (db) {
                db.close();
                db = null;
            }
        }
    }
} catch (error) {
    console.warn('[ASSIST] Не удалось инициализировать морфологию:', error.message);
    if (db) {
        try {
            db.close();
        } catch (closeError) {
            // Игнорируем ошибки закрытия
        }
        db = null;
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    if (db) {
        try {
            db.close();
        } catch (error) {
            // Игнорируем ошибки закрытия
        }
    }
});

process.on('SIGTERM', () => {
    if (db) {
        try {
            db.close();
        } catch (error) {
            // Игнорируем ошибки закрытия
        }
    }
});

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
