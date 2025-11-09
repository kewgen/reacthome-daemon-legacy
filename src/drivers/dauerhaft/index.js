// назначение айди и канала:
// 0x9a id  chl	chh 0xaa 0xaa	crc дважды
// 0x9a id  chl	chh 0xсa 0xсa	crc (запрос статуса)
// ответ:
// Head code	  0xd8										
// D1	  Motor ID										
// D2	  Motor Channel low 8 bits  b0 - b7 for 1 - 8 channel										
// D3	  Motor channel high 8 bits  b0 - b7 for 9 - 16 channel										
// D4	  Baud Rate:  00:1200   01:2400    02:4800    03:9600   04:19200										
// D5	  Hand control method Settings: 0Normal    1Press the button to go UP, then press it to STOP, then press it to go DOWN, then press it to STOP, infinite loop    2ress the UP button to go UP, then press the UP button to STOP, press the DOWN button to go DOWN, then press the DOWN button to STOP, pressing the button opposite the direction of motor operation will change the direction    3Runs when button is pressed, stops when hand is released    4When the motor is moving up or down, pressing any button will stop it										
// D6	Rotational speed in RPM/min (50-130)										
// D7	  0xca Feedback on function of curtain motor enquiries										
// D8	Zone Bit										
//   b0：  0 with hand pull start  1 without hand pull start 										
//   b1：  0 default direction 1 reverse										
//   b2：  0 continuous movement  1 dot movement										
//   b3：  0With slow start  1 without slow start										
//   b4：  0 to limit point with clearance 1 to limit point without clearance										
//   b5：  0 Stop at limit point 1 Stop when blocked										
//   b6：  0Remembering the itinerary 1 Not to remember the itinerary										
//     b7:   Reserved										

// управление вверх/вниз/остановить:
// up:     0x9a id  chl	chh 0x0a 0xdd	crc
// down:   0x9a id  chl	chh 0x0a 0xee crc
// stop:   0x9a id  chl	chh	0x0a 0xcc crc

// установка направления:
// 0x9a	0x09 id chl	chh	(b1: 0 defaut direction 1 opposite direction) crc	

// установка концевых значений:
// Up limit:    0x9a id chl chh 0xda 0xdd crc			
// Down limit:  0x9a id chl chh 0xda 0xee crc

// управление процентами:
// 0x9a	id chl chh	0xdd 0-100 crc		
// 100full close/Up limit   0full open/Down limit

// считывание положения:
// запрос:
// 0x9a id chl chh 0xcc 0x00 crc  (date feedback when ID corresponding)
// 0x9a id chl chh 0xcc 0xcc crc  (date feedback directly no matter ID corresponing or not)

// ответ:
// Single fram date：head code(0xd8) + ID(1Byte) +Channel(2Byte) + Date(5Byte) + Verify(ID ^ Channel  ^ Date)
// D1	Motor ID
// D2	Motor Channel low 8 bits  b0 - b7 for 1 - 8 channel
// D3	Motor channel high 8 bits  b0 - b7 for 9 - 16 channel
// D4	Current        unit 0.01mA
// D5	Voltage        Unit V
// D6	Speed         Unit RPM/m
// D7	Position       100 close/up limit         0 open/down limit
// D8 :
// 	  b0：            0 Motor stop                1 Motor run
// 	  b1：            0 no limit set               1 limit set down
// 	  b2：            0 No middle limit 1       1 set middle limit 1
// 	  b3：            0 No middle limit 2       1 set middle limit 2
// 	  b4：            0 No middle limit 3       1 set middle limit 3
// 	  b5：            0 No middle limit 4       1 set middle limit 4
// 	  b6：            no definition
// 	  b7：            no definition



// crc: D1 ^ D2 ^ D3 ^ D4 ^ D5 ^ D6 ^ D7 ^ D8


const { get, set } = require('../../actions');
const { ACTION_SET_ADDRESS, ACTION_SET_POSITION, DEVICE_TYPE_DI_4_RSM, DEVICE_TYPE_RS_HUB1_RS, ACTION_RS485_TRANSMIT, ACTION_UP, ACTION_DOWN, ACTION_STOP, ACTION_LIMIT_UP, ACTION_LIMIT_DOWN, ACTION_LEARN, ACTION_DELETE_ADDRESS } = require('../../constants');
const { device } = require('../../sockets');
const { delay } = require('../../util');

const timers = new Map();

const indexes = new Map();

