const sip = require('sip');
const calls = require('./calls');
const janus = require('../janus');
const { broadcast } = require('../websocket/peer');
const { BYE, HANGUP, CANCEL } = require('./constants');

module.exports = ({ call_id }, session) => {
  if (calls.has(call_id)) {
    const { id, session_id, handle_id, request } = calls.get(call_id);
    const rq = {
      method: BYE,
      uri: request.headers.contact[0].uri,
      headers: {
        to: request.headers.from,
        from: request.headers.to,
        'call-id': call_id,
        cseq: { method: BYE, seq: 2000 },
        via: [],
      }
    };
    sip.send(rq);
    broadcast({ id, type: BYE, session_id, handle_id, call_id }, session);
    janus.send(session_id, handle_id, { request: HANGUP })
    calls.delete(call_id);
  }
};
