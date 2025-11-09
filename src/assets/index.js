const { mkdir, exists } = require('../fs');
const { DB, ASSETS, TMP, VAR } = require('./constants');

const init = (...path) => {
  for (const i of path) {
    exists(i, (alreadyExists, e) => {
      if (e) {
        console.error(e);
      } else if (!alreadyExists) {
        mkdir(i, (e) => {
          if (e) console.error(e);
        });
      }
    });
  }
};

module.exports.init = async () => {
  init(VAR);
  init(DB, ASSETS, TMP);
};
