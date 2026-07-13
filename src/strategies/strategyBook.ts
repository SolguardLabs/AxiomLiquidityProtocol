import { BPS, ZERO, min, percentOf, ratioBps, saturatingSub, sum } from "../domain/amount.ts";
import { ensureAmount, ensureBps, ensureDefined, fail, normalizeId } from "../domain/errors.ts";
import type {
    AccountId,
    AssetAmount,
    BasisPoints,
    PoolId,
    PositionId,
    RangeId,
    RangeSpec,
    StrategyAccounting,
    StrategyDraft,
    StrategyId,
    StrategySnapshot,
    StrategyState,
} from "../domain/types.ts";

interface MutableStrategy {
    id: StrategyId;
    label: string;
    status: StrategyState["status"];
    createdAt: number;
    policy: StrategyState["policy"];
    ranges: RangeSpec[];
    positions: PositionId[];
    accounting: StrategyAccounting;
}

export interface StrategyValueUpdate {
    readonly strategyId: StrategyId;
    readonly previousValue: AssetAmount;
    readonly nextValue: AssetAmount;
    readonly delta: bigint;
}

export interface PositionRegistration {
    readonly strategyId: StrategyId;
    readonly positionId: PositionId;
    readonly poolId: PoolId;
    readonly amount: AssetAmount;
    readonly accountedValue: AssetAmount;
}

export class StrategyBook {
    #strategies = new Map<StrategyId, MutableStrategy>();
    #positionStrategy = new Map<PositionId, StrategyId>();
    #positionPool = new Map<PositionId, PoolId>();

    create(draft: StrategyDraft, defaults: { performanceFeeBps: BasisPoints }): StrategyState {
        const id = normalizeId("strategy", draft.id);
        if (this.#strategies.has(id)) {
            fail("STRATEGY_EXISTS", "strategy already exists", { strategy: id });
        }
        const performanceFeeBps = draft.performanceFeeBps ?? defaults.performanceFeeBps;
        const maxAllocationBps = draft.maxAllocationBps ?? BPS;
        ensureBps("performanceFeeBps", performanceFeeBps);
        ensureBps("maxAllocationBps", maxAllocationBps);
        const strategy: MutableStrategy = {
            id,
            label: draft.label,
            status: "active",
            createdAt: draft.createdAt ?? Date.now(),
            policy: {
                strategist: normalizeId("strategist", draft.strategist),
                feeRecipient: normalizeId("feeRecipient", draft.feeRecipient ?? draft.strategist),
                performanceFeeBps,
                maxAllocationBps,
                allowedPools: [...(draft.allowedPools ?? [])],
                allowOutOfRangeReports: draft.allowOutOfRangeReports ?? false,
            },
            ranges: [...(draft.ranges ?? [])],
            positions: [],
            accounting: {
                principal: ZERO,
                accountedValue: ZERO,
                highWatermark: ZERO,
                cumulativeFees: ZERO,
                cumulativeLosses: ZERO,
                cumulativeWithdrawals: ZERO,
                lastReportAt: draft.createdAt ?? Date.now(),
            },
        };
        this.#strategies.set(id, strategy);
        return this.read(id);
    }

    read(strategyId: StrategyId): StrategyState {
        return this.copy(this.mutable(strategyId));
    }

