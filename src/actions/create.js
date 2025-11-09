const { contains } = require("fast-deep-equal");
const { ACTION_SET, CLIENT_PORT, CLIENT_GROUP } = require("../constants");
const { broadcast } = require("../websocket/peer");
const state = require("../controllers/state");
const db = require("../db");

module.exports.get = state.get;

const apply = (id, payload) => {
  if (!id) return;
  payload.timestamp = Date.now();
  state.set(id, payload);
  broadcast({ type: ACTION_SET, id, payload });
  try {
    db.put(id, state.get(id), (err) => {
      if (err) console.error(err);
    });
  } catch (e) {
    console.error(e);
  }
};

module.exports.set = (id, payload) => {
  const prev = state.get(id);
  if (prev && contains(prev, payload)) return;
  apply(id, payload);
};

const add = (id, ref, value) => {
  const prev = state.get(id);
  if (prev && prev[ref] && prev[ref].includes(value)) return;
  apply(id, {
    [ref]: prev && prev[ref] ? [...prev[ref], value] : [value],
  });
  const v = state.get(value);
  if (v && v[prev.type || BIND] !== id) {
    apply(value, { [prev.type || BIND]: null });
  }
};
module.exports.add = add;

const del = (id, ref, value) => {
  const prev = state.get(id);
  if (prev && prev[ref] && prev[ref].includes(value)) {
    apply(id, {
      [ref]: prev[ref].filter((i) => i !== value),
    });
  }
};
module.exports.del = del;

module.exports.makeBind = (id, ref = BIND, value, bind) => {
  const back = bind || ref;
  const o = state.get(id);
  const v = state.get(value);
  if (o) apply(o[ref], { [ref]: null });
  if (v) apply(v[back], { [back]: null });
  apply(id, { [ref]: value });
  apply(value, { [back]: id });
};

module.exports.addBind = (id, ref, value, bind = BIND) => {
  const v = state.get(value);
  if (v) del(v[bind], ref, value);
  add(id, ref, value);
  apply(value, { [bind]: id });
};

module.exports.apply = (id, action) => {
  const o = state.get(id);
  if (!o) return;
  action(o);
};

const applySite = (id, action) => {
  const o = state.get(id);
  if (!o) return;
  action(o, id);
  if (o.project) {
    applySite(o.project, action);
  }
  if (o.site && o.site.length > 0) {
    for (const i of o.site) {
      applySite(i, action);
    }
  }
};

module.exports.applySite = applySite;
