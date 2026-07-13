import {
    ASSET_SCALE,
    SHARE_SCALE,
    ZERO,
    formatAsset,
    mulDivDown,
    mulDivUp,
    ratioScaled,
    saturatingSub,
} from "../domain/amount.ts";
import { ensureAmount, fail } from "../domain/errors.ts";
import { EventLog } from "../domain/events.ts";
import type {
    AccountId,
    AssetAmount,
    DepositResult,
    ShareAmount,
    VaultConfig,
    VaultSnapshot,
    WithdrawalResult,
    WithdrawalSource,
} from "../domain/types.ts";
import { ShareLedger } from "../token/shareLedger.ts";

export interface ManagedSettlement {
    readonly previousManaged: AssetAmount;
    readonly nextManaged: AssetAmount;
    readonly delta: bigint;
}

export class AxiomVault {
    readonly config: VaultConfig;
    readonly shares: ShareLedger;
    readonly events: EventLog;
    #idleAssets: AssetAmount = ZERO;
    #managedAssets: AssetAmount = ZERO;

    constructor(config: VaultConfig, events: EventLog) {
        this.config = config;
        this.events = events;
        this.shares = new ShareLedger(config.name, config.shareSymbol);
    }

    idleAssets(): AssetAmount {
        return this.#idleAssets;
    }

    managedAssets(): AssetAmount {
        return this.#managedAssets;
    }

    totalAssets(): AssetAmount {
        return this.#idleAssets + this.#managedAssets;
    }

    totalShares(): ShareAmount {
        return this.shares.totalSupply();
    }

    pricePerShare(): bigint {
        const supply = this.totalShares();
        if (supply === ZERO) {
            return SHARE_SCALE;
        }
        return ratioScaled(this.totalAssets(), supply, ASSET_SCALE);
    }

    balanceOf(account: AccountId): ShareAmount {
        return this.shares.balanceOf(account);
    }

    previewDeposit(assets: AssetAmount): ShareAmount {
        ensureAmount("assets", assets);
        const supply = this.totalShares();
        const totalAssets = this.totalAssets();
        if (supply === ZERO || totalAssets === ZERO) {
            return assets;
        }
        return mulDivDown(assets, supply, totalAssets);
    }

    previewRedeem(shares: ShareAmount): AssetAmount {
        ensureAmount("shares", shares);
        const supply = this.totalShares();
        if (supply === ZERO) {
            fail("EMPTY_SUPPLY", "cannot redeem from an empty vault");
        }
        return mulDivDown(shares, this.totalAssets(), supply);
    }

    previewMintForAssets(assets: AssetAmount): ShareAmount {
        ensureAmount("assets", assets);
        const supply = this.totalShares();
        const totalAssets = this.totalAssets();
        if (supply === ZERO || totalAssets === ZERO) {
            return assets;
        }
        return mulDivUp(assets, supply, totalAssets);
    }

    deposit(account: AccountId, assets: AssetAmount, timestamp = Date.now()): DepositResult {
        ensureAmount("assets", assets);
        if (this.totalShares() === ZERO && assets < this.config.minInitialDeposit) {
            fail("MIN_INITIAL_DEPOSIT", "initial deposit is below protocol minimum", {
                assets,
                minimum: this.config.minInitialDeposit,
            });
        }
        const minted = this.previewDeposit(assets);
        if (minted === ZERO) {
            fail("ZERO_SHARES", "deposit would mint zero shares", { assets });
        }
        this.#idleAssets += assets;
        this.shares.mint(account, minted);
        const result = {
            account,
            assets,
            shares: minted,
            totalAssets: this.totalAssets(),
            totalShares: this.totalShares(),
        } satisfies DepositResult;
        this.events.emit("vault.deposit", {
            account,
            assets,
            shares: minted,
            totalAssets: result.totalAssets,
            totalShares: result.totalShares,
            timestamp,
        });
        return result;
    }

