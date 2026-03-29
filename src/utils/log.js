const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

const log = {
  info: (tag, msg, data) => {
    console.log(`[${tag}] ${msg}`, data !== undefined ? data : '');
  },
  warn: (tag, msg, data) => {
    console.warn(`[${tag}] ${msg}`, data !== undefined ? data : '');
  },
  error: (tag, msg, err) => {
    console.error(`[${tag}] ${msg}`, err !== undefined ? err : '');
  },
  debug: (tag, msg, data) => {
    if (DEBUG) console.log(`[${tag}] ${msg}`, data !== undefined ? data : '');
  },
};

module.exports = log;
