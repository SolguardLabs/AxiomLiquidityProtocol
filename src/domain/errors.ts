export class AxiomError extends Error {
    readonly code: string;
    readonly details: Record<string, string | bigint | number | boolean | undefined>;

    constructor(
        code: string,
        message: string,
        details: Record<string, string | bigint | number | boolean | undefined> = {},
    ) {
        super(message);
        this.name = "AxiomError";
        this.code = code;
        this.details = details;
    }
}

export function fail(
    code: string,
    message: string,
    details: Record<string, string | bigint | number | boolean | undefined> = {},
): never {
    throw new AxiomError(code, message, details);
}

export function ensure(condition: unknown, code: string, message: string): asserts condition {
    if (!condition) {
        fail(code, message);
    }
}

export function ensureAmount(name: string, amount: bigint): void {
    if (amount <= 0n) {
        fail("AMOUNT_NOT_POSITIVE", `${name} must be positive`, { amount });
    }
}

export function ensureNonNegative(name: string, amount: bigint): void {
    if (amount < 0n) {
        fail("AMOUNT_NEGATIVE", `${name} cannot be negative`, { amount });
    }
}

export function ensureBps(name: string, value: bigint): void {
    if (value < 0n || value > 10_000n) {
        fail("BPS_OUT_OF_RANGE", `${name} must be between 0 and 10000`, { value });
    }
}

export function ensureDefined<T>(value: T | undefined, code: string, message: string): T {
    if (value === undefined) {
        fail(code, message);
    }
    return value;
}

export function ensureNotEmpty(name: string, value: string): void {
    if (value.trim().length === 0) {
        fail("EMPTY_IDENTIFIER", `${name} cannot be empty`);
    }
}

export function normalizeId(kind: string, id: string): string {
    const normalized = id.trim();
    ensureNotEmpty(kind, normalized);
    return normalized;
}
