const { crc16modbus } = require('crc')

const WAITING_PREAMBLE = 0
const WAITING_SIZE = 1
const WAITING_DATA = 2
const WAITING_MSB_CRC = 3
const WAITING_LSB_CRC = 4

const PREAMBLE = 0xa5

module.exports.handle = (rbus) => {

  const mac = Buffer.from(rbus.mac)

  let phase = WAITING_PREAMBLE
    , offset, size, crc
  let buff = Buffer.alloc(512)

  handle = (buff) => {
    if (buff[0] !== 0xf0) {
      rbus.socket.send(Buffer.concat([mac, buff]))
    }
  }

  const receivePreamble = (v) => {
    if (v === PREAMBLE) {
      offset = 0
      size = 0
      crc = 0
      buff[offset] = v
      offset++
      phase = WAITING_SIZE
    }
  }

  const receiveSize = (v) => {
    buff[offset] = v
    offset++
    size = v
    phase = v === 0 ? WAITING_MSB_CRC : WAITING_DATA
  }

  const receiveData = (v) => {
    buff[offset] = v
    offset++
    if (offset === size + 2) {
      phase = WAITING_MSB_CRC
    }
  }

  const receiveMsbCRC = (v) => {
    crc = v
    phase = WAITING_LSB_CRC
  }

  const receiveLsbCRC = (v) => {
    crc = (v << 8) | crc
    const buff_ = buff.slice(0, size + 2)
    const crc_ = crc16modbus(buff_)
    if (crc_ === crc) {
      handle(buff_.slice(2))
    }
    phase = WAITING_PREAMBLE
  }

  const process = (v) => {
    switch (phase) {
      case WAITING_PREAMBLE:
        receivePreamble(v)
        break
      case WAITING_SIZE:
        receiveSize(v)
        break
      case WAITING_DATA:
        receiveData(v)
        break
      case WAITING_MSB_CRC:
        receiveMsbCRC(v)
        break
      case WAITING_LSB_CRC:
        receiveLsbCRC(v)
        break
    }
  }

  return (data) => {
    for (let i = 0; i < data.length; i++) {
      process(data[i])
    }
  }
}
