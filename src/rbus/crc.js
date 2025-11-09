const { crc16modbus } = require("crc");

module.exports.checkCRC = (data) => {
  const offset = data.length - 2;
  return crc16modbus(data.slice(0, offset)) === data.readUint16LE(offset);
}

module.exports.addCRC = (data) => {
  const crc = crc16modbus(data);
  data.push(crc & 0xff);
  data.push(crc >> 8);
  return data;
}
