import BitArray from '../../common/BitArray';
import Token from './Token';
import SimpleToken from './SimpleToken';
export default class BinaryShiftToken extends SimpleToken {
    private binaryShiftStart;
    private binaryShiftByteCount;
    constructor(previous: Token, binaryShiftStart: int, binaryShiftByteCount: int);
    /**
     * @Override
     */
    appendTo(bitArray: BitArray, text: Uint8Array): void;
    addBinaryShift(start: int, byteCount: int): Token;
    /**
     * @Override
     */
    toString(): string;
}
