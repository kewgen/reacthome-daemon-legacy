
const net = require('net');
const EventEmitter = require('events');

module.exports = class extends EventEmitter {

    constructor({host, port = 502, device = 1, timeout = 7000}) {

        super();

        let pool;

        const connect = cb => {

            pool = [];

            let rest = Buffer.alloc(0);

            const process = data => {
                let buff = Buffer.concat([rest, data]);
                do {
                    if (buff.length < 6) {
                        rest = buff;
                        return;
                    }
                    const size = 6 + buff.readUInt16BE(4);
                    if (buff.length < size) {
                        rest = buff;
                        return;
                    }
                    const tid = buff.readUInt16BE(0);
                    const cmd = buff.readUInt8(7);
                    if (cmd === 0x3 || cmd === 0x4)
                        this.emit('data', {
                            device, cmd, address: pool[tid], data: buff.slice(9, size)
                        });
                    buff = buff.slice(size);
                    delete pool[tid];
                } while(true);
            };

            return net.connect({host, port}, cb)
                .on('error', err => {
                    this.emit('error', err);
                    socket.destroy();
                })
                .on('data', process)

        };

        let socket = connect(() => {});


        let inTimeout = false;
        const send = buff => {
            if (inTimeout || socket.connecting) return;
            if (socket.destroyed) {
                inTimeout = true;
                setTimeout(() => {
                    inTimeout = false;
                    socket = connect(() => {
                        socket.write(buff, err => {
                            if (err) this.emit('error', err)
                        })
                    })
                }, timeout);
            }
            else
                socket.write(buff, err => {
                    if (err) this.emit('error', err)
                })
        };

        let tid = 0;

        const request = (size, cmd, address, data) => {
            if (tid > 0xffff) tid = 0;
            const buff = Buffer.alloc(size);
            buff.writeUInt16BE(tid, 0);
            buff.writeUInt16BE(0, 2);
            buff.writeUInt16BE(size - 6, 4);
            buff.writeUInt8(device, 6);
            buff.writeUInt8(cmd, 7);
            buff.writeUInt16BE(address, 8);
            buff.writeUInt16BE(data, 10);
            pool[tid++] = address;
            return buff;
        };

        const request12 = cmd => (address, data) => {
            try {
                const buff = request(12, cmd, address, data);
                send(buff);
            } catch(err) {
                this.emit('error', err)
            }
        };

        const request13n = cmd => (address, data) => {
            try {
                const buff = request(data.length + 13, cmd, address, data.length >> 1);
                buff.writeUInt8(data.length, 12);
                data.copy(buff, 13, 0);
                send(buff);
            } catch(err) {
                this.emit('error', err)
            }
        };

        this.readHoldingRegisters = request12(0x3);
        this.readInputRegisters = request12(0x4);
        this.writeSingleOutputRegister = request12(0x6);
        this.writeMultipleOutputRegisters = request13n(0x10);

        this.destroy = () => {
            socket.destroy();
        }

    }


};
