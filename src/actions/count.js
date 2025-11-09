const { get, set } = require('./create');

const count_on = (site, type, id) => {
  const { count = {}, parent } = get(site) || {};
  const a = count[type];
  if (Array.isArray(a)) {
    if (!a.includes(id)) {
      set(site, { count: { ...count, [type]: [...a, id] } });
    }
  } else {
    set(site, { count: { ...count, [type]: [id] } });
  }
  if (parent) count_on(parent, type, id);
};

module.exports.count_on = (id) => {
  const { site, type } = get(id) || {};
  count_on(site, type, id);
};

const count_off = (site, type, id) => {
  const { count = {}, parent } = get(site) || {};
  const a = count[type];
  if (Array.isArray(a)) {
    if (a.includes(id)) {
      set(site, { count: { ...count, [type]: a.filter(i => i !== id) } });
    }
  }
  if (parent) count_off(parent, type, id);
}

module.exports.count_off = (id) => {
  const { site, type } = get(id) || {};
  count_off(site, type, id);
};

const bind = ['bind', 'r', 'g', 'b'];

const count = (site, pool = []) => {
  const o = get(site) || {};
  o.count = {};
  for (const [type, a] of Object.entries(o)) {
    if (Array.isArray(a)) {
      for (const id of a) {
        const o = get(id) || {};
        for (const i of bind) {
          if (o[i]) {
            const { value } = get(o[i]) || {};
            if (value) {
              count_on(site, type, id);
            }
          }
        }
      }
    }
    if (Array.isArray(o.site)) {
      for (const i of o.site) {
        count(i, pool);
      }
    }
  }
}

module.exports.count = count;
