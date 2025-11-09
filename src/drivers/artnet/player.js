'use strict';

const dgram = require('dgram');

module.exports = class {

    constructor({
        net, subnet, universe, host,
        port = 0x1936,
        size = 512,
        rate = 40,
        state = []
    }) {

        // let t = Date.now();

        const delay = Math.round(1000 / rate);

        size = size > 512 ? 512 : size;
        size += size % 2;

        const header = Buffer.from([
            65, 114, 116, 45, 78, 101, 116, 0,
            0, 80,
            0, 14,
            0,
            0,
            (subnet & 0xf) << 4 | universe & 0xf, net & 0xff,
            (size >> 8) & 0xff, size & 0xff
        ]);

        const data = Buffer.alloc(size);

        const buff = Buffer.concat([header, data]);

        const socket = dgram.createSocket("udp4");

        const scripts = [];

        const get = i => buff.readUInt8(header.length + i);
        const set = (i, value) => buff.writeUInt8(value & 0xff, header.length + i);
        const send = () => {
            // const t1 = Date.now();
            // if ((t1 - t) < delay) return;
            socket.send(buff, 0, buff.length, port, host)
            // t = t1;
        };

        state
            .filter((s, i) => i < size)
            .map((s, i) => {
                set(i, s)
            });

        this.play = (i, script) => {
            if (i >= size) return;
            // const changed = [];
            // changed[i] = get(i);
            scripts[i] = {
                script: script,
                // time: process.hrtime(),
                tick: 0
            };
        };

        setInterval(() => {
            try {
                const a = [];
                let changed = false;
                for (const [i, s] of scripts.entries()) {
                    const v0 = get(i);
                    // const v1 = s.script(v0, s.tick++, process.hrtime(s.time));
                    const v1 = s.script(v0, s.tick++);
                    if (v1 < 0) {
                        delete scripts[i];
                        a[i] = v0
                    }
                    else if (v1 !== v0) {
                        changed = true;
                        set(i, v1);
                    }
                };
                if (changed) send();
            } catch (err) {
                console.error(err)
            }
        }, delay);

        // setInterval(send, 5000 / rate);

    }

};
