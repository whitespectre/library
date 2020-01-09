export default class StringBuilder {
    private value;
    constructor(value?: string);
    append(s: string | number): StringBuilder;
    length(): number;
    charAt(n: number): string;
    deleteCharAt(n: number): void;
    setCharAt(n: number, c: string): void;
    substring(start: int, end: int): string;
    toString(): string;
    insert(n: number, c: string): void;
}
