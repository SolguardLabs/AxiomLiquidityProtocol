import {
    BPS,
    SHARE_SCALE,
    ZERO,
    formatShares,
    mulDivDown,
    ratioBps,
    shares,
} from "../domain/amount.ts";
import { ensureAmount, ensureDefined, fail, normalizeId } from "../domain/errors.ts";
import type { AccountId, ShareSnapshot } from "../domain/types.ts";

export interface TransferResult {
    readonly from: AccountId;
    readonly to: AccountId;
    readonly shares: bigint;
    readonly fromBalance: bigint;
    readonly toBalance: bigint;
}

export class ShareLedger {
    readonly name: string;
    readonly symbol: string;
    #balances = new Map<AccountId, bigint>();
    #totalSupply = ZERO;

    constructor(name: string, symbol: string) {
        this.name = name;
        this.symbol = symbol;
    }

    totalSupply(): bigint {
        return this.#totalSupply;
    }

    balanceOf(account: AccountId): bigint {
        return this.#balances.get(normalizeId("account", account)) ?? ZERO;
    }

    hasAccount(account: AccountId): boolean {
        return this.#balances.has(normalizeId("account", account));
    }

    holders(): AccountId[] {
        return [...this.#balances.keys()]
            .filter((account) => this.balanceOf(account) > ZERO)
            .sort();
    }

    mint(account: AccountId, amount: bigint): void {
        const id = normalizeId("account", account);
        ensureAmount("shares", amount);
        const current = this.#balances.get(id) ?? ZERO;
        this.#balances.set(id, current + amount);
        this.#totalSupply += amount;
    }

    burn(account: AccountId, amount: bigint): void {
        const id = normalizeId("account", account);
        ensureAmount("shares", amount);
        const current = this.#balances.get(id) ?? ZERO;
        if (current < amount) {
            fail("INSUFFICIENT_SHARES", "account does not have enough shares", {
                account: id,
                requested: amount,
                balance: current,
            });
        }
        const next = current - amount;
        if (next === ZERO) {
            this.#balances.delete(id);
        } else {
            this.#balances.set(id, next);
        }
        this.#totalSupply -= amount;
    }

    transfer(from: AccountId, to: AccountId, amount: bigint): TransferResult {
        const source = normalizeId("from", from);
        const target = normalizeId("to", to);
        if (source === target) {
            fail("SELF_TRANSFER", "cannot transfer shares to the same account", {
                account: source,
            });
        }
        this.burn(source, amount);
        this.mint(target, amount);
        return {
            from: source,
            to: target,
            shares: amount,
            fromBalance: this.balanceOf(source),
            toBalance: this.balanceOf(target),
        };
    }

    percentOfSupply(account: AccountId): bigint {
        if (this.#totalSupply === ZERO) {
            return ZERO;
        }
        return ratioBps(this.balanceOf(account), this.#totalSupply);
    }

    snapshot(totalAssets: bigint): ShareSnapshot[] {
        const supply = this.#totalSupply;
        return this.holders().map((account) => {
            const balance = ensureDefined(
                this.#balances.get(account),
                "MISSING_BALANCE",
                "missing balance",
            );
            const assets = supply === ZERO ? ZERO : mulDivDown(balance, totalAssets, supply);
            return {
                account,
                shares: balance,
                assets,
                shareBps: supply === ZERO ? ZERO : mulDivDown(balance, BPS, supply),
            };
        });
    }

    describe(account: AccountId): string {
        const balance = this.balanceOf(account);
        return `${account}: ${formatShares(balance)} ${this.symbol}`;
    }

    clone(): ShareLedger {
        const copy = new ShareLedger(this.name, this.symbol);
        for (const [account, balance] of this.#balances) {
            if (balance > ZERO) {
                copy.mint(account, balance);
            }
        }
        return copy;
    }

    static initialSupply(account: AccountId, amount = shares(1)): ShareLedger {
        const ledger = new ShareLedger("Axiom Vault Share", "axSHARE");
        ledger.mint(account, amount * SHARE_SCALE);
        return ledger;
    }
}
