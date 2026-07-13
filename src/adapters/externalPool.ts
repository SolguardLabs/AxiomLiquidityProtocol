import {
    BPS,
    ZERO,
    min,
    mulDivDown,
    percentOf,
    ratioBps,
    saturatingSub,
    sum,
} from "../domain/amount.ts";
import { ensureAmount, ensureBps, ensureDefined, fail, normalizeId } from "../domain/errors.ts";
import type {
    AssetAmount,
    BasisPoints,
    PoolConfig,
    PoolId,
    PoolMarketState,
    PoolPosition,
    PoolQuote,
    PoolSnapshot,
    PositionId,
    RangeSpec,
    StrategyId,
} from "../domain/types.ts";
import { inRange, widthBps } from "./range.ts";

export interface PositionOpenRequest {
    readonly strategyId: StrategyId;
    readonly range: RangeSpec;
    readonly amount: AssetAmount;
    readonly timestamp?: number;
}

export interface PositionReduction {
    readonly positionId: PositionId;
    readonly accountedReduction: AssetAmount;
    readonly assetsReturned: AssetAmount;
    readonly principalReduced: AssetAmount;
    readonly feesRealized: AssetAmount;
    readonly lossRealized: AssetAmount;
}

export interface PoolTotals {
    readonly principal: AssetAmount;
    readonly pendingFees: AssetAmount;
    readonly temporaryPremium: AssetAmount;
    readonly unrealizedLoss: AssetAmount;
    readonly optimisticValue: AssetAmount;
    readonly exitValue: AssetAmount;
}

interface MutablePosition {
    id: PositionId;
    poolId: PoolId;
    strategyId: StrategyId;
    range: RangeSpec;
    openedAt: number;
    updatedAt: number;
    principal: AssetAmount;
    pendingFees: AssetAmount;
    temporaryPremium: AssetAmount;
    unrealizedLoss: AssetAmount;
    realizedLoss: AssetAmount;
    realizedFees: AssetAmount;
}

export class ExternalPool {
    readonly config: PoolConfig;
    #market: PoolMarketState;
    #positions = new Map<PositionId, MutablePosition>();
    #sequence = 1;

