
const firebase = require('firebase-admin');
const { get } = require('../actions');
const mac = require('../mac');
const { deleteToken } = require('./token');
const serviceAccount = require('../../var/firebase.json');

const sound = 'default';

firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccount),
  databaseURL: 'https://reacthome-9021b.firebaseio.com'
});

const params = {
  priority: 'high',
  // timeToLive: 0,
};

const notification = (action) => {
  const { title, code } = get(mac());
  return {
    title: action.title || title || code,
    body: action.message,
    sound,
  };
};

const data = (action) => ({
  id: mac(),
  action: JSON.stringify(action),
});

module.exports.notificationMessage = (action) => ({
  notification: notification(action),
  data: data(action),
})

module.exports.dataMessage = (action) => ({
  data: data(action),
});

module.exports.send = (token, message) => {
  firebase.messaging()
    .sendToDevice(token, message, params)
    .then(({ results = [] } = {}) => {
      for (const result of results) {
        if (result.error) {
          deleteToken(token);
        }
      }
    })
    .catch(console.error);
};
