const sqlite = require('better-sqlite3');

const db = sqlite('./var/lang/ru.db');

const query = db.prepare(`
    SELECT DISTINCT f1.text
    FROM forms f1
    JOIN forms f2 ON f1.lemma = f2.lemma
    WHERE f2.text = ?
`)

const getAllForms = (lemma) => query.all(lemma.toLowerCase()).map(row => row.text)

module.exports.getAllForms = getAllForms
