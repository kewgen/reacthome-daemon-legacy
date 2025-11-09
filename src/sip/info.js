
const sip = require('sip');
const calls = require('./calls');
const janus = require('../janus');
const { broadcast } = require('../websocket/peer');
const { BYE, HANGUP, INFO } = require('./constants');

module.exports = ({ call_id, signal = '', duration = 100 }, session) => {
  if (calls.has(call_id)) {
    const { request } = calls.get(call_id);
    const content = `Signal=${signal}\nDuration=${duration}`;
    const rq = {
      method: 'INFO',
      uri: request.headers.contact[0].uri,
      headers: {
          to: request.headers.from,
          from: request.headers.to,
          cseq: { method: INFO, seq: 2000 },
          via: [],
          'call-id': call_id,
          'content-type': 'application/dtmf-relay',
          'content-length': content.length
      },
      content
    };
    sip.send(rq);
  }
};
