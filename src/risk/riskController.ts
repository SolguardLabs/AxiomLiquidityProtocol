import { BPS, ZERO, percentOf, ratioBps } from "../domain/amount.ts";
import { ensureAmount, ensureBps, fail } from "../domain/errors.ts";
import type {
    AggregatePoolQuote,
    AllocationRequest,
    BasisPoints,
    PoolConfig,
    RangeSpec,
    RiskLimits,
    StrategyState,
    VaultSnapshot,
    WithdrawalRequest,
} from "../domain/types.ts";
import { widthBps } from "../adapters/range.ts";

export class RiskController {
    #limits: RiskLimits;

    constructor(limits: RiskLimits) {
        this.#limits = { ...limits };
        this.validateLimits();
    }

    limits(): RiskLimits {
        return { ...this.#limits };
    }

    update(partial: Partial<RiskLimits>): RiskLimits {
        this.#limits = { ...this.#limits, ...partial };
        this.validateLimits();
        return this.limits();
    }

    validatePool(config: PoolConfig): void {
        ensureBps("feeTierBps", config.feeTierBps);
        ensureBps("exitPenaltyBps", config.exitPenaltyBps);
        if (config.exitPenaltyBps > this.#limits.maxPoolExitPenaltyBps) {
            fail("POOL_EXIT_PENALTY_HIGH", "pool exit penalty exceeds limit", {
                pool: config.id,
                exitPenaltyBps: config.exitPenaltyBps,
            });
        }
    }

    validateRange(range: RangeSpec): void {
        const width = widthBps(range);
        if (width > this.#limits.maxRangeWidthBps) {
            fail("RANGE_TOO_WIDE", "range width exceeds protocol limit", {
                range: range.id,
                widthBps: width,
                maxRangeWidthBps: this.#limits.maxRangeWidthBps,
            });
        }
    }

    validateStrategy(strategy: StrategyState): void {
        ensureBps("performanceFeeBps", strategy.policy.performanceFeeBps);
        ensureBps("maxAllocationBps", strategy.policy.maxAllocationBps);
        if (strategy.policy.performanceFeeBps > this.#limits.maxStrategistFeeBps) {
            fail("STRATEGIST_FEE_HIGH", "strategy fee exceeds protocol limit", {
                strategy: strategy.id,
                feeBps: strategy.policy.performanceFeeBps,
            });
        }
        if (strategy.policy.maxAllocationBps > this.#limits.maxStrategyAllocationBps) {
            fail("STRATEGY_CAP_HIGH", "strategy allocation cap exceeds protocol limit", {
                strategy: strategy.id,
                capBps: strategy.policy.maxAllocationBps,
            });
        }
        for (const range of strategy.ranges) {
            this.validateRange(range);
        }
    }

    validateAllocation(
        request: AllocationRequest,
        strategy: StrategyState,
        vault: VaultSnapshot,
        pool: PoolConfig,
        minimumIdleBps: BasisPoints,
    ): void {
        ensureAmount("amount", request.amount);
        if (strategy.status !== "active") {
            fail("STRATEGY_INACTIVE", "strategy is not active", { strategy: strategy.id });
        }
        if (
            strategy.policy.allowedPools.length > 0 &&
            !strategy.policy.allowedPools.includes(request.poolId)
        ) {
            fail("POOL_NOT_ALLOWED", "pool is not allowed for strategy", {
                strategy: strategy.id,
                pool: request.poolId,
            });
        }
        if (request.amount > vault.idleAssets) {
            fail("INSUFFICIENT_IDLE", "allocation exceeds idle assets", {
                requested: request.amount,
                idleAssets: vault.idleAssets,
            });
        }
        const requiredIdleAssets = this.requiredIdle(vault.totalAssets, minimumIdleBps);
        if (vault.idleAssets - request.amount < requiredIdleAssets) {
            fail("IDLE_BUFFER_BREACHED", "allocation would breach the minimum idle buffer", {
                requested: request.amount,
                idleAssets: vault.idleAssets,
                requiredIdleAssets,
            });
        }
        if (request.amount < this.#limits.minRangeLiquidity) {
            fail("ALLOCATION_TOO_SMALL", "allocation is below range minimum", {
                requested: request.amount,
                minimum: this.#limits.minRangeLiquidity,
            });
        }
        const nextStrategyAssets = strategy.accounting.accountedValue + request.amount;
        const strategyCap = percentOf(vault.totalAssets, strategy.policy.maxAllocationBps);
        if (nextStrategyAssets > strategyCap) {
            fail("STRATEGY_CAP_EXCEEDED", "strategy allocation cap exceeded", {
                strategy: strategy.id,
                nextStrategyAssets,
                strategyCap,
            });
        }
        const poolBps =
            vault.totalAssets === ZERO ? ZERO : ratioBps(request.amount, vault.totalAssets);
        if (poolBps > this.#limits.maxPoolAllocationBps) {
            fail("POOL_CAP_EXCEEDED", "pool allocation cap exceeded", {
                pool: pool.id,
                poolBps,
                maxPoolAllocationBps: this.#limits.maxPoolAllocationBps,
            });
        }
        if (strategy.positions.length >= this.#limits.maxOpenPositionsPerStrategy) {
            fail("TOO_MANY_POSITIONS", "strategy has too many open positions", {
                strategy: strategy.id,
                positions: strategy.positions.length,
            });
        }
    }

    validateReport(strategy: StrategyState, quote: AggregatePoolQuote): void {
        if (strategy.status === "retired") {
            fail("STRATEGY_RETIRED", "retired strategy cannot report", { strategy: strategy.id });
        }
        if (
            !strategy.policy.allowOutOfRangeReports &&
            quote.quotes.some((entry) => !entry.inRange)
        ) {
            fail("RANGE_INACTIVE", "strategy has an out-of-range position", {
                strategy: strategy.id,
            });
        }
        if (quote.optimisticValue === ZERO) {
            return;
        }
        const lossBps = ratioBps(quote.unrealizedLoss + quote.exitPenalty, quote.optimisticValue);
        if (lossBps > this.#limits.maxReportLossBps) {
            fail("REPORT_LOSS_HIGH", "reported exposure loss exceeds limit", {
                strategy: strategy.id,
                lossBps,
                maxReportLossBps: this.#limits.maxReportLossBps,
            });
        }
    }

    validateWithdrawal(
        request: WithdrawalRequest,
        vault: VaultSnapshot,
        maximumWithdrawalBps: BasisPoints,
    ): void {
        ensureAmount("shares", request.shares);
        ensureBps("maximumWithdrawalBps", maximumWithdrawalBps);
        if (vault.totalShares === ZERO) {
            fail("EMPTY_SUPPLY", "cannot withdraw from empty vault");
        }
        const shareBps = ratioBps(request.shares, vault.totalShares);
        if (shareBps > maximumWithdrawalBps && request.shares < vault.totalShares) {
            fail("WITHDRAWAL_TOO_LARGE", "withdrawal exceeds single-request policy", {
                requestedShares: request.shares,
                shareBps,
                maximumWithdrawalBps,
            });
        }
    }

    requiredIdle(totalAssets: bigint, minimumIdleBps: BasisPoints): bigint {
        ensureBps("minimumIdleBps", minimumIdleBps);
        return percentOf(totalAssets, minimumIdleBps);
    }

    private validateLimits(): void {
        ensureBps("maxStrategyAllocationBps", this.#limits.maxStrategyAllocationBps);
        ensureBps("maxPoolAllocationBps", this.#limits.maxPoolAllocationBps);
        ensureBps("maxRangeWidthBps", this.#limits.maxRangeWidthBps);
        ensureBps("maxReportLossBps", this.#limits.maxReportLossBps);
        ensureBps("maxStrategistFeeBps", this.#limits.maxStrategistFeeBps);
        ensureBps("maxPoolExitPenaltyBps", this.#limits.maxPoolExitPenaltyBps);
        if (this.#limits.maxStrategyAllocationBps === ZERO) {
            fail("INVALID_LIMITS", "strategy allocation limit cannot be zero");
        }
        if (this.#limits.maxOpenPositionsPerStrategy <= 0) {
            fail("INVALID_LIMITS", "open position limit cannot be zero");
        }
    }
}
