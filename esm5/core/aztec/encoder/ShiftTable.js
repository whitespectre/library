"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Arrays_1 = require("../../util/Arrays");
var C = require("./EncoderConstants");
function static_SHIFT_TABLE(SHIFT_TABLE) {
    for (var _i = 0, SHIFT_TABLE_1 = SHIFT_TABLE; _i < SHIFT_TABLE_1.length; _i++) {
        var table = SHIFT_TABLE_1[_i] /*Int32Array*/;
        Arrays_1.default.fill(table, -1);
    }
    SHIFT_TABLE[C.MODE_UPPER][C.MODE_PUNCT] = 0;
    SHIFT_TABLE[C.MODE_LOWER][C.MODE_PUNCT] = 0;
    SHIFT_TABLE[C.MODE_LOWER][C.MODE_UPPER] = 28;
    SHIFT_TABLE[C.MODE_MIXED][C.MODE_PUNCT] = 0;
    SHIFT_TABLE[C.MODE_DIGIT][C.MODE_PUNCT] = 0;
    SHIFT_TABLE[C.MODE_DIGIT][C.MODE_UPPER] = 15;
    return SHIFT_TABLE;
}
exports.static_SHIFT_TABLE = static_SHIFT_TABLE;
exports.SHIFT_TABLE = static_SHIFT_TABLE(Arrays_1.default.createInt32Array(6, 6)); // mode shift codes, per table
//# sourceMappingURL=ShiftTable.js.map