const firebase = require('./firebase');
const apn = require('./apn');
const { ANDROID, IOS } = require('./constants');
const { deleteToken } = require('./token');
const { get } = require('../actions');

const send = (service, token, message) => {
  service.send(token, message(service));
}

module.exports.send = (token, message) => {
  const {platform} = get(token);
  switch (platform) {
    case ANDROID:
      send(firebase, token, message);
      break;
    case IOS:
      send(apn, token, message);
      break;
    default: 
      deleteToken(token);
  }
};

module.exports.notificationMessage = (action) => ({notificationMessage}) => notificationMessage(action);
module.exports.dataMessage = (action) => ({dataMessage}) => dataMessage(action);
