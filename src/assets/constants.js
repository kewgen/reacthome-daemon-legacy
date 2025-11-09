
const path = require('path');

const p = (...s) => path.join(process.cwd(), ...s);

module.exports.VAR = p('var');
module.exports.DB = p('var', 'db');
module.exports.TMP = p('var', 'tmp');
module.exports.ASSETS = p('var', 'assets');