const sync = async (id, index) => {
  const ch = `${id}/curtain/${index}`;
  const { shouldSetAddress, shouldSetPosition
    , shouldUp, shouldDown, shouldStop
    , shouldLimitUp, shouldLimitDown
    , shouldLearn, shouldDelete
    , address, channel, position } = get(ch) || {};
  if (address === 0) return;
  indexes.set(id, ch);
  if (shouldSetAddress) {
    send(id, query(address, channel, 0xaa, 0xaa));
    await delay(100);
    send(id, query(address, channel, 0xca, 0xca));
    await delay(100);
    send(id, query(address, channel, 0xca, 0xcb));
    set(ch, { shouldSetAddress: false });
  } else if (shouldUp) {
    send(id, query(address, channel, 0x0a, 0xdd));
    set(ch, { shouldUp: false });
  } else if (shouldDown) {
    send(id, query(address, channel, 0x0a, 0xee));
    set(ch, { shouldDown: false });
  } else if (shouldStop) {
    send(id, query(address, channel, 0x0a, 0xcc));
    set(ch, { shouldStop: false });
  } else if (shouldLimitUp) {
    send(id, query(address, channel, 0xda, 0xdd));
    set(ch, { shouldLimitUp: false });
  } else if (shouldLimitDown) {
    send(id, query(address, channel, 0xda, 0xee));
    set(ch, { shouldLimitDown: false });
  } else if (shouldSetPosition) {
    send(id, query(address, channel, 0xdd, position));
    set(ch, { shouldSetPosition: false });
  } else if (shouldLearn) {
    send(id, query(address, channel, 0x0a, 0xaa));
    set(ch, { shouldLearn: false });
  } else if (shouldDelete) {
    send(id, query(address, channel, 0x0a, 0xa6));
    set(ch, { shouldDelete: false });
  } else {
    send(id, query(address, channel, 0xcc, 0x00));
  }
}

const loop = (id) => async () => {
  const { numberCurtain = 0 } = get(id) || {};
  for (let i = 1; i <= numberCurtain; i += 1) {
    await sync(id, i);
    await delay(50);
  }
  timers.set(id, setTimeout(loop(id), numberCurtain * 200));
}

module.exports.run = (action) => {
  const { id, index, address, channel } = action;
  const ch = `${id}/curtain/${index}`;
  switch (action.type) {
    case ACTION_SET_ADDRESS: {
      set(ch, { shouldSetAddress: true, address, channel });
      break;
    }
    case ACTION_UP: {
      set(ch, { shouldUp: true });
      break;
    }
    case ACTION_DOWN: {
      set(ch, { shouldDown: true });
      break;
    }
    case ACTION_STOP: {
      set(ch, { shouldStop: true });
      break;
    }
    case ACTION_LIMIT_UP: {
      set(ch, { shouldLimitUp: true });
      break;
    }
    case ACTION_LIMIT_DOWN: {
      set(ch, { shouldLimitDown: true });
      break;
    }
    case ACTION_LEARN: {
      set(ch, { shouldLearn: true });
      break;
    }
    case ACTION_DELETE_ADDRESS: {
      set(ch, { shouldDelete: true });
      break;
    }
    case ACTION_SET_POSITION: {
      const { position } = action;
      set(ch, { shouldSetPosition: true, position });
      break;
    }
  }

}

module.exports.handle = ({ id, data }) => {
  const ch = indexes.get(id);
  switch (data[0]) {
    case 0xd8: {
      if (ch) {
        const { address, channel } = get(ch) || {};
        if (address == data[1] && channel == data[2]) {
          set(ch, { value: data[7] });
        }
      }
      break;
    }
  }
}


module.exports.clear = () => {
  for (const i of timers.values()) {
    clearTimeout(i);
  }
  timers.clear();
  queues.clear();
}

module.exports.add = (id) => {
  if (timers.has(id)) {
    clearTimeout(timers.get(id))
  }
  timers.set(id, setTimeout(loop(id), 100));
};

send = (id, payload) => {
  const { bind } = get(id);
  if (!bind) return;
  const { is_rbus } = get(bind);
  if (is_rbus) return;
  const [dev, , index] = bind.split('/');
  const { ip, type } = get(dev);
  const header = Buffer.from([ACTION_RS485_TRANSMIT, index]);
  const buffer = Buffer.concat([header, payload]);
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

query = (address, channel, a, b) => {
  const buffer = Buffer.alloc(7);
  buffer.writeUint8(0x9a, 0);
  buffer.writeUInt8(address, 1);
  buffer.writeInt16LE(1 << (channel - 1), 2);
  buffer.writeUInt8(a, 4);
  buffer.writeUInt8(b, 5);
  buffer.writeUInt8(buffer[1] ^ buffer[2] ^ buffer[4] ^ buffer[5], 6);
  return buffer;
}
