module.exports.sleep = (t) =>
  new Promise((resolve) => {
    setTimeout(resolve, t);
  });

module.exports.hashCode = (s) => {
  let h = 0,
    i = s.length - 1;
  while (i >= 0) h = Math.imul(31, h) + s.charCodeAt(i--);
  return h > 0 ? h : Number.MAX_SAFE_INTEGER + h;
};

module.exports.ip2int = (ip) =>
  ip.split(".").reduce((a, b) => (a << 8) | parseInt(b), 0) >>> 0;

module.exports.int2ip = (ip) =>
  `${(ip >> 24) & 0xff}.${(ip >> 16) & 0xff}.${(ip >> 8) & 0xff}.${ip & 0xff}`;

module.exports.delay = time => new Promise((resolve) => {
  setTimeout(resolve, time);
});

const KELVIN = 273.15;
const GAS_CONSTANT = 287.05;
const m_w = 18.015; // g/mol - Molar mass of water vapor

module.exports.toKelvin = (temperature) => temperature + KELVIN;

const saturationVaporPressure = (T) =>
  611.2 * Math.exp((17.62 * (T - KELVIN)) / (243.12 + (T - KELVIN)));


module.exports.toAbsoluteHumidity = (rh, t) => {
  const p_sat = saturationVaporPressure(t);
  const ah = rh * p_sat * m_w / GAS_CONSTANT / t / 100;
  return ah;
};

module.exports.toRelativeHumidity = (ah, t) => {
  const p_sat = saturationVaporPressure(t);
  const rh = ah / p_sat / m_w * GAS_CONSTANT * t * 100;
  return rh > 100 ? 100 : rh;
};
