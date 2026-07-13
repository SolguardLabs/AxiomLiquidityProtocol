import { BPS, abs, bps, max, min, mulDivDown, ratioBps } from "../domain/amount.ts";
import { ensure, ensureBps } from "../domain/errors.ts";
import type { RangeHealth, RangeSpec } from "../domain/types.ts";

export interface RangeInput {
    readonly id: string;
    readonly lowerTick: bigint;
    readonly upperTick: bigint;
    readonly targetWeightBps?: bigint;
}

export function createRange(input: RangeInput): RangeSpec {
    ensure(
        input.lowerTick < input.upperTick,
        "INVALID_RANGE",
        "lower tick must be below upper tick",
    );
    const targetWeightBps = input.targetWeightBps ?? BPS;
    ensureBps("targetWeightBps", targetWeightBps);
    return {
        id: input.id,
        lowerTick: input.lowerTick,
        upperTick: input.upperTick,
        targetWeightBps,
        minPrice: input.lowerTick,
        maxPrice: input.upperTick,
    };
}

export function widthBps(range: RangeSpec): bigint {
    const mid = midpoint(range);
    if (mid === 0n) {
        return 0n;
    }
    return ratioBps(range.upperTick - range.lowerTick, mid);
}

export function midpoint(range: RangeSpec): bigint {
    return (range.lowerTick + range.upperTick) / 2n;
}

export function inRange(range: RangeSpec, price: bigint): boolean {
    return price >= range.lowerTick && price <= range.upperTick;
}

export function distanceFromRangeBps(range: RangeSpec, price: bigint): bigint {
    if (inRange(range, price)) {
        return 0n;
    }
    const anchor = price < range.lowerTick ? range.lowerTick : range.upperTick;
    return ratioBps(abs(anchor - price), max(anchor, 1n));
}

export function rangeHealth(range: RangeSpec, price: bigint): RangeHealth {
    return {
        rangeId: range.id,
        currentPrice: price,
        inRange: inRange(range, price),
        widthBps: widthBps(range),
        distanceBps: distanceFromRangeBps(range, price),
    };
}

export function overlapBps(a: RangeSpec, b: RangeSpec): bigint {
    const lower = max(a.lowerTick, b.lowerTick);
    const upper = min(a.upperTick, b.upperTick);
    if (upper <= lower) {
        return 0n;
    }
    const denominator = max(a.upperTick - a.lowerTick, 1n);
    return mulDivDown(upper - lower, bps(10_000), denominator);
}

export function expandRange(range: RangeSpec, expansionBps: bigint): RangeSpec {
    ensureBps("expansionBps", expansionBps);
    const mid = midpoint(range);
    const halfWidth = (range.upperTick - range.lowerTick) / 2n;
    const expanded = halfWidth + mulDivDown(halfWidth, expansionBps, BPS);
    return {
        ...range,
        lowerTick: mid - expanded,
        upperTick: mid + expanded,
        minPrice: mid - expanded,
        maxPrice: mid + expanded,
    };
}

export function compressRange(range: RangeSpec, compressionBps: bigint): RangeSpec {
    ensureBps("compressionBps", compressionBps);
    const mid = midpoint(range);
    const halfWidth = (range.upperTick - range.lowerTick) / 2n;
    const reduced = halfWidth - mulDivDown(halfWidth, compressionBps, BPS);
    const safeWidth = max(reduced, 1n);
    return {
        ...range,
        lowerTick: mid - safeWidth,
        upperTick: mid + safeWidth,
        minPrice: mid - safeWidth,
        maxPrice: mid + safeWidth,
    };
}
