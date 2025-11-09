
const sip = require('sip');
const SDP = require('sdp-transform');
const uuid = require('uuid').v4;
const janus = require('../janus');
const { ACK } = require('../sip/constants');
const { GENERATE } = require('../janus/constants');
const { broadcast } = require('../websocket/peer');
const calls = require('./calls');

module.exports = ({ call_id, jsep }, session) => {
  const { id, session_id, handle_id } = calls.get(call_id);
  broadcast({ id, type: ACK, call_id }, session);
  janus.send(session_id, handle_id, { request: GENERATE }, jsep, ({ plugindata }) => {
    if (!plugindata) return;
    if (calls.has(call_id)) {
      const { request } = calls.get(call_id);
      const rs = sip.makeResponse(request, 200, 'Ok');
      // rs.content = plugindata.data.result.sdp;
      const o = SDP.parse(plugindata.data.result.sdp);
      o.media = o.media.filter(media => media.type === 'audio');
      rs.content = SDP.write(o);
      rs.headers.contact = [{ uri: request.headers.to.uri, params: {} }];
      rs.headers.to.params.tag = call_id;
      rs.headers['content-type'] = 'application/sdp';
      rs.headers['content-length'] = rs.content.length;
      sip.send(rs);
    }
  });
};
