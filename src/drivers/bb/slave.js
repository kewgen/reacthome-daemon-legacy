
const net = require('net');
const EventEmitter = require('events');

module.exports = class extends EventEmitter {

    constructor({host, port = 2502} = {}) {

        super();
        const server = net.createServer(socket => {

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
                    const device = buff.readUInt8(6);
                    const cmd = buff.readUInt8(7);
                    switch (cmd) {
                        case 0x3:
                        case 0x4:
                            this.emit('request', req => {
                                try {
                                    const address = data.readUInt16BE(8);
                                    const amount = data.readUInt16BE(10);
                                    const size = 2 * amount;
                                    const resp = Buffer.alloc(size + 9);
                                    buff.copy(resp, 0, 0, 4);
                                    resp.writeUInt16BE(size + 3, 4);
                                    buff.copy(resp, 6, 6, 8);
                                    resp.writeUInt8(size, 8);
                                    const r = req({device, cmd, address, amount});
                                    r.copy(resp, 9, 0, Math.min(size, r.length));
                                    socket.write(resp, err => {
                                        if (err) this.emit('error', err);
                                    });
                                } catch (err) {
                                    this.emit('error', err)
                                }
                            });
                            break;

                        case 0x6:
                            socket.write(buff, err => {
                                if (err) this.emit('error', err);
                            });
                            this.emit('data', {
                                device, cmd,
                                address: buff.readUInt16BE(8),
                                value: buff.readUInt16BE(10)
                            });
                            break;

                        case 0x10:
                            const resp = Buffer.alloc(12);
                            data.copy(resp, 0, 0, 12);
                            resp.writeUInt16BE(6, 4);
                            socket.write(resp, err => {
                                if (err) this.emit('error', err);
                            });
                            this.emit('data', {
                                device, cmd,
                                address: buff.readUInt16BE(8),
                                data: buff.slice(10, size)
                            });

                    }
                    buff = buff.slice(size);
                } while (true);
            };

            socket
                .on('close', () => {
                    socket.destroy()
                }).on('end', () => {
                    socket.destroy()
                })
                .on('error', err => {
                    this.emit('error', err);
                    socket.destroy()
                })
                .on('data', process)

        }).listen(port, host)

        this.close = () => {
            server.close();
        }

    }

};
