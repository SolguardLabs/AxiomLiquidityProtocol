import { sum } from "../domain/amount.ts";
import { ensureDefined, fail, normalizeId } from "../domain/errors.ts";
import type {
    AggregatePoolQuote,
    PoolConfig,
    PoolId,
    PoolQuote,
    PoolSnapshot,
    PositionId,
    StrategyId,
} from "../domain/types.ts";
import { ExternalPool, type PositionReduction } from "./externalPool.ts";

export class PoolRegistry {
    #pools = new Map<PoolId, ExternalPool>();
    #positionToPool = new Map<PositionId, PoolId>();

    register(config: PoolConfig): ExternalPool {
        const id = normalizeId("pool", config.id);
        if (this.#pools.has(id)) {
            fail("POOL_EXISTS", "pool already registered", { pool: id });
        }
        const pool = new ExternalPool({ ...config, id });
        this.#pools.set(id, pool);
        return pool;
    }

    add(pool: ExternalPool): ExternalPool {
        const id = normalizeId("pool", pool.id());
        if (this.#pools.has(id)) {
            fail("POOL_EXISTS", "pool already registered", { pool: id });
        }
        this.#pools.set(id, pool);
        return pool;
    }

    get(poolId: PoolId): ExternalPool {
        const id = normalizeId("pool", poolId);
        return ensureDefined(this.#pools.get(id), "UNKNOWN_POOL", "pool not found");
    }

    has(poolId: PoolId): boolean {
        return this.#pools.has(normalizeId("pool", poolId));
    }

    pools(): ExternalPool[] {
        return [...this.#pools.values()].sort((a, b) => a.id().localeCompare(b.id()));
    }

    rememberPosition(positionId: PositionId, poolId: PoolId): void {
        this.#positionToPool.set(normalizeId("position", positionId), normalizeId("pool", poolId));
    }

    poolForPosition(positionId: PositionId): ExternalPool {
        const id = normalizeId("position", positionId);
        const poolId = ensureDefined(
            this.#positionToPool.get(id),
            "UNKNOWN_POSITION_POOL",
            "position is not mapped to a pool",
        );
        return this.get(poolId);
    }

    quotePosition(positionId: PositionId): PoolQuote {
        return this.poolForPosition(positionId).quotePosition(positionId);
    }

    reducePosition(positionId: PositionId, amount: bigint): PositionReduction {
        const pool = this.poolForPosition(positionId);
        const result = pool.reducePosition(positionId, amount);
        if (!pool.hasPosition(positionId)) {
            this.#positionToPool.delete(positionId);
        }
        return result;
    }

    quoteStrategy(strategyId: StrategyId, positions: readonly PositionId[]): AggregatePoolQuote {
        const quotes = positions.map((positionId) => this.quotePosition(positionId));
        return {
            strategyId,
            principal: sum(quotes.map((quote) => quote.principal)),
            pendingFees: sum(quotes.map((quote) => quote.pendingFees)),
            temporaryPremium: sum(quotes.map((quote) => quote.temporaryPremium)),
            optimisticValue: sum(quotes.map((quote) => quote.optimisticValue)),
            exitValue: sum(quotes.map((quote) => quote.exitValue)),
            unrealizedLoss: sum(quotes.map((quote) => quote.unrealizedLoss)),
            exitPenalty: sum(quotes.map((quote) => quote.exitPenalty)),
            quotes,
        };
    }

    snapshots(): PoolSnapshot[] {
        return this.pools().map((pool) => pool.snapshot());
    }
}
