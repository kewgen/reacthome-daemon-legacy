
const url = require('url');
const sip = require('sip');
const SDP = require('sdp-transform');
const uuid = require('uuid').v4;
const janus = require('../janus');
const { fixSDP } = require('../sdp');
const notification = require('../notification');
const { broadcast } = require('../websocket/peer');
const { PROCESS } = require('../janus/constants');
const { INVITE, BYE, CANCEL, HANGUP } = require('./constants');
const { get } = require('../actions');
const calls = require('./calls');
const mac = require('../mac');

const realm = 'reacthome';
const tag = '123456';

module.exports.onRegister = (request) => {
  let rs;
  rs = sip.makeResponse(request, 200, 'Ok');
  rs.headers.contact = [{ uri: request.headers.contact[0].uri, expires: 3600 }];
  rs.headers.to.params.tag = uuid();
  sip.send(rs);
};

module.exports.onCancel = (request) => {
  let rs;
  const call_id = request.headers['call-id'];
  rs = sip.makeResponse(request, 200, 'Ok');
  rs.headers.to.params.tag = call_id;
  sip.send(rs);
  if (calls.has(call_id)) {
    const { id, session_id, handle_id } = calls.get(call_id);
    janus.send(session_id, handle_id, { request: HANGUP })
    broadcast({ id, type: CANCEL, session_id, handle_id, call_id });
    calls.delete(call_id);
  }
};

module.exports.onBye = (request) => {
  let rs;
  const call_id = request.headers['call-id'];
  rs = sip.makeResponse(request, 200, 'Ok');
  rs.headers.contact = [{ uri: request.headers.contact[0].uri }];
  rs.headers.to.params.tag = call_id;
  sip.send(rs);
  if (calls.has(call_id)) {
    const { id, session_id, handle_id } = calls.get(call_id);
    janus.send(session_id, handle_id, { request: HANGUP })
    broadcast({ id, type: BYE, session_id, handle_id, call_id });
    calls.delete(call_id);
  }
};

const rs100 = (call_id, request) => {
  const rs = sip.makeResponse(request, 100, 'Ok');
  rs.headers.to.params.tag = call_id;
  return rs;
}

const rs180 = (call_id, request) => {
  const rs = sip.makeResponse(request, 180, 'Ok');
  rs.headers.contact = [{ uri: request.headers.to.uri, params: {} }];
  rs.headers.to.params.tag = call_id;
  return rs;
}

const findIntercom = (id, auth) => {
  const o = get(id);
  if (Array.isArray(o.intercom)) {
    const from = o.intercom.find(i => get(i).SIP_user === auth);
    if (from) return from;
  }
  if (Array.isArray(o.site)) {
    return o.site.reduce((a, b) => {
      if (a) return a;
      return findIntercom(b, auth);
    }, false)
  }
};

module.exports.onInvite = (request) => {
  const { auth } = url.parse(request.headers.from.uri);
  const { project } = get(mac()) || {};
  const id = findIntercom(project, auth);
  if (!id) return;
  const call_id = request.headers['call-id'];
  sip.send(rs100(call_id, request));
  sip.send(rs180(call_id, request));
  janus.createSession((session_id) => {
    janus.attachPlugin(session_id, 'janus.plugin.nosip', (handle_id) => {
      calls.set(call_id, { id, session_id, handle_id, request });
      const o = SDP.parse(request.content);
      o.media = o.media.filter(media => media.type === 'audio');
      janus.send(session_id, handle_id, {
        request: PROCESS,
        type: 'offer',
        sdp: SDP.write(o)
      }, ({ jsep }) => {
        if (jsep) {
          // jsep.sdp = fixSDP(jsep.sdp);
          const o = SDP.parse(jsep.sdp);
          o.media = o.media.filter(media => media.type === 'audio');
          jsep.sdp = SDP.write(o);
          notification.broadcastAction({ type: INVITE, id, session_id, handle_id, call_id, jsep });
        }
      });
    });
  });
};
