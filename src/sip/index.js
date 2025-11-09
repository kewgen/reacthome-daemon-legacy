
const sip = require('sip');
const { INVITE, REGISTER, CANCEL, BYE } = require('./constants');
const { onRegister, onInvite, onCancel, onBye } = require('./handle');

const options = {
  logger: {
    error: console.error
  }
};

module.exports.start = () => {
  sip.start(options, (request) => {
    switch(request.method) {
      case REGISTER: {
        onRegister(request);
        break;
      }
      case INVITE: {
        onInvite(request);
        break;
      }
      case CANCEL: {
        onCancel(request);
        break;
      }
      case BYE: {
        onBye(request);
        break;
      }
    }
  });
};
