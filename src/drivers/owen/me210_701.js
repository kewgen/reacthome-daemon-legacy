const { readHoldingRegisters } = require("../modbus");



module.exports.add = (id) => {

}

// setInterval(() => {
//   let k = 0;
//   readHoldingRegisters('172.16.1.1', 502, 1, 5336, 2);
//   for (let i = 0; i < 3; i++) {
//     for (let j = 0; j < 6; j++) {
//       setTimeout(() => {
//         const a = 5240 + i * 2 + j * 12;
//         console.log(a);
//         readHoldingRegisters('172.16.1.1', 502, 1, a, 2);
//       }, k);
//       k += 1000;
//     }
//   }
// }, 30000);
