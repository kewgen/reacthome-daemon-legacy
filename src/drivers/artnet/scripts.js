'use strict';

module.exports.dim = delta => value => v =>
    value === v
        ? -1
        : v < value
            ? Math.min(v + delta, value)
            : Math.max(v - delta, value);

module.exports.set = value => v =>
    value === v
        ? -1
        : value;