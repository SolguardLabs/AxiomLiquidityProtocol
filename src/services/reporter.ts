import { ZERO, max, saturatingSub } from "../domain/amount.ts";
import { EventLog } from "../domain/events.ts";
import type {
    AggregatePoolQuote,
    AssetAmount,
    PerformanceReportRequest,
    PerformanceReportResult,
    StrategyState,
} from "../domain/types.ts";
import { PoolRegistry } from "../adapters/poolRegistry.ts";
import { PerformanceFeePolicy } from "../fees/performanceFees.ts";
import { RiskController } from "../risk/riskController.ts";
import { StrategyBook } from "../strategies/strategyBook.ts";
import { AxiomVault } from "../vault/vaultLedger.ts";
import { ReportValuationEngine } from "../valuation/reportValuation.ts";

export class AxiomReporter {
    readonly vault: AxiomVault;
    readonly strategies: StrategyBook;
    readonly pools: PoolRegistry;
    readonly risk: RiskController;
    readonly fees: PerformanceFeePolicy;
    readonly events: EventLog;
    readonly valuation: ReportValuationEngine;

    constructor(input: {
        vault: AxiomVault;
        strategies: StrategyBook;
        pools: PoolRegistry;
        risk: RiskController;
        fees: PerformanceFeePolicy;
        events: EventLog;
    }) {
        this.vault = input.vault;
        this.strategies = input.strategies;
        this.pools = input.pools;
        this.risk = input.risk;
        this.fees = input.fees;
        this.events = input.events;
        this.valuation = new ReportValuationEngine();
    }

    report(request: PerformanceReportRequest): PerformanceReportResult {
        const timestamp = request.timestamp ?? Date.now();
        const strategy = this.strategies.read(request.strategyId);
        const quote = this.aggregateQuote(strategy);
        this.risk.validateReport(strategy, quote);

        const previousValue = strategy.accounting.accountedValue;
        const valuation = this.valuation.resolve(previousValue, request, quote);
        const reportedValue = valuation.reportedValue;
        const fee = this.fees.crystallize(
            strategy,
            valuation.feeReferenceValue,
            this.vault,
            this.strategies,
            timestamp,
        );

        if (reportedValue !== previousValue) {
            this.vault.revalueManaged(previousValue, reportedValue);
            this.strategies.setAccountedValue(strategy.id, reportedValue, timestamp);
            this.events.emit("strategy.value-adjusted", {
                strategyId: strategy.id,
                previousValue,
                nextValue: reportedValue,
                timestamp,
            });
        }

        const adjustedValue = valuation.adjustedValue;
        if (adjustedValue !== reportedValue) {
            this.vault.revalueManaged(reportedValue, adjustedValue);
            this.strategies.setAccountedValue(strategy.id, adjustedValue, timestamp);
            const realizedLoss =
                reportedValue > adjustedValue ? reportedValue - adjustedValue : ZERO;
            if (realizedLoss > ZERO) {
                this.strategies.applyLoss(strategy.id, realizedLoss, timestamp);
            }
            this.events.emit("strategy.value-adjusted", {
                strategyId: strategy.id,
                previousValue: reportedValue,
                nextValue: adjustedValue,
                timestamp,
            });
        }

        const grossGain = max(reportedValue - previousValue, ZERO);
        const realizedLoss = saturatingSub(reportedValue, adjustedValue);
        const result = {
            strategyId: strategy.id,
            previousValue,
            reportedValue,
            adjustedValue,
            grossGain,
            realizedLoss,
            feeAssets: fee.feeAssets,
            feeShares: fee.feeShares,
            totalAssetsAfter: this.vault.totalAssets(),
            shareSupplyAfter: this.vault.totalShares(),
            quotes: quote.quotes,
        } satisfies PerformanceReportResult;
        this.events.emit("strategy.reported", {
            strategyId: result.strategyId,
            previousValue: result.previousValue,
            reportedValue: result.reportedValue,
            adjustedValue: result.adjustedValue,
            feeAssets: result.feeAssets,
            feeShares: result.feeShares,
            timestamp,
            note: request.note,
            valuationQuality: valuation.quality,
            valuationConfidenceBps: valuation.confidenceBps,
            valuationGap: valuation.valuationGap,
        });
        return result;
    }

    quote(strategyId: string): AggregatePoolQuote {
        return this.aggregateQuote(this.strategies.read(strategyId));
    }

    private aggregateQuote(strategy: StrategyState): AggregatePoolQuote {
        return this.pools.quoteStrategy(strategy.id, strategy.positions);
    }
}
