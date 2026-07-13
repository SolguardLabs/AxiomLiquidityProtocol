import { ZERO } from "../domain/amount.ts";
import { ensureAmount, fail, normalizeId } from "../domain/errors.ts";
import type { AccountId, AccountProfile } from "../domain/types.ts";

export interface CashMovement {
    readonly account: AccountId;
    readonly amount: bigint;
    readonly balanceAfter: bigint;
}

export class AccountBook {
    #profiles = new Map<AccountId, AccountProfile>();
    #cash = new Map<AccountId, bigint>();

    register(id: AccountId, label = id, metadata: Record<string, string> = {}): AccountProfile {
        const account = normalizeId("account", id);
        const existing = this.#profiles.get(account);
        if (existing !== undefined) {
            return existing;
        }
        const profile = {
            id: account,
            label,
            createdAt: Date.now(),
            metadata: { ...metadata },
        } satisfies AccountProfile;
        this.#profiles.set(account, profile);
        this.#cash.set(account, this.#cash.get(account) ?? ZERO);
        return profile;
    }

    profile(id: AccountId): AccountProfile {
        const account = normalizeId("account", id);
        const profile = this.#profiles.get(account);
        if (profile === undefined) {
            fail("UNKNOWN_ACCOUNT", "account is not registered", { account });
        }
        return profile;
    }

    accounts(): AccountProfile[] {
        return [...this.#profiles.values()].sort((a, b) => a.id.localeCompare(b.id));
    }

    credit(account: AccountId, amount: bigint): CashMovement {
        const id = normalizeId("account", account);
        this.register(id);
        ensureAmount("amount", amount);
        const next = (this.#cash.get(id) ?? ZERO) + amount;
        this.#cash.set(id, next);
        return { account: id, amount, balanceAfter: next };
    }

    debit(account: AccountId, amount: bigint): CashMovement {
        const id = normalizeId("account", account);
        this.register(id);
        ensureAmount("amount", amount);
        const current = this.#cash.get(id) ?? ZERO;
        if (current < amount) {
            fail("INSUFFICIENT_CASH", "account does not have enough cash", {
                account: id,
                requested: amount,
                balance: current,
            });
        }
        const next = current - amount;
        this.#cash.set(id, next);
        return { account: id, amount, balanceAfter: next };
    }

    balanceOf(account: AccountId): bigint {
        return this.#cash.get(normalizeId("account", account)) ?? ZERO;
    }

    transfer(from: AccountId, to: AccountId, amount: bigint): void {
        this.debit(from, amount);
        this.credit(to, amount);
    }

    seed(entries: readonly { account: AccountId; amount: bigint; label?: string }[]): void {
        for (const entry of entries) {
            this.register(entry.account, entry.label ?? entry.account);
            if (entry.amount > ZERO) {
                this.credit(entry.account, entry.amount);
            }
        }
    }
}
