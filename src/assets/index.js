const { mkdir, exists } = require('../fs');
const path = require('path');
const { DB, ASSETS, TMP, VAR, BACKUPS_GC } = require('./constants');

const init = (...paths) => {
  for (const i of paths) {
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
  // var/backups/gc для бэкапов LevelDB перед gc.cleanup()
  init(path.dirname(BACKUPS_GC));  // var/backups
  init(BACKUPS_GC);                 // var/backups/gc
};
