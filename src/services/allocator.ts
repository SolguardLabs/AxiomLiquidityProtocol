import { ZERO, min, sum } from "../domain/amount.ts";
import { ensureAmount, fail } from "../domain/errors.ts";
import { EventLog } from "../domain/events.ts";
import type {
    AllocationRequest,
    AllocationResult,
    AssetAmount,
    PositionId,
    RecallRequest,
    RecallResult,
    StrategyId,
    WithdrawalSource,
} from "../domain/types.ts";
import { PoolRegistry } from "../adapters/poolRegistry.ts";
import { RiskController } from "../risk/riskController.ts";
import { StrategyBook } from "../strategies/strategyBook.ts";
import { AxiomVault } from "../vault/vaultLedger.ts";

export class AxiomAllocator {
    readonly vault: AxiomVault;
    readonly strategies: StrategyBook;
    readonly pools: PoolRegistry;
    readonly risk: RiskController;
    readonly events: EventLog;

    constructor(input: {
        vault: AxiomVault;
        strategies: StrategyBook;
        pools: PoolRegistry;
        risk: RiskController;
        events: EventLog;
    }) {
        this.vault = input.vault;
        this.strategies = input.strategies;
        this.pools = input.pools;
        this.risk = input.risk;
        this.events = input.events;
    }

    allocate(request: AllocationRequest): AllocationResult {
        const strategy = this.strategies.read(request.strategyId);
        const pool = this.pools.get(request.poolId);
        const range = this.strategies.selectRange(request.strategyId, request.rangeId);
        this.risk.validateRange(range);
        this.risk.validateAllocation(request, strategy, this.vault.snapshot(), pool.config);
        this.vault.moveIdleToManaged(request.amount);
        const position = pool.openPosition({
            strategyId: request.strategyId,
            range,
            amount: request.amount,
            timestamp: request.timestamp,
        });
        this.pools.rememberPosition(position.id, request.poolId);
        this.strategies.registerPosition({
            strategyId: request.strategyId,
            positionId: position.id,
            poolId: request.poolId,
            amount: request.amount,
            accountedValue: request.amount,
        });
        this.events.emit("strategy.allocated", {
            strategyId: request.strategyId,
            poolId: request.poolId,
            positionId: position.id,
            amount: request.amount,
            idleAfter: this.vault.idleAssets(),
            managedAfter: this.vault.managedAssets(),
            timestamp: request.timestamp ?? Date.now(),
        });
        return {
            strategyId: request.strategyId,
            poolId: request.poolId,
            positionId: position.id,
            amount: request.amount,
            accountedValue: request.amount,
            idleAfter: this.vault.idleAssets(),
            managedAfter: this.vault.managedAssets(),
        };
    }

    recall(request: RecallRequest): RecallResult {
        ensureAmount("amount", request.amount);
        const candidates =
            request.strategyId === undefined
                ? this.strategies
                      .list()
                      .filter((strategy) => strategy.accounting.accountedValue > ZERO)
                : [this.strategies.read(request.strategyId)];
        let remaining = request.amount;
        let accountedReduction = ZERO;
        let returnedAssets = ZERO;
        const touched = new Set<StrategyId>();

        for (const strategy of candidates) {
            if (remaining === ZERO) {
                break;
            }
            const reducible = min(strategy.accounting.accountedValue, remaining);
            if (reducible === ZERO) {
                continue;
            }
            const result = this.recallFromStrategy(strategy.id, reducible, request.timestamp);
            accountedReduction += result.accountedReduction;
            returnedAssets += result.returnedAssets;
            remaining =
                remaining > result.accountedReduction
                    ? remaining - result.accountedReduction
                    : ZERO;
            for (const id of result.strategyIds) {
                touched.add(id);
            }
        }

        if (accountedReduction === ZERO) {
            fail("NO_MANAGED_LIQUIDITY", "no managed liquidity available for recall", {
                requested: request.amount,
            });
        }

        return {
            requested: request.amount,
            accountedReduction,
            returnedAssets,
            source: this.classifyRecall(returnedAssets, accountedReduction),
            strategyIds: [...touched].sort(),
        };
    }

