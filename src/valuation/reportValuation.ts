import { BPS, ZERO, min, ratioBps, saturatingSub } from "../domain/amount.ts";
import type { AggregatePoolQuote, AssetAmount, PerformanceReportRequest } from "../domain/types.ts";

export type ValuationQuality = "observable" | "estimated" | "stressed" | "unavailable";

export interface ReportValuation {
    readonly previousValue: AssetAmount;
    readonly reportedValue: AssetAmount;
    readonly adjustedValue: AssetAmount;
    readonly feeReferenceValue: AssetAmount;
    readonly valuationGap: AssetAmount;
    readonly confidenceBps: bigint;
    readonly quality: ValuationQuality;
}

/**
 * Normalizes a strategy report into the values consumed by accounting, fees and monitoring.
 * The object is immutable so every downstream component observes the same report envelope.
 */
export class ReportValuationEngine {
    resolve(
        previousValue: AssetAmount,
        request: PerformanceReportRequest,
        quote: AggregatePoolQuote,
    ): ReportValuation {
        const reportedValue = request.reportedValue ?? quote.optimisticValue;
        const adjustedValue = this.adjustedValue(reportedValue, quote);
        const valuationGap = saturatingSub(reportedValue, adjustedValue);
        const confidenceBps =
            reportedValue === ZERO ? ZERO : min(ratioBps(adjustedValue, reportedValue), BPS);

        return {
            previousValue,
            reportedValue,
            adjustedValue,
            feeReferenceValue: reportedValue,
            valuationGap,
            confidenceBps,
            quality: this.quality(quote, valuationGap),
        };
    }

    private adjustedValue(reportedValue: AssetAmount, quote: AggregatePoolQuote): AssetAmount {
        if (quote.quotes.length === 0) {
            return ZERO;
        }
        if (quote.unrealizedLoss === ZERO && quote.exitPenalty === ZERO) {
            return reportedValue;
        }
        return min(quote.exitValue, reportedValue);
    }

    private quality(quote: AggregatePoolQuote, valuationGap: AssetAmount): ValuationQuality {
        if (quote.quotes.length === 0) {
            return "unavailable";
        }
        if (valuationGap === ZERO) {
            return "observable";
        }
        return quote.unrealizedLoss > ZERO ? "stressed" : "estimated";
    }
}
