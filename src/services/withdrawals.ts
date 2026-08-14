import { ZERO, min } from "../domain/amount.ts";
import { ensureAmount, fail } from "../domain/errors.ts";
import { EventLog } from "../domain/events.ts";
import type {
    AssetAmount,
    WithdrawalRequest,
    WithdrawalResult,
    WithdrawalSource,
} from "../domain/types.ts";
import { RiskController } from "../risk/riskController.ts";
import { AxiomAllocator } from "./allocator.ts";
import { AxiomVault } from "../vault/vaultLedger.ts";

export class WithdrawalService {
    readonly vault: AxiomVault;
    readonly allocator: AxiomAllocator;
    readonly risk: RiskController;
    readonly events: EventLog;

    constructor(input: {
        vault: AxiomVault;
        allocator: AxiomAllocator;
        risk: RiskController;
        events: EventLog;
    }) {
        this.vault = input.vault;
        this.allocator = input.allocator;
        this.risk = input.risk;
        this.events = input.events;
    }

    withdraw(request: WithdrawalRequest): WithdrawalResult {
        ensureAmount("shares", request.shares);
        if (this.vault.balanceOf(request.account) < request.shares) {
            fail("INSUFFICIENT_SHARES", "account does not have enough shares", {
                account: request.account,
                requested: request.shares,
                balance: this.vault.balanceOf(request.account),
            });
        }
        this.risk.validateWithdrawal(
            request,
            this.vault.snapshot(),
            this.vault.config.maxWithdrawalBps,
        );
        const beforeIdle = this.vault.idleAssets();
        const initialPreview = this.vault.previewRedeem(request.shares);
        if (beforeIdle < initialPreview && this.vault.managedAssets() > ZERO) {
            this.allocator.recall({
                amount: initialPreview - beforeIdle,
                timestamp: request.timestamp,
            });
        }

        const repriced = this.vault.previewRedeem(request.shares);
        const assetsOut = min(repriced, this.vault.idleAssets());
        if (assetsOut === ZERO) {
            fail("ZERO_WITHDRAWAL", "withdrawal would return zero assets", {
                account: request.account,
                shares: request.shares,
            });
        }
        const result = this.vault.releaseIdle(request.account, request.shares, assetsOut);
        const source = this.classify(beforeIdle, initialPreview, assetsOut);
        const finalResult = {
            ...result,
            source,
        } satisfies WithdrawalResult;
        this.events.emit("vault.withdraw", {
            account: request.account,
            shares: request.shares,
            assetsOut,
            source,
            totalAssets: finalResult.totalAssets,
            totalShares: finalResult.totalShares,
            timestamp: request.timestamp ?? Date.now(),
        });
        return finalResult;
    }

    withdrawAll(account: string, timestamp = Date.now()): WithdrawalResult {
        const balance = this.vault.balanceOf(account);
        ensureAmount("shares", balance);
        return this.withdraw({ account, shares: balance, timestamp });
    }

    preview(account: string, shares: bigint): AssetAmount {
        if (this.vault.balanceOf(account) < shares) {
            return ZERO;
        }
        return this.vault.previewRedeem(shares);
    }

    private classify(
        beforeIdle: AssetAmount,
        initialPreview: AssetAmount,
        assetsOut: AssetAmount,
    ): WithdrawalSource {
        if (initialPreview <= beforeIdle && assetsOut <= beforeIdle) {
            return "idle";
        }
        if (beforeIdle === ZERO) {
            return "managed";
        }
        return "mixed";
    }
}