    mintFeeShares(account: AccountId, feeAssets: AssetAmount, timestamp = Date.now()): ShareAmount {
        if (feeAssets === ZERO) {
            return ZERO;
        }
        ensureAmount("feeAssets", feeAssets);
        const minted = this.previewMintForAssets(feeAssets);
        if (minted === ZERO) {
            return ZERO;
        }
        this.shares.mint(account, minted);
        this.events.emit("fees.crystallized", {
            account,
            feeAssets,
            feeShares: minted,
            totalAssets: this.totalAssets(),
            totalShares: this.totalShares(),
            timestamp,
        });
        return minted;
    }

    moveIdleToManaged(amount: AssetAmount): void {
        ensureAmount("amount", amount);
        if (this.#idleAssets < amount) {
            fail("INSUFFICIENT_IDLE", "vault does not have enough idle assets", {
                requested: amount,
                idleAssets: this.#idleAssets,
            });
        }
        this.#idleAssets -= amount;
        this.#managedAssets += amount;
    }

    completeRecall(
        accountedReduction: AssetAmount,
        returnedAssets: AssetAmount,
    ): ManagedSettlement {
        ensureAmount("accountedReduction", accountedReduction);
        if (accountedReduction > this.#managedAssets) {
            fail("RECALL_EXCEEDS_MANAGED", "recall exceeds managed assets", {
                accountedReduction,
                managedAssets: this.#managedAssets,
            });
        }
        const previousManaged = this.#managedAssets;
        this.#managedAssets -= accountedReduction;
        this.#idleAssets += returnedAssets;
        return {
            previousManaged,
            nextManaged: this.#managedAssets,
            delta: returnedAssets - accountedReduction,
        };
    }

    revalueManaged(previousValue: AssetAmount, nextValue: AssetAmount): ManagedSettlement {
        const previousManaged = this.#managedAssets;
        if (nextValue >= previousValue) {
            this.#managedAssets += nextValue - previousValue;
        } else {
            this.#managedAssets = saturatingSub(this.#managedAssets, previousValue - nextValue);
        }
        return {
            previousManaged,
            nextManaged: this.#managedAssets,
            delta: nextValue - previousValue,
        };
    }

    releaseIdle(
        account: AccountId,
        sharesToBurn: ShareAmount,
        assetsOut: AssetAmount,
    ): WithdrawalResult {
        ensureAmount("shares", sharesToBurn);
        ensureAmount("assetsOut", assetsOut);
        if (this.#idleAssets < assetsOut) {
            fail("INSUFFICIENT_IDLE", "not enough idle assets for release", {
                requested: assetsOut,
                idleAssets: this.#idleAssets,
            });
        }
        this.shares.burn(account, sharesToBurn);
        this.#idleAssets -= assetsOut;
        return {
            account,
            requestedShares: sharesToBurn,
            burnedShares: sharesToBurn,
            assetsOut,
            source: "idle",
            totalAssets: this.totalAssets(),
            totalShares: this.totalShares(),
        };
    }

    classifyWithdrawalSource(beforeIdle: AssetAmount, assetsOut: AssetAmount): WithdrawalSource {
        if (assetsOut <= beforeIdle) {
            return "idle";
        }
        if (beforeIdle === ZERO) {
            return "managed";
        }
        return "mixed";
    }

    snapshot(): VaultSnapshot {
        const totalAssets = this.totalAssets();
        return {
            asset: this.config.asset,
            idleAssets: this.#idleAssets,
            managedAssets: this.#managedAssets,
            totalAssets,
            totalShares: this.totalShares(),
            pricePerShare: this.pricePerShare(),
            accounts: this.shares.snapshot(totalAssets),
        };
    }

    describe(): string {
        return [
            `${this.config.name} (${this.config.asset})`,
            `idle=${formatAsset(this.#idleAssets)}`,
            `managed=${formatAsset(this.#managedAssets)}`,
            `total=${formatAsset(this.totalAssets())}`,
        ].join(" ");
    }
}
