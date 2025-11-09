const { crc16modbus } = require("crc");
const { get } = require("../../../actions");
const { ACTION_RS485_TRANSMIT, DEVICE_TYPE_RS_HUB1_RS, DEVICE_TYPE_DI_4_RSM } = require("../../../constants");
const {
  READ_INPUT_REGISTERS,
  READ_HOLDING_REGISTERS,
  WRITE_REGISTER,
  WRITE_REGISTERS,
  MODBUS,
  READ_INPUTS,
  WRITE_COIL,
  WRITE_COILS,
  READ_COILS,
  READ_WRITE_REGISTERS,
} = require("../constants");
const driver = require("../../driver");
const device = require("../../../sockets/device");

const request = (getSize, fill) => (code) => (id, address, register, data) => {
  const { bind } = get(id) || {};
  if (!bind) return;
  const [dev, , index] = bind.split("/");
  const { ip, type } = get(dev) || {};
  if (ip && index) {
    const size = getSize(data);
    const buffer = Buffer.alloc(size + 2);
    buffer.writeUInt8(ACTION_RS485_TRANSMIT, 0);
    buffer.writeUInt8(index, 1);
    buffer.writeUInt8(address, 2);
    buffer.writeUInt8(code, 3);
    buffer.writeUInt16BE(register, 4);
    fill(buffer, data);
    buffer.writeUInt16LE(crc16modbus(buffer.slice(2, size)), size);
    switch (type) {
      case DEVICE_TYPE_DI_4_RSM:
      case DEVICE_TYPE_RS_HUB1_RS: {
        device.sendRBUS(buffer, dev);
        break;
      }
      default: {
        device.send(buffer, ip);
      }
    }
  };
}

const request8 = request(
  () => 8,
  (buffer, data) => {
    buffer.writeUInt16BE(data, 6);
  }
);

module.exports.readCoils = request8(READ_COILS);
module.exports.readInputs = request8(READ_INPUTS);
module.exports.readHoldingRegisters = request8(READ_HOLDING_REGISTERS);
module.exports.readInputRegisters = request8(READ_INPUT_REGISTERS);
module.exports.writeCoil = request8(WRITE_COIL);
module.exports.writeRegister = request8(WRITE_REGISTER);
// module.exports.writeRegisters = request(
//   (data) => {
//     const m = data.length % 8;
//     const n = Math.ceil(data.length / 8);
//     const l = (n == 0 || m !== 0) ? n + 1 : n;
//     return 9 + 2 * l;
//   },
//   (buffer, data) => {
//     buffer.writeUInt16BE(data.length, 6);
//     buffer.writeUInt8(2 * data.length, 8);
//     let j = 0; b = 0;
//     for (let i = 0; i < data.length;) {
//       const k = i % 8;
//       if (data[i]) {
//         b = b | (i << k);
//       }
//       i += 1;
//       if (i % 8 === 0) {
//         buffer.writeUInt8(data[i], j + 9);
//         j += 1;
//         b = 0;
//       }
//     }
//   }
// )(WRITE_COILS);
module.exports.writeRegisters = request(
  (data) => 9 + 2 * data.length,
  (buffer, data) => {
    buffer.writeUInt16BE(data.length, 6);
    buffer.writeUInt8(2 * data.length, 8);
    for (let i = 0; i < data.length; i++) {
      buffer.writeUInt16BE(data[i], 2 * i + 9);
    }
  }
)(WRITE_REGISTERS);

module.exports.readWriteRegisters = (id, address, readRegister, readRegistersNumber, writeRegister, data) => request(
  (data) => 13 + 2 * data.length,
  (buffer, data) => {
    buffer.writeUInt16BE(readRegistersNumber, 6);
    buffer.writeUInt16BE(writeRegister, 8);
    buffer.writeUInt16BE(data.length, 10);
    buffer.writeUInt8(2 * data.length, 12);
    for (let i = 0; i < data.length; i++) {
      buffer.writeUInt16BE(data[i], 2 * i + 13);
    }
  }
)(READ_WRITE_REGISTERS)(id, address, readRegister, data);

module.exports.handle = ({ id, data }) => {
  // console.log(id, data);
  const address = data[0];
  const { bind } = get(`${id}/${MODBUS}/${address}`) || {};
  if (bind) {
    driver.handle({ id: bind, data: data.slice(1) });
  }
};

module.exports.run = () => { };
