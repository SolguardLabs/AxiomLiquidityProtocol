import type { AssetAmount, BasisPoints, ShareAmount } from "./amount.ts";

export type { AssetAmount, BasisPoints, ShareAmount } from "./amount.ts";

export type AccountId = string;
export type StrategyId = string;
export type PoolId = string;
export type PositionId = string;
export type RangeId = string;
export type AssetSymbol = string;

export type StrategyStatus = "draft" | "active" | "paused" | "retired";
export type PoolKind = "concentrated" | "stableswap" | "weighted";
export type RebalanceMode = "append" | "replace" | "recall";
export type WithdrawalSource = "idle" | "managed" | "mixed";

export interface AccountProfile {
    readonly id: AccountId;
    readonly label: string;
    readonly createdAt: number;
    readonly metadata: Record<string, string>;
}

export interface VaultConfig {
    readonly asset: AssetSymbol;
    readonly name: string;
    readonly shareSymbol: string;
    readonly performanceFeeBps: BasisPoints;
    readonly minInitialDeposit: AssetAmount;
    readonly minIdleBps: BasisPoints;
    readonly maxWithdrawalBps: BasisPoints;
}

export interface RiskLimits {
    readonly maxStrategyAllocationBps: BasisPoints;
    readonly maxPoolAllocationBps: BasisPoints;
    readonly maxRangeWidthBps: BasisPoints;
    readonly maxReportLossBps: BasisPoints;
    readonly maxStrategistFeeBps: BasisPoints;
    readonly minRangeLiquidity: AssetAmount;
    readonly maxOpenPositionsPerStrategy: number;
    readonly maxPoolExitPenaltyBps: BasisPoints;
}

export interface RangeSpec {
    readonly id: RangeId;
    readonly lowerTick: bigint;
    readonly upperTick: bigint;
    readonly targetWeightBps: BasisPoints;
    readonly minPrice: bigint;
    readonly maxPrice: bigint;
}

export interface RangeHealth {
    readonly rangeId: RangeId;
    readonly currentPrice: bigint;
    readonly inRange: boolean;
    readonly widthBps: BasisPoints;
    readonly distanceBps: BasisPoints;
}

export interface PoolConfig {
    readonly id: PoolId;
    readonly kind: PoolKind;
    readonly asset: AssetSymbol;
    readonly quoteAsset: AssetSymbol;
    readonly feeTierBps: BasisPoints;
    readonly basePrice: bigint;
    readonly liquidityDepth: AssetAmount;
    readonly exitPenaltyBps: BasisPoints;
}

export interface PoolMarketState {
    readonly price: bigint;
    readonly volatilityBps: BasisPoints;
    readonly liquidityIndexBps: BasisPoints;
    readonly temporaryPremiumBps: BasisPoints;
    readonly exitPenaltyBps: BasisPoints;
    readonly updatedAt: number;
}

export interface PoolPosition {
    readonly id: PositionId;
    readonly poolId: PoolId;
    readonly strategyId: StrategyId;
    readonly range: RangeSpec;
    readonly openedAt: number;
    readonly updatedAt: number;
    readonly principal: AssetAmount;
    readonly pendingFees: AssetAmount;
    readonly temporaryPremium: AssetAmount;
    readonly unrealizedLoss: AssetAmount;
    readonly realizedLoss: AssetAmount;
    readonly realizedFees: AssetAmount;
}

export interface PoolQuote {
    readonly poolId: PoolId;
    readonly positionId: PositionId;
    readonly strategyId: StrategyId;
    readonly principal: AssetAmount;
    readonly pendingFees: AssetAmount;
    readonly temporaryPremium: AssetAmount;
    readonly optimisticValue: AssetAmount;
    readonly exitValue: AssetAmount;
    readonly unrealizedLoss: AssetAmount;
    readonly exitPenalty: AssetAmount;
    readonly inRange: boolean;
    readonly price: bigint;
    readonly rangeWidthBps: BasisPoints;
}

export interface AggregatePoolQuote {
    readonly strategyId: StrategyId;
    readonly principal: AssetAmount;
    readonly pendingFees: AssetAmount;
    readonly temporaryPremium: AssetAmount;
    readonly optimisticValue: AssetAmount;
    readonly exitValue: AssetAmount;
    readonly unrealizedLoss: AssetAmount;
    readonly exitPenalty: AssetAmount;
    readonly quotes: readonly PoolQuote[];
}

export interface StrategyAccounting {
    readonly principal: AssetAmount;
    readonly accountedValue: AssetAmount;
    readonly highWatermark: AssetAmount;
    readonly cumulativeFees: AssetAmount;
    readonly cumulativeLosses: AssetAmount;
    readonly cumulativeWithdrawals: AssetAmount;
    readonly lastReportAt: number;
}

export interface StrategyPolicy {
    readonly strategist: AccountId;
    readonly feeRecipient: AccountId;
    readonly performanceFeeBps: BasisPoints;
    readonly maxAllocationBps: BasisPoints;
    readonly allowedPools: readonly PoolId[];
    readonly allowOutOfRangeReports: boolean;
}