    constructor(config: PoolConfig, market?: Partial<PoolMarketState>) {
        ensureBps("feeTierBps", config.feeTierBps);
        ensureBps("exitPenaltyBps", config.exitPenaltyBps);
        this.config = { ...config };
        this.#market = {
            price: market?.price ?? config.basePrice,
            volatilityBps: market?.volatilityBps ?? 0n,
            liquidityIndexBps: market?.liquidityIndexBps ?? BPS,
            temporaryPremiumBps: market?.temporaryPremiumBps ?? 0n,
            exitPenaltyBps: market?.exitPenaltyBps ?? config.exitPenaltyBps,
            updatedAt: market?.updatedAt ?? Date.now(),
        };
    }

    id(): PoolId {
        return this.config.id;
    }

    market(): PoolMarketState {
        return { ...this.#market };
    }

    updateMarket(update: Partial<PoolMarketState>): PoolMarketState {
        if (update.volatilityBps !== undefined) {
            ensureBps("volatilityBps", update.volatilityBps);
        }
        if (update.liquidityIndexBps !== undefined) {
            ensureBps("liquidityIndexBps", update.liquidityIndexBps);
        }
        if (update.temporaryPremiumBps !== undefined) {
            ensureBps("temporaryPremiumBps", update.temporaryPremiumBps);
        }
        if (update.exitPenaltyBps !== undefined) {
            ensureBps("exitPenaltyBps", update.exitPenaltyBps);
        }
        this.#market = {
            ...this.#market,
            ...update,
            updatedAt: update.updatedAt ?? Date.now(),
        };
        return this.market();
    }

    openPosition(request: PositionOpenRequest): PoolPosition {
        ensureAmount("amount", request.amount);
        const strategyId = normalizeId("strategy", request.strategyId);
        const id = `${this.config.id}:pos:${this.#sequence}`;
        this.#sequence += 1;
        const now = request.timestamp ?? Date.now();
        const position = {
            id,
            poolId: this.config.id,
            strategyId,
            range: request.range,
            openedAt: now,
            updatedAt: now,
            principal: request.amount,
            pendingFees: ZERO,
            temporaryPremium: percentOf(request.amount, this.#market.temporaryPremiumBps),
            unrealizedLoss: ZERO,
            realizedLoss: ZERO,
            realizedFees: ZERO,
        } satisfies MutablePosition;
        this.#positions.set(id, position);
        return this.readPosition(id);
    }

    increasePosition(
        positionId: PositionId,
        amount: AssetAmount,
        timestamp = Date.now(),
    ): PoolPosition {
        const position = this.mutable(positionId);
        ensureAmount("amount", amount);
        position.principal += amount;
        position.temporaryPremium += percentOf(amount, this.#market.temporaryPremiumBps);
        position.updatedAt = timestamp;
        return this.readPosition(positionId);
    }

    accrueFees(positionId: PositionId, feeBps: BasisPoints, timestamp = Date.now()): PoolPosition {
        ensureBps("feeBps", feeBps);
        const position = this.mutable(positionId);
        const base = position.principal + position.pendingFees;
        const accrued = percentOf(base, feeBps);
        position.pendingFees += accrued;
        position.updatedAt = timestamp;
        return this.readPosition(positionId);
    }

    accrueFeesForStrategy(
        strategyId: StrategyId,
        feeBps: BasisPoints,
        timestamp = Date.now(),
    ): PoolPosition[] {
        return this.positionsForStrategy(strategyId).map((position) =>
            this.accrueFees(position.id, feeBps, timestamp),
        );
    }

    addTemporaryPremium(
        positionId: PositionId,
        premiumBps: BasisPoints,
        timestamp = Date.now(),
    ): PoolPosition {
        ensureBps("premiumBps", premiumBps);
        const position = this.mutable(positionId);
        position.temporaryPremium += percentOf(position.principal, premiumBps);
        position.updatedAt = timestamp;
        return this.readPosition(positionId);
    }

    recordLoss(positionId: PositionId, amount: AssetAmount, timestamp = Date.now()): PoolPosition {
        ensureAmount("amount", amount);
        const position = this.mutable(positionId);
        const ceiling = position.principal + position.pendingFees + position.temporaryPremium;
        position.unrealizedLoss = min(position.unrealizedLoss + amount, ceiling);
        position.updatedAt = timestamp;
        return this.readPosition(positionId);
    }

    reducePosition(
        positionId: PositionId,
        accountedReduction: AssetAmount,
        timestamp = Date.now(),
    ): PositionReduction {
        ensureAmount("accountedReduction", accountedReduction);
        const position = this.mutable(positionId);
        const quote = this.quotePosition(positionId);
        const reduction = min(accountedReduction, quote.optimisticValue);
        const numerator = quote.optimisticValue === ZERO ? ZERO : reduction;
        const principalReduced =
            quote.optimisticValue === ZERO
                ? position.principal
                : mulDivDown(position.principal, numerator, quote.optimisticValue);
        const feesRealized =
            quote.optimisticValue === ZERO
                ? ZERO
                : mulDivDown(position.pendingFees, numerator, quote.optimisticValue);
        const premiumReduced =
            quote.optimisticValue === ZERO
                ? ZERO
                : mulDivDown(position.temporaryPremium, numerator, quote.optimisticValue);
        const lossRealized =
            quote.optimisticValue === ZERO
                ? ZERO
                : mulDivDown(position.unrealizedLoss, numerator, quote.optimisticValue);
        const penaltyRealized =
            quote.optimisticValue === ZERO
                ? ZERO
                : mulDivDown(quote.exitPenalty, numerator, quote.optimisticValue);
        const grossReturned = principalReduced + feesRealized + premiumReduced;
        const assetsReturned = saturatingSub(grossReturned, lossRealized + penaltyRealized);

        position.principal = saturatingSub(position.principal, principalReduced);
        position.pendingFees = saturatingSub(position.pendingFees, feesRealized);
        position.temporaryPremium = saturatingSub(position.temporaryPremium, premiumReduced);
        position.unrealizedLoss = saturatingSub(position.unrealizedLoss, lossRealized);
        position.realizedFees += feesRealized;
        position.realizedLoss += lossRealized + penaltyRealized;
        position.updatedAt = timestamp;

        if (
            position.principal === ZERO &&
            position.pendingFees === ZERO &&
            position.temporaryPremium === ZERO
        ) {
            this.#positions.delete(positionId);
        }

        return {
            positionId,
            accountedReduction: reduction,
            assetsReturned,
            principalReduced,
            feesRealized,
            lossRealized: lossRealized + penaltyRealized,
        };
    }

    quotePosition(positionId: PositionId): PoolQuote {
        const position = this.mutable(positionId);
        const optimisticBeforePenalty =
            position.principal + position.pendingFees + position.temporaryPremium;
        const rangeActive = inRange(position.range, this.#market.price);
        const rangePenalty = rangeActive ? ZERO : this.outOfRangePenalty(position);
        const exitPenalty =
            percentOf(optimisticBeforePenalty, this.#market.exitPenaltyBps) + rangePenalty;
        const totalDeductions = position.unrealizedLoss + exitPenalty;
        const exitValue = saturatingSub(optimisticBeforePenalty, totalDeductions);
        return {
            poolId: this.config.id,
            positionId,
            strategyId: position.strategyId,
            principal: position.principal,
            pendingFees: position.pendingFees,
            temporaryPremium: position.temporaryPremium,
            optimisticValue: optimisticBeforePenalty,
            exitValue,
            unrealizedLoss: position.unrealizedLoss,
            exitPenalty,
            inRange: rangeActive,
            price: this.#market.price,
            rangeWidthBps: widthBps(position.range),
        };
    }

    quoteStrategy(strategyId: StrategyId): PoolQuote[] {
        const id = normalizeId("strategy", strategyId);
        return [...this.#positions.values()]
            .filter((position) => position.strategyId === id)
            .map((position) => this.quotePosition(position.id));
    }

    positionsForStrategy(strategyId: StrategyId): PoolPosition[] {
        const id = normalizeId("strategy", strategyId);
        return [...this.#positions.values()]
            .filter((position) => position.strategyId === id)
            .map((position) => this.copy(position));
    }

    positions(): PoolPosition[] {
        return [...this.#positions.values()].map((position) => this.copy(position));
    }

    totals(): PoolTotals {
        const quotes = [...this.#positions.keys()].map((id) => this.quotePosition(id));
        return {
            principal: sum(quotes.map((quote) => quote.principal)),
            pendingFees: sum(quotes.map((quote) => quote.pendingFees)),
            temporaryPremium: sum(quotes.map((quote) => quote.temporaryPremium)),
            unrealizedLoss: sum(quotes.map((quote) => quote.unrealizedLoss)),
            optimisticValue: sum(quotes.map((quote) => quote.optimisticValue)),
            exitValue: sum(quotes.map((quote) => quote.exitValue)),
        };
    }

    snapshot(): PoolSnapshot {
        const totals = this.totals();
        return {
            id: this.config.id,
            kind: this.config.kind,
            price: this.#market.price,
            liquidityDepth: this.config.liquidityDepth,
            totalPrincipal: totals.principal,
            totalPendingFees: totals.pendingFees,
            totalUnrealizedLoss: totals.unrealizedLoss,
            openPositions: this.#positions.size,
        };
    }

    readPosition(positionId: PositionId): PoolPosition {
        return this.copy(this.mutable(positionId));
    }

    hasPosition(positionId: PositionId): boolean {
        return this.#positions.has(positionId);
    }

    private mutable(positionId: PositionId): MutablePosition {
        const id = normalizeId("position", positionId);
        return ensureDefined(
            this.#positions.get(id),
            "UNKNOWN_POSITION",
            "pool position not found",
        );
    }

    private copy(position: MutablePosition): PoolPosition {
        return {
            id: position.id,
            poolId: position.poolId,
            strategyId: position.strategyId,
            range: position.range,
            openedAt: position.openedAt,
            updatedAt: position.updatedAt,
            principal: position.principal,
            pendingFees: position.pendingFees,
            temporaryPremium: position.temporaryPremium,
            unrealizedLoss: position.unrealizedLoss,
            realizedLoss: position.realizedLoss,
            realizedFees: position.realizedFees,
        };
    }

    private outOfRangePenalty(position: MutablePosition): AssetAmount {
        const price = this.#market.price;
        const range = position.range;
        let distance = ZERO;
        if (price < range.lowerTick) {
            distance = ratioBps(range.lowerTick - price, range.lowerTick);
        } else if (price > range.upperTick) {
            distance = ratioBps(price - range.upperTick, price);
        }
        const bounded = distance > 2_500n ? 2_500n : distance;
        return percentOf(position.principal + position.pendingFees, bounded / 2n);
    }
}
