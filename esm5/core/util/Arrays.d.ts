export default class Arrays {
    static asList<T = any>(...args: T[]): T[];
    static create<T = any>(rows: int, cols: int, value?: T): T[][];
    static createInt32Array(rows: int, cols: int, value?: int): Int32Array[];
    static equals(first: any, second: any): boolean;
    static fill(a: Int32Array | Uint8Array | Array<any>, value: number): void;
    static hashCode(a: any): number;
    static copyOf(original: Int32Array, newLength: number): Int32Array;
    static binarySearch(ar: Int32Array, el: number, comparator?: (a: number, b: number) => number): number;
    static numberComparator(a: number, b: number): number;
}
