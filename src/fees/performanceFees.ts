import { ZERO, percentOf, saturatingSub } from "../domain/amount.ts";
import { ensureBps } from "../domain/errors.ts";
import type {
    AssetAmount,
    PerformanceReportResult,
    ShareAmount,
    StrategyState,
} from "../domain/types.ts";
import type { AxiomVault } from "../vault/vaultLedger.ts";
import type { StrategyBook } from "../strategies/strategyBook.ts";

export interface FeeCrystallization {
    readonly strategyId: string;
    readonly feeRecipient: string;
    readonly grossGain: AssetAmount;
    readonly feeAssets: AssetAmount;
    readonly feeShares: ShareAmount;
    readonly highWatermarkBefore: AssetAmount;
    readonly highWatermarkAfter: AssetAmount;
}

export class PerformanceFeePolicy {
    readonly protocolMaxFeeBps: bigint;

    constructor(protocolMaxFeeBps: bigint) {
        ensureBps("protocolMaxFeeBps", protocolMaxFeeBps);
        this.protocolMaxFeeBps = protocolMaxFeeBps;
    }

    preview(strategy: StrategyState, reportedValue: AssetAmount): FeeCrystallization {
        const highWatermark = strategy.accounting.highWatermark;
        const grossGain = saturatingSub(reportedValue, highWatermark);
        const feeBps =
            strategy.policy.performanceFeeBps > this.protocolMaxFeeBps
                ? this.protocolMaxFeeBps
                : strategy.policy.performanceFeeBps;
        const feeAssets = grossGain === ZERO ? ZERO : percentOf(grossGain, feeBps);
        return {
            strategyId: strategy.id,
            feeRecipient: strategy.policy.feeRecipient,
            grossGain,
            feeAssets,
            feeShares: ZERO,
            highWatermarkBefore: highWatermark,
            highWatermarkAfter: grossGain === ZERO ? highWatermark : reportedValue,
        };
    }

    crystallize(
        strategy: StrategyState,
        reportedValue: AssetAmount,
        vault: AxiomVault,
        book: StrategyBook,
        timestamp = Date.now(),
    ): FeeCrystallization {
        const preview = this.preview(strategy, reportedValue);
        if (preview.feeAssets === ZERO) {
            return preview;
        }
        const minted = vault.mintFeeShares(preview.feeRecipient, preview.feeAssets, timestamp);
        book.accrueFee(strategy.id, preview.feeAssets, timestamp);
        book.setHighWatermark(strategy.id, preview.highWatermarkAfter);
        return {
            ...preview,
            feeShares: minted,
        };
    }
}

export function emptyReportResult(
    strategy: StrategyState,
    totalAssetsAfter: AssetAmount,
    shareSupplyAfter: ShareAmount,
): Pick<
    PerformanceReportResult,
    "strategyId" | "feeAssets" | "feeShares" | "totalAssetsAfter" | "shareSupplyAfter"
> {
    return {
        strategyId: strategy.id,
        feeAssets: ZERO,
        feeShares: ZERO,
        totalAssetsAfter,
        shareSupplyAfter,
    };
}
