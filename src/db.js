
const { Level } = require('level');
const { DB } = require('./assets/constants');

module.exports = new Level(DB, { valueEncoding: 'json' });