    mutable(strategyId: StrategyId): MutableStrategy {
        const id = normalizeId("strategy", strategyId);
        return ensureDefined(this.#strategies.get(id), "UNKNOWN_STRATEGY", "strategy not found");
    }

    exists(strategyId: StrategyId): boolean {
        return this.#strategies.has(normalizeId("strategy", strategyId));
    }

    list(): StrategyState[] {
        return [...this.#strategies.values()]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((strategy) => this.copy(strategy));
    }

    pause(strategyId: StrategyId): StrategyState {
        const strategy = this.mutable(strategyId);
        strategy.status = "paused";
        return this.copy(strategy);
    }

    activate(strategyId: StrategyId): StrategyState {
        const strategy = this.mutable(strategyId);
        strategy.status = "active";
        return this.copy(strategy);
    }

    retire(strategyId: StrategyId): StrategyState {
        const strategy = this.mutable(strategyId);
        if (strategy.accounting.accountedValue > ZERO) {
            fail("STRATEGY_NOT_EMPTY", "strategy cannot retire while it has accounted value", {
                strategy: strategyId,
                accountedValue: strategy.accounting.accountedValue,
            });
        }
        strategy.status = "retired";
        return this.copy(strategy);
    }

    addRange(strategyId: StrategyId, range: RangeSpec): StrategyState {
        const strategy = this.mutable(strategyId);
        if (strategy.ranges.some((existing) => existing.id === range.id)) {
            fail("RANGE_EXISTS", "strategy range already exists", {
                strategy: strategyId,
                range: range.id,
            });
        }
        strategy.ranges.push(range);
        return this.copy(strategy);
    }

    selectRange(strategyId: StrategyId, rangeId?: RangeId): RangeSpec {
        const strategy = this.mutable(strategyId);
        if (strategy.ranges.length === 0) {
            fail("NO_RANGES", "strategy has no configured ranges", { strategy: strategyId });
        }
        if (rangeId === undefined) {
            return strategy.ranges[0]!;
        }
        const range = strategy.ranges.find((candidate) => candidate.id === rangeId);
        return ensureDefined(range, "UNKNOWN_RANGE", "strategy range not found");
    }

    registerPosition(input: PositionRegistration): StrategyState {
        const strategy = this.mutable(input.strategyId);
        ensureAmount("amount", input.amount);
        if (strategy.status !== "active") {
            fail("STRATEGY_INACTIVE", "strategy is not active", { strategy: input.strategyId });
        }
        const positionId = normalizeId("position", input.positionId);
        if (this.#positionStrategy.has(positionId)) {
            fail("POSITION_EXISTS", "position already registered", { position: positionId });
        }
        strategy.positions.push(positionId);
        strategy.accounting = {
            ...strategy.accounting,
            principal: strategy.accounting.principal + input.amount,
            accountedValue: strategy.accounting.accountedValue + input.accountedValue,
            highWatermark: strategy.accounting.highWatermark + input.accountedValue,
        };
        this.#positionStrategy.set(positionId, strategy.id);
        this.#positionPool.set(positionId, input.poolId);
        return this.copy(strategy);
    }

    removeClosedPositions(
        strategyId: StrategyId,
        livePositions: readonly PositionId[],
    ): StrategyState {
        const strategy = this.mutable(strategyId);
        const live = new Set(livePositions);
        for (const positionId of strategy.positions) {
            if (!live.has(positionId)) {
                this.#positionStrategy.delete(positionId);
                this.#positionPool.delete(positionId);
            }
        }
        strategy.positions = strategy.positions.filter((positionId) => live.has(positionId));
        return this.copy(strategy);
    }

    strategyForPosition(positionId: PositionId): StrategyId {
        return ensureDefined(
            this.#positionStrategy.get(normalizeId("position", positionId)),
            "UNKNOWN_POSITION",
            "position is not registered",
        );
    }

    poolForPosition(positionId: PositionId): PoolId {
        return ensureDefined(
            this.#positionPool.get(normalizeId("position", positionId)),
            "UNKNOWN_POSITION_POOL",
            "position pool is not registered",
        );
    }

    positions(strategyId: StrategyId): PositionId[] {
        return [...this.mutable(strategyId).positions];
    }

    accrueFee(
        strategyId: StrategyId,
        feeAssets: AssetAmount,
        timestamp = Date.now(),
    ): StrategyState {
        const strategy = this.mutable(strategyId);
        if (feeAssets === ZERO) {
            return this.copy(strategy);
        }
        ensureAmount("feeAssets", feeAssets);
        strategy.accounting = {
            ...strategy.accounting,
            cumulativeFees: strategy.accounting.cumulativeFees + feeAssets,
            lastReportAt: timestamp,
        };
        return this.copy(strategy);
    }

    applyLoss(strategyId: StrategyId, loss: AssetAmount, timestamp = Date.now()): StrategyState {
        const strategy = this.mutable(strategyId);
        if (loss === ZERO) {
            return this.copy(strategy);
        }
        ensureAmount("loss", loss);
        strategy.accounting = {
            ...strategy.accounting,
            cumulativeLosses: strategy.accounting.cumulativeLosses + loss,
            lastReportAt: timestamp,
        };
        return this.copy(strategy);
    }

    setHighWatermark(strategyId: StrategyId, value: AssetAmount): StrategyState {
        const strategy = this.mutable(strategyId);
        strategy.accounting = {
            ...strategy.accounting,
            highWatermark: value,
        };
        return this.copy(strategy);
    }

    setAccountedValue(
        strategyId: StrategyId,
        nextValue: AssetAmount,
        timestamp = Date.now(),
    ): StrategyValueUpdate {
        const strategy = this.mutable(strategyId);
        const previousValue = strategy.accounting.accountedValue;
        strategy.accounting = {
            ...strategy.accounting,
            accountedValue: nextValue,
            lastReportAt: timestamp,
        };
        return {
            strategyId: strategy.id,
            previousValue,
            nextValue,
            delta: nextValue - previousValue,
        };
    }

    reduceForRecall(
        strategyId: StrategyId,
        accountedReduction: AssetAmount,
        returnedAssets: AssetAmount,
        timestamp = Date.now(),
    ): StrategyState {
        const strategy = this.mutable(strategyId);
        ensureAmount("accountedReduction", accountedReduction);
        const boundedReduction = min(accountedReduction, strategy.accounting.accountedValue);
        const principalReduction =
            strategy.accounting.accountedValue === ZERO
                ? ZERO
                : min(
                      strategy.accounting.principal,
                      (strategy.accounting.principal * boundedReduction) /
                          strategy.accounting.accountedValue,
                  );
        const loss = returnedAssets < boundedReduction ? boundedReduction - returnedAssets : ZERO;
        strategy.accounting = {
            ...strategy.accounting,
            principal: saturatingSub(strategy.accounting.principal, principalReduction),
            accountedValue: saturatingSub(strategy.accounting.accountedValue, boundedReduction),
            cumulativeWithdrawals: strategy.accounting.cumulativeWithdrawals + returnedAssets,
            cumulativeLosses: strategy.accounting.cumulativeLosses + loss,
            lastReportAt: timestamp,
        };
        return this.copy(strategy);
    }

    totalAccountedValue(): AssetAmount {
        return sum(
            [...this.#strategies.values()].map((strategy) => strategy.accounting.accountedValue),
        );
    }

    totalPrincipal(): AssetAmount {
        return sum([...this.#strategies.values()].map((strategy) => strategy.accounting.principal));
    }

    allocationBps(strategyId: StrategyId, totalManaged: AssetAmount): BasisPoints {
        if (totalManaged === ZERO) {
            return ZERO;
        }
        return ratioBps(this.mutable(strategyId).accounting.accountedValue, totalManaged);
    }

    snapshots(totalAssets: AssetAmount): StrategySnapshot[] {
        return this.list().map((strategy) => ({
            id: strategy.id,
            label: strategy.label,
            status: strategy.status,
            strategist: strategy.policy.strategist,
            positions: strategy.positions.length,
            principal: strategy.accounting.principal,
            accountedValue: strategy.accounting.accountedValue,
            highWatermark: strategy.accounting.highWatermark,
            cumulativeFees: strategy.accounting.cumulativeFees,
            cumulativeLosses: strategy.accounting.cumulativeLosses,
            allocationBps:
                totalAssets === ZERO
                    ? ZERO
                    : ratioBps(strategy.accounting.accountedValue, totalAssets),
        }));
    }

    strategyCapacity(strategyId: StrategyId, totalAssets: AssetAmount): AssetAmount {
        const strategy = this.mutable(strategyId);
        return percentOf(totalAssets, strategy.policy.maxAllocationBps);
    }

    private copy(strategy: MutableStrategy): StrategyState {
        return {
            id: strategy.id,
            label: strategy.label,
            status: strategy.status,
            createdAt: strategy.createdAt,
            policy: {
                strategist: strategy.policy.strategist,
                feeRecipient: strategy.policy.feeRecipient,
                performanceFeeBps: strategy.policy.performanceFeeBps,
                maxAllocationBps: strategy.policy.maxAllocationBps,
                allowedPools: [...strategy.policy.allowedPools],
                allowOutOfRangeReports: strategy.policy.allowOutOfRangeReports,
            },
            ranges: strategy.ranges.map((range) => ({ ...range })),
            positions: [...strategy.positions],
            accounting: { ...strategy.accounting },
        };
    }
}
