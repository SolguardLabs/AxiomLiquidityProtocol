export type AssetAmount = bigint;
export type ShareAmount = bigint;
export type BasisPoints = bigint;

export const ZERO = 0n;
export const ONE = 1n;
export const ASSET_SCALE = 1_000_000n;
export const SHARE_SCALE = 1_000_000n;
export const BPS = 10_000n;
export const MAX_BPS = 10_000n;

export function asset(value: number | string | bigint): AssetAmount {
    if (typeof value === "bigint") {
        return value;
    }
    const text = String(value);
    if (!text.includes(".")) {
        return BigInt(text) * ASSET_SCALE;
    }
    const [whole, fraction = ""] = text.split(".");
    const normalized = fraction.padEnd(6, "0").slice(0, 6);
    return BigInt(whole || "0") * ASSET_SCALE + BigInt(normalized || "0");
}

export function shares(value: number | string | bigint): ShareAmount {
    if (typeof value === "bigint") {
        return value;
    }
    const text = String(value);
    if (!text.includes(".")) {
        return BigInt(text) * SHARE_SCALE;
    }
    const [whole, fraction = ""] = text.split(".");
    const normalized = fraction.padEnd(6, "0").slice(0, 6);
    return BigInt(whole || "0") * SHARE_SCALE + BigInt(normalized || "0");
}

export function bps(value: number | string | bigint): BasisPoints {
    return BigInt(value);
}

export function assertNonNegative(name: string, value: bigint): void {
    if (value < ZERO) {
        throw new RangeError(`${name} cannot be negative`);
    }
}

export function assertPositive(name: string, value: bigint): void {
    if (value <= ZERO) {
        throw new RangeError(`${name} must be positive`);
    }
}

export function add(a: bigint, b: bigint): bigint {
    return a + b;
}

export function sub(a: bigint, b: bigint): bigint {
    if (b > a) {
        throw new RangeError("subtraction underflow");
    }
    return a - b;
}

export function saturatingSub(a: bigint, b: bigint): bigint {
    return b > a ? ZERO : a - b;
}

export function min(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
}

export function max(a: bigint, b: bigint): bigint {
    return a > b ? a : b;
}

export function abs(a: bigint): bigint {
    return a < ZERO ? -a : a;
}

export function sign(value: bigint): -1 | 0 | 1 {
    if (value < ZERO) {
        return -1;
    }
    if (value > ZERO) {
        return 1;
    }
    return 0;
}

export function clamp(value: bigint, lower: bigint, upper: bigint): bigint {
    if (lower > upper) {
        throw new RangeError("invalid clamp bounds");
    }
    if (value < lower) {
        return lower;
    }
    if (value > upper) {
        return upper;
    }
    return value;
}

export function mulDivDown(a: bigint, b: bigint, denominator: bigint): bigint {
    assertPositive("denominator", denominator);
    return (a * b) / denominator;
}

export function mulDivUp(a: bigint, b: bigint, denominator: bigint): bigint {
    assertPositive("denominator", denominator);
    if (a === ZERO || b === ZERO) {
        return ZERO;
    }
    return (a * b - ONE) / denominator + ONE;
}

export function percentOf(amount: bigint, basisPoints: bigint): bigint {
    if (basisPoints < ZERO || basisPoints > MAX_BPS) {
        throw new RangeError("basis points out of range");
    }
    return mulDivDown(amount, basisPoints, BPS);
}

export function percentOfUp(amount: bigint, basisPoints: bigint): bigint {
    if (basisPoints < ZERO || basisPoints > MAX_BPS) {
        throw new RangeError("basis points out of range");
    }
    return mulDivUp(amount, basisPoints, BPS);
}

export function ratioBps(numerator: bigint, denominator: bigint): bigint {
    if (denominator === ZERO) {
        return ZERO;
    }
    return mulDivDown(numerator, BPS, denominator);
}

export function ratioScaled(numerator: bigint, denominator: bigint, scale = ASSET_SCALE): bigint {
    if (denominator === ZERO) {
        return ZERO;
    }
    return mulDivDown(numerator, scale, denominator);
}

export function proRata(amount: bigint, numerator: bigint, denominator: bigint): bigint {
    if (amount === ZERO || numerator === ZERO) {
        return ZERO;
    }
    return mulDivDown(amount, numerator, denominator);
}

export function sum(values: Iterable<bigint>): bigint {
    let total = ZERO;
    for (const value of values) {
        total += value;
    }
    return total;
}

export function average(values: readonly bigint[]): bigint {
    if (values.length === 0) {
        return ZERO;
    }
    return sum(values) / BigInt(values.length);
}

export function weightedAverage(pairs: readonly { value: bigint; weight: bigint }[]): bigint {
    let weighted = ZERO;
    let weight = ZERO;
    for (const pair of pairs) {
        if (pair.weight === ZERO) {
            continue;
        }
        weighted += pair.value * pair.weight;
        weight += pair.weight;
    }
    return weight === ZERO ? ZERO : weighted / weight;
}

export function formatAsset(amount: bigint, decimals = 6): string {
    const negative = amount < ZERO;
    const normalized = negative ? -amount : amount;
    const whole = normalized / ASSET_SCALE;
    const fraction = normalized % ASSET_SCALE;
    const padded = fraction.toString().padStart(6, "0").slice(0, decimals);
    const suffix = decimals === 0 ? "" : `.${padded}`;
    return `${negative ? "-" : ""}${whole.toString()}${suffix}`;
}

export function formatShares(amount: bigint, decimals = 6): string {
    const negative = amount < ZERO;
    const normalized = negative ? -amount : amount;
    const whole = normalized / SHARE_SCALE;
    const fraction = normalized % SHARE_SCALE;
    const padded = fraction.toString().padStart(6, "0").slice(0, decimals);
    const suffix = decimals === 0 ? "" : `.${padded}`;
    return `${negative ? "-" : ""}${whole.toString()}${suffix}`;
}

export function toNumber(amount: bigint, scale = ASSET_SCALE): number {
    return Number(amount) / Number(scale);
}

export function fromRatio(value: bigint, numeratorBps: bigint): bigint {
    return percentOf(value, numeratorBps);
}

export function increaseByBps(value: bigint, deltaBps: bigint): bigint {
    return value + percentOf(value, deltaBps);
}

export function decreaseByBps(value: bigint, deltaBps: bigint): bigint {
    return saturatingSub(value, percentOf(value, deltaBps));
}

export function distribute(amount: bigint, weights: readonly bigint[]): bigint[] {
    const totalWeight = sum(weights);
    if (amount === ZERO || totalWeight === ZERO) {
        return weights.map(() => ZERO);
    }
    const out: bigint[] = [];
    let assigned = ZERO;
    for (let i = 0; i < weights.length; i += 1) {
        if (i === weights.length - 1) {
            out.push(amount - assigned);
            break;
        }
        const piece = mulDivDown(amount, weights[i] ?? ZERO, totalWeight);
        out.push(piece);
        assigned += piece;
    }
    return out;
}

export function closeEnough(a: bigint, b: bigint, tolerance: bigint): boolean {
    return abs(a - b) <= tolerance;
}