    recallFromStrategy(
        strategyId: StrategyId,
        amount: AssetAmount,
        timestamp = Date.now(),
    ): RecallResult {
        ensureAmount("amount", amount);
        const strategy = this.strategies.read(strategyId);
        const positions = [...strategy.positions];
        if (positions.length === 0) {
            fail("NO_POSITIONS", "strategy has no open positions", { strategy: strategyId });
        }
        const quote = this.pools.quoteStrategy(strategyId, positions);
        const target = min(amount, strategy.accounting.accountedValue);
        const weights = positions.map(
            (positionId) => this.pools.quotePosition(positionId).optimisticValue,
        );
        const reductions = this.distributeReduction(target, weights);
        let accountedReduction = ZERO;
        let returnedAssets = ZERO;
        const stillLive: PositionId[] = [];

        for (let i = 0; i < positions.length; i += 1) {
            const positionId = positions[i]!;
            const reduction = reductions[i] ?? ZERO;
            if (reduction === ZERO) {
                stillLive.push(positionId);
                continue;
            }
            const pool = this.pools.poolForPosition(positionId);
            const result = this.pools.reducePosition(positionId, reduction);
            accountedReduction += result.accountedReduction;
            returnedAssets += result.assetsReturned;
            if (pool.hasPosition(positionId)) {
                stillLive.push(positionId);
            }
            this.events.emit("pool.position-reduced", {
                positionId,
                strategyId,
                accountedReduction: result.accountedReduction,
                assetsReturned: result.assetsReturned,
                lossRealized: result.lossRealized,
                timestamp,
            });
        }

        if (accountedReduction === ZERO && quote.optimisticValue > ZERO) {
            fail("ZERO_RECALL", "recall did not reduce any position", {
                strategy: strategyId,
                amount,
            });
        }

        this.vault.completeRecall(accountedReduction, returnedAssets);
        this.strategies.reduceForRecall(strategyId, accountedReduction, returnedAssets, timestamp);
        this.strategies.removeClosedPositions(strategyId, stillLive);
        this.events.emit("strategy.recalled", {
            strategyId,
            requested: amount,
            accountedReduction,
            returnedAssets,
            managedAfter: this.vault.managedAssets(),
            idleAfter: this.vault.idleAssets(),
            timestamp,
        });
        return {
            requested: amount,
            accountedReduction,
            returnedAssets,
            source: this.classifyRecall(returnedAssets, accountedReduction),
            strategyIds: [strategyId],
        };
    }

    recallToIdle(targetIdle: AssetAmount, timestamp = Date.now()): RecallResult | undefined {
        if (this.vault.idleAssets() >= targetIdle) {
            return undefined;
        }
        const missing = targetIdle - this.vault.idleAssets();
        return this.recall({ amount: missing, timestamp });
    }

    private distributeReduction(
        amount: AssetAmount,
        weights: readonly AssetAmount[],
    ): AssetAmount[] {
        const total = sum(weights);
        if (total === ZERO) {
            return weights.map(() => ZERO);
        }
        const reductions: AssetAmount[] = [];
        let used = ZERO;
        for (let i = 0; i < weights.length; i += 1) {
            if (i === weights.length - 1) {
                reductions.push(amount - used);
                break;
            }
            const piece = (amount * weights[i]!) / total;
            reductions.push(piece);
            used += piece;
        }
        return reductions;
    }

    private classifyRecall(
        returnedAssets: AssetAmount,
        accountedReduction: AssetAmount,
    ): WithdrawalSource {
        if (returnedAssets >= accountedReduction) {
            return "managed";
        }
        return "mixed";
    }
}
