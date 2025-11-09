
const janus = require('../janus');
const { send } = require('../websocket/peer');
const { CREATE } = require('../janus/constants');
const { bind } = require('../janus');
const { RTSP, WATCH, START, STOP, PAUSE } = require('./constants');
const { hashCode } = require('../util');
const { streams } = require('./streams');

module.exports.onWatch = ({ url, audio = false, video = true }, session) => {
  if (!url) return;
  const stream_id = hashCode(url);
  janus.createSession((session_id) => {
    janus.attachPlugin(session_id, 'janus.plugin.streaming', (handle_id) => {
      bind(handle_id, session);
      const watch = (stream_id) => {
        janus.send(session_id, handle_id, { request: WATCH, id: stream_id }, ({ jsep }) => {
          if (jsep) {
            send(session, { type: WATCH, url, session_id, handle_id, stream_id, jsep });
          }
        });
      };
      if (streams.has(url)) {
        watch(streams.get(url));
      } else {
        const u = new URL(url);
        const rtsp_user = u.username;
        const rtsp_pwd = u.password;
        u.username = '';
        u.password = '';
        janus.send(session_id, handle_id, {
          request: CREATE,
          id: stream_id,
          type: RTSP,
          audio, video,
          url: u.toString(),
          rtsp_user, rtsp_pwd,
          videofmtp: 'level-asymmetry-allowed=1;profile-level-id=42e01f;packetization-mode=1'
        }, () => {
          streams.set(url, stream_id);
          watch(stream_id);
        });
      }
    })
  });
};

module.exports.onStart = ({ session_id, handle_id, jsep }) => {
  janus.send(session_id, handle_id, { request: START }, jsep);
};

module.exports.onStop = ({ session_id, handle_id }) => {
  janus.send(session_id, handle_id, { request: STOP });
};

module.exports.onPause = ({ session_id, handle_id }) => {
  janus.send(session_id, handle_id, { request: PAUSE });
};
