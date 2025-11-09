const { createSocket } = require('dgram');
const modbus = require('reacthome-modbus');
const { M230 } = require('reacthome-electric-meter').serial;
const climate = require('./climate.json');
const sensor = require('./sensor.json');
const plc = require('./plc.json');

const DEVICE_PORT = 2017;
const DEVICE_SERVER_PORT = 2016;
const DEVICE_GROUP = '224.0.0.1';

const ACTION_SET = 'action_set';

const message = (id, ...a) => Buffer.from([...id, ...a]);

const socket = createSocket('udp4');

let ip;

const send = (data) => {
    if (!ip) return;
    socket.send(data, DEVICE_SERVER_PORT, ip);
};

const electricMeter = new M230({ device: '/dev/ttyUSB0' });
electricMeter.on('error', console.error);
electricMeter.on('data', (value) => {
    send({
        type: ACTION_SET,
        online: true,
        id: 'electricity-meter',
        payload: { value }
    });
});

plc[0].id = [0, 0, 0, 0, 1, 1];
plc[1].id = [0, 0, 0, 0, 1, 2];

plc[0].slave = new modbus.tcp.slave({
    port: 2502
});
plc[0].master = new modbus.tcp.master({
    host: '192.168.0.11',
    port: 502,
    device: 0
});
plc[1].master = new modbus.tcp.master({
    host: '192.168.0.12',
    port: 503,
    device: 1
});

plc[0].slave.on('error', console.error);
plc[0].master.on('error', console.error);
plc[1].master.on('error', console.error);

const handlePlc = (device, cmd, data) => {
    plc[device].handle(cmd, data);
};

plc[0].slave.on('data', handlePlc);
plc[1].master.on('data', handlePlc);

plc[0].handle = function (cmd, data) {
    if (cmd !== 16) return;
    let skip = 0;
    for (let i = 0; i < this.in.length; i++) {
        const id = this.in[i];
        if (id === 'armed') {
            skip++;
            if (data[3] !== (sensor[id] || 0)) {
                handleArmed(src, data[3]);
                sensor[id] = data[3];
                tcpserver.broadcast({ active_sensor: { [id]: sensor[id] } });
            };
        } else if (id) {
            let s = bit(data.slice(4), i - skip);
            if (id === 'reed') {
                s = 1 - s;
            } else if (id === 'smoke') {
                s = 1 - s;
                state.merge('climate', () => ({ [id]: s === 1 }), true);
            }
            const button = state.get('sensor')[id];
            const type = button.type;
            if (s !== sensor[id] || type === 'motion') {
                if (s) {
                    handle(src)({
                        type: 'SENSOR',
                        action: 'ON',
                        id
                    });
                    sensor[id] = 1;
                    if (type === 'button' && button.scene) {
                        clearTimeout(timers[id]);
                        timers[id] = setTimeout(() => {
                            for (const [id, location] of Object.entries(state.get('location'))) {
                                if (location.selector != undefined) {
                                    const light = location.light.filter(i => !state.get('light')[i].manual);
                                    const off = light.reduce((a, l) => a && (state.get('scene')[button.scene].light[l] === 0), true);
                                    if (off) {
                                        selectorControl({
                                            location: id,
                                            action: 'power_off'
                                        });
                                    }
                                }
                            }
                        }, 1000);
                    }
                } else {
                    clearTimeout(timers[id]);
                    if (id === 'door_button') {
                        handle(src)({
                            type: 'SENSOR',
                            action: 'OFF',
                            id
                        });
                    }
                    sensor[id] = 0;
                }
                tcpserver.broadcast({ active_sensor: { [id]: sensor[id] } });
            }
        }
    };

    plc[1].handle = function (cmd, data) {
        if (cmd !== 3) return;
        let offset = 0;
        for (const id of this) {
            if (id)
                switch (sensor[id].type) {
                    case 'voltage_meter':
                    case 'current_meter':
                    case 'power_meter':
                        offset += offset % 4;
                        const buff = Buffer.alloc(4);
                        data.copy(buff, 0, offset + 2, offset + 4);
                        data.copy(buff, 2, offset + 0, offset + 2);
                        const value = buff.readFloatBE();
                        if (state.get('meter')[id] !== value)
                            state.merge('meter', () => ({ [id]: value }), true);
                        offset += 4;
                        break;
                    case 'water_counter':
                        meter[id].tick(data.readUInt16BE(offset));
                        offset += 2;
                        break;
                    case 'temperature':
                        let t = Math.round(data.readUInt16BE(offset) / 10) / 10;
                        if (temperature[id]) {
                            temperature[id].push(t);
                            if (temperature[id].length > 59) {
                                temperature[id].shift();
                                t = temperature[id]
                                    .map(i => i)
                                    .sort((a, b) => a > b)[30];
                                //.reduce((a, b) => a + b) / (temperature[id].length - 2);
                            }
                        }
                        if (t !== climate[id])
                            state.merge('climate', () => ({ [id]: t }), true);
                        if (temperature[id] && (t > 50)) {
                            handleFire(id);
                        }
                        offset += 2;
                        break;
                    case 'humidity':
                        const { humidity = 75 } = state.get('pref');
                        const h = Math.round(data.readUInt16BE(offset) / 10);
                        if (h !== climate[id])
                            state.merge('climate', () => ({ [id]: h }), true);
                        if (h > humidity) {
                            ventOn(state.get('sensor')[id].relay);
                        }
                        offset += 2;
                        break;
                    case 'relay':
                    case 'vent_power':
                    case 'floor_power':
                        const p = data.readUInt16BE(offset);
                        if (p !== climate[id])
                            state.merge('climate', () => ({ [id]: p }), true);
                        offset += 2;
                        break;
                    default:
                        offset += 2;
                }
            else offset += 2;
        }
        const { power_phase_a, power_phase_b, power_phase_c } = state.get('meter');
        chart.send([power_phase_a, power_phase_b, power_phase_c]);
    };

    setInterval(() => {
        plc[0].master.readHoldingRegisters(0, 7);
    }, 500);

    setInterval(() => {
        plc[1].master.readHoldingRegisters(0, 82);
    }, 1000);

    const process = (data, { address }) => {
        try {
            const action = data[0];
            switch (action) {
                case ACTION_DISCOVERY: {
                    ip = address;
                    send()
                    break;
                }
            }
        } catch (e) {
            console.error(e);
        }
    };

    socket.on('error', console.error);
    socket.on('message', process);
    socket.bind(DEVICE_PORT, () => {
        socket.addMembership(DEVICE_GROUP);
    });
}
