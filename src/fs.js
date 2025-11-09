
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { ASSETS, TMP } = require('./assets/constants');

const p = (type) => (a = '') => path.join(type, a);

module.exports.tmp = p(TMP);
module.exports.asset = p(ASSETS);
module.exports.stat = promisify(fs.stat);
module.exports.rename = promisify(fs.rename);
module.exports.unlink = promisify(fs.unlink);
module.exports.readdir = promisify(fs.readdir);
module.exports.readFile = promisify(fs.readFile);
module.exports.writeFile = promisify(fs.writeFile);
module.exports.appendFile = promisify(fs.appendFile);
module.exports.exists = file => new Promise(resolve => fs.exists(file, resolve));
module.exports.mkdir = fs.mkdir;