export interface StrategyState {
    readonly id: StrategyId;
    readonly label: string;
    readonly status: StrategyStatus;
    readonly createdAt: number;
    readonly policy: StrategyPolicy;
    readonly ranges: readonly RangeSpec[];
    readonly positions: readonly PositionId[];
    readonly accounting: StrategyAccounting;
}

export interface StrategyDraft {
    readonly id: StrategyId;
    readonly label: string;
    readonly strategist: AccountId;
    readonly feeRecipient?: AccountId;
    readonly performanceFeeBps?: BasisPoints;
    readonly maxAllocationBps?: BasisPoints;
    readonly allowedPools?: readonly PoolId[];
    readonly ranges?: readonly RangeSpec[];
    readonly allowOutOfRangeReports?: boolean;
    readonly createdAt?: number;
}

export interface AllocationRequest {
    readonly strategyId: StrategyId;
    readonly poolId: PoolId;
    readonly rangeId?: RangeId;
    readonly amount: AssetAmount;
    readonly mode?: RebalanceMode;
    readonly timestamp?: number;
}

export interface AllocationResult {
    readonly strategyId: StrategyId;
    readonly poolId: PoolId;
    readonly positionId: PositionId;
    readonly amount: AssetAmount;
    readonly accountedValue: AssetAmount;
    readonly idleAfter: AssetAmount;
    readonly managedAfter: AssetAmount;
}

export interface RecallRequest {
    readonly strategyId?: StrategyId;
    readonly amount: AssetAmount;
    readonly timestamp?: number;
}

export interface RecallResult {
    readonly requested: AssetAmount;
    readonly accountedReduction: AssetAmount;
    readonly returnedAssets: AssetAmount;
    readonly source: WithdrawalSource;
    readonly strategyIds: readonly StrategyId[];
}

export interface PerformanceReportRequest {
    readonly strategyId: StrategyId;
    readonly timestamp?: number;
    readonly note?: string;
    readonly reportedValue?: AssetAmount;
}

export interface PerformanceReportResult {
    readonly strategyId: StrategyId;
    readonly previousValue: AssetAmount;
    readonly reportedValue: AssetAmount;
    readonly adjustedValue: AssetAmount;
    readonly grossGain: AssetAmount;
    readonly realizedLoss: AssetAmount;
    readonly feeAssets: AssetAmount;
    readonly feeShares: ShareAmount;
    readonly totalAssetsAfter: AssetAmount;
    readonly shareSupplyAfter: ShareAmount;
    readonly quotes: readonly PoolQuote[];
}

export interface DepositResult {
    readonly account: AccountId;
    readonly assets: AssetAmount;
    readonly shares: ShareAmount;
    readonly totalAssets: AssetAmount;
    readonly totalShares: ShareAmount;
}

export interface WithdrawalRequest {
    readonly account: AccountId;
    readonly shares: ShareAmount;
    readonly timestamp?: number;
}

export interface WithdrawalResult {
    readonly account: AccountId;
    readonly requestedShares: ShareAmount;
    readonly burnedShares: ShareAmount;
    readonly assetsOut: AssetAmount;
    readonly source: WithdrawalSource;
    readonly totalAssets: AssetAmount;
    readonly totalShares: ShareAmount;
}

export interface ShareSnapshot {
    readonly account: AccountId;
    readonly shares: ShareAmount;
    readonly assets: AssetAmount;
    readonly shareBps: BasisPoints;
}

export interface VaultSnapshot {
    readonly asset: AssetSymbol;
    readonly idleAssets: AssetAmount;
    readonly managedAssets: AssetAmount;
    readonly totalAssets: AssetAmount;
    readonly totalShares: ShareAmount;
    readonly pricePerShare: bigint;
    readonly accounts: readonly ShareSnapshot[];
}

export interface StrategySnapshot {
    readonly id: StrategyId;
    readonly label: string;
    readonly status: StrategyStatus;
    readonly strategist: AccountId;
    readonly positions: number;
    readonly principal: AssetAmount;
    readonly accountedValue: AssetAmount;
    readonly highWatermark: AssetAmount;
    readonly cumulativeFees: AssetAmount;
    readonly cumulativeLosses: AssetAmount;
    readonly allocationBps: BasisPoints;
}

export interface PoolSnapshot {
    readonly id: PoolId;
    readonly kind: PoolKind;
    readonly price: bigint;
    readonly liquidityDepth: AssetAmount;
    readonly totalPrincipal: AssetAmount;
    readonly totalPendingFees: AssetAmount;
    readonly totalUnrealizedLoss: AssetAmount;
    readonly openPositions: number;
}

export interface ProtocolSnapshot {
    readonly vault: VaultSnapshot;
    readonly strategies: readonly StrategySnapshot[];
    readonly pools: readonly PoolSnapshot[];
    readonly events: number;
}

export interface ScenarioResult {
    readonly name: string;
    readonly snapshot: ProtocolSnapshot;
    readonly reports: readonly PerformanceReportResult[];
    readonly withdrawals: readonly WithdrawalResult[];
}
