import { asset, bps } from "../domain/amount.ts";
import type { PoolConfig, RiskLimits, StrategyDraft, VaultConfig } from "../domain/types.ts";
import { createRange } from "../adapters/range.ts";
import { AxiomProtocol } from "../axiomProtocol.ts";

export const defaultVaultConfig = {
    asset: "USDC",
    name: "Axiom Managed Liquidity Vault",
    shareSymbol: "axUSDC",
    performanceFeeBps: bps(1_500),
    strategistReserveBps: bps(500),
    minInitialDeposit: asset(1_000),
    minIdleBps: bps(500),
    maxWithdrawalBps: bps(7_500),
} satisfies VaultConfig;

export const defaultRiskLimits = {
    maxStrategyAllocationBps: bps(8_500),
    maxPoolAllocationBps: bps(7_500),
    maxRangeWidthBps: bps(4_000),
    maxReportLossBps: bps(4_500),
    maxStrategistFeeBps: bps(2_000),
    minRangeLiquidity: asset(500),
    maxOpenPositionsPerStrategy: 12,
    maxPoolExitPenaltyBps: bps(500),
} satisfies RiskLimits;

export const defaultPools = [
    {
        id: "curve-usdc-usdt",
        kind: "stableswap",
        asset: "USDC",
        quoteAsset: "USDT",
        feeTierBps: bps(4),
        basePrice: 1_000_000n,
        liquidityDepth: asset(8_000_000),
        exitPenaltyBps: bps(20),
    },
    {
        id: "axiom-eth-usdc",
        kind: "concentrated",
        asset: "USDC",
        quoteAsset: "WETH",
        feeTierBps: bps(30),
        basePrice: 2_500_000_000n,
        liquidityDepth: asset(12_000_000),
        exitPenaltyBps: bps(35),
    },
    {
        id: "aurora-usdc-dai",
        kind: "weighted",
        asset: "USDC",
        quoteAsset: "DAI",
        feeTierBps: bps(10),
        basePrice: 1_000_000n,
        liquidityDepth: asset(5_000_000),
        exitPenaltyBps: bps(15),
    },
] satisfies PoolConfig[];

export function stableStrategyDraft(): StrategyDraft {
    return {
        id: "stable-range-alpha",
        label: "Stable range alpha",
        strategist: "strategist-alpha",
        feeRecipient: "strategist-alpha",
        performanceFeeBps: bps(1_500),
        maxAllocationBps: bps(6_000),
        allowedPools: ["curve-usdc-usdt", "aurora-usdc-dai"],
        ranges: [
            createRange({
                id: "stable-tight",
                lowerTick: 990_000n,
                upperTick: 1_010_000n,
                targetWeightBps: bps(6_000),
            }),
            createRange({
                id: "stable-wide",
                lowerTick: 970_000n,
                upperTick: 1_030_000n,
                targetWeightBps: bps(4_000),
            }),
        ],
    };
}

export function ethStrategyDraft(): StrategyDraft {
    return {
        id: "eth-range-beta",
        label: "ETH directional range beta",
        strategist: "strategist-beta",
        feeRecipient: "strategist-beta",
        performanceFeeBps: bps(1_200),
        maxAllocationBps: bps(4_000),
        allowedPools: ["axiom-eth-usdc"],
        allowOutOfRangeReports: true,
        ranges: [
            createRange({
                id: "eth-core",
                lowerTick: 2_250_000_000n,
                upperTick: 2_850_000_000n,
                targetWeightBps: bps(10_000),
            }),
        ],
    };
}

export function createDefaultProtocol(): AxiomProtocol {
    const protocol = new AxiomProtocol({
        vault: defaultVaultConfig,
        risk: defaultRiskLimits,
    });
    protocol.seedAccount("alice", asset(1_000_000), "Alice Treasury");
    protocol.seedAccount("bob", asset(650_000), "Bob LP");
    protocol.seedAccount("carol", asset(450_000), "Carol LP");
    protocol.seedAccount("strategist-alpha", asset(10_000), "Stable Strategist");
    protocol.seedAccount("strategist-beta", asset(10_000), "Directional Strategist");
    for (const pool of defaultPools) {
        protocol.registerPool(pool);
    }
    protocol.createStrategy(stableStrategyDraft());
    protocol.createStrategy(ethStrategyDraft());
    return protocol;
}

export function fundedProtocol(): AxiomProtocol {
    const protocol = createDefaultProtocol();
    protocol.deposit("alice", asset(400_000), 1);
    protocol.deposit("bob", asset(250_000), 2);
    protocol.deposit("carol", asset(150_000), 3);
    return protocol;
}

export function allocatedProtocol(): AxiomProtocol {
    const protocol = fundedProtocol();
    protocol.allocate({
        strategyId: "stable-range-alpha",
        poolId: "curve-usdc-usdt",
        rangeId: "stable-tight",
        amount: asset(260_000),
        timestamp: 10,
    });
    protocol.allocate({
        strategyId: "stable-range-alpha",
        poolId: "aurora-usdc-dai",
        rangeId: "stable-wide",
        amount: asset(120_000),
        timestamp: 11,
    });
    protocol.allocate({
        strategyId: "eth-range-beta",
        poolId: "axiom-eth-usdc",
        rangeId: "eth-core",
        amount: asset(160_000),
        timestamp: 12,
    });
    return protocol;
}
