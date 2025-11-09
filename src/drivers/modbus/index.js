const instances = require("../drivers");

module.exports.readCoils = (id, address, register, data) => {
    const instance = instances.get(id);
    if (instance) instance.readCoils(id, address, register, data);
}

module.exports.readInputs = (id, address, register, data) => {
    const instance = instances.get(id);
    if (instance) instance.readInputs(id, address, register, data);
}

module.exports.readHoldingRegisters = (id, address, register, data) => {
    const instance = instances.get(id);
    if (instance) instance.readHoldingRegisters(id, address, register, data);
}

module.exports.readInputRegisters = (id, address, register, data) => {
    const instance = instances.get(id);
    if (instance) instance.readInputRegisters(id, address, register, data);
}

module.exports.writeCoil = (id, address, register, data) => {
    const instance = instances.get(id);
    if (instance) instance.writeCoil(id, address, register, data);
}

module.exports.writeRegister = (id, address, register, data) => {
    const instance = instances.get(id);
    if (instance) instance.writeRegister(id, address, register, data);
}

module.exports.writeRegisters = (id, address, register, data) => {
    const instance = instances.get(id);
    if (instance) instance.writeRegisters(id, address, register, data);
}

module.exports.readWriteRegisters = (id, address, readRegister, readRegistersNumber, writeRegister, data) => {
    const instance = instances.get(id);
    if (instance) instance.readWriteRegisters(id, address, readRegister, readRegistersNumber, writeRegister, data);
}
