import {
    ASSET_SCALE,
    ZERO,
    abs,
    percentOf,
    ratioBps,
    ratioScaled,
    saturatingSub,
} from "../domain/amount.ts";
import { ensureBps } from "../domain/errors.ts";
import type { AssetAmount, BasisPoints } from "../domain/types.ts";
import { ProtocolLens } from "../reporting/lens.ts";
import { RiskController } from "../risk/riskController.ts";
import { StrategyBook } from "../strategies/strategyBook.ts";
import { AxiomVault } from "../vault/vaultLedger.ts";

export type EconomicRiskFlag =
    | "ACCOUNTING_GAP"
    | "IDLE_BUFFER_LOW"
    | "STRATEGY_CONCENTRATION_HIGH"
    | "STRESS_LOSS_HIGH"
    | "STRATEGY_REPORT_STALE";

export interface StressScenario {
    readonly marketLossBps: BasisPoints;
    readonly liquidityHaircutBps: BasisPoints;
    readonly exitPenaltyShockBps: BasisPoints;
    readonly lossAlertBps: BasisPoints;
    readonly maximumReportAgeMs: number;
}

export interface EconomicRiskSnapshot {
    readonly observedAt: number;
    readonly currentNav: AssetAmount;
    readonly stressedNav: AssetAmount;
    readonly expectedShortfall: AssetAmount;
    readonly expectedShortfallBps: BasisPoints;
    readonly currentPricePerShare: bigint;
    readonly stressedPricePerShare: bigint;
    readonly idleCoverageBps: BasisPoints;
    readonly largestStrategyAllocationBps: BasisPoints;
    readonly accountingGap: AssetAmount;
    readonly marketLoss: AssetAmount;
    readonly liquidityHaircut: AssetAmount;
    readonly exitPenaltyShock: AssetAmount;
    readonly flags: readonly EconomicRiskFlag[];
    readonly healthy: boolean;
}

export const DEFAULT_STRESS_SCENARIO = {
    marketLossBps: 500n,
    liquidityHaircutBps: 250n,
    exitPenaltyShockBps: 100n,
    lossAlertBps: 2_000n,
    maximumReportAgeMs: 86_400_000,
} satisfies StressScenario;

/** Read-only stress and reconciliation model for operations and alerting. */
export class EconomicRiskLens {
    readonly lens: ProtocolLens;
    readonly vault: AxiomVault;
    readonly strategies: StrategyBook;
    readonly risk: RiskController;

    constructor(
        lens: ProtocolLens,
        vault: AxiomVault,
        strategies: StrategyBook,
        risk: RiskController,
    ) {
        this.lens = lens;
        this.vault = vault;
        this.strategies = strategies;
        this.risk = risk;
    }

    evaluate(
        scenario: StressScenario = DEFAULT_STRESS_SCENARIO,
        observedAt = Date.now(),
    ): EconomicRiskSnapshot {
        this.validateScenario(scenario);
        const snapshot = this.lens.snapshot();
        const currentNav = snapshot.vault.totalAssets;
        const managed = snapshot.vault.managedAssets;

        const marketLoss = percentOf(managed, scenario.marketLossBps);
        const afterMarket = saturatingSub(managed, marketLoss);
        const liquidityHaircut = percentOf(afterMarket, scenario.liquidityHaircutBps);
        const afterLiquidity = saturatingSub(afterMarket, liquidityHaircut);
        const exitPenaltyShock = percentOf(afterLiquidity, scenario.exitPenaltyShockBps);
        const stressedManaged = saturatingSub(afterLiquidity, exitPenaltyShock);
        const stressedNav = snapshot.vault.idleAssets + stressedManaged;
        const expectedShortfall = saturatingSub(currentNav, stressedNav);
        const expectedShortfallBps = ratioBps(expectedShortfall, currentNav);
        const idleCoverageBps = ratioBps(snapshot.vault.idleAssets, currentNav);
        const largestStrategyAllocationBps = snapshot.strategies.reduce(
            (largest, strategy) =>
                strategy.allocationBps > largest ? strategy.allocationBps : largest,
            ZERO,
        );
        const accountingGap = abs(managed - this.strategies.totalAccountedValue());
        const flags = this.flags({
            accountingGap,
            idleCoverageBps,
            largestStrategyAllocationBps,
            expectedShortfallBps,
            scenario,
            observedAt,
        });
        const supply = snapshot.vault.totalShares;

        return {
            observedAt,
            currentNav,
            stressedNav,
            expectedShortfall,
            expectedShortfallBps,
            currentPricePerShare: snapshot.vault.pricePerShare,
            stressedPricePerShare:
                supply === ZERO ? ASSET_SCALE : ratioScaled(stressedNav, supply, ASSET_SCALE),
            idleCoverageBps,
            largestStrategyAllocationBps,
            accountingGap,
            marketLoss,
            liquidityHaircut,
            exitPenaltyShock,
            flags,
            healthy: flags.length === 0,
        };
    }

    private flags(input: {
        accountingGap: AssetAmount;
        idleCoverageBps: BasisPoints;
        largestStrategyAllocationBps: BasisPoints;
        expectedShortfallBps: BasisPoints;
        scenario: StressScenario;
        observedAt: number;
    }): EconomicRiskFlag[] {
        const flags: EconomicRiskFlag[] = [];
        const limits = this.risk.limits();
        if (input.accountingGap !== ZERO) flags.push("ACCOUNTING_GAP");
        if (input.idleCoverageBps < this.vault.config.minIdleBps) flags.push("IDLE_BUFFER_LOW");
        if (input.largestStrategyAllocationBps > limits.maxStrategyAllocationBps) {
            flags.push("STRATEGY_CONCENTRATION_HIGH");
        }
        if (input.expectedShortfallBps > input.scenario.lossAlertBps) {
            flags.push("STRESS_LOSS_HIGH");
        }
        if (
            this.strategies
                .list()
                .some(
                    (strategy) =>
                        strategy.accounting.accountedValue > ZERO &&
                        input.observedAt - strategy.accounting.lastReportAt >
                            input.scenario.maximumReportAgeMs,
                )
        ) {
            flags.push("STRATEGY_REPORT_STALE");
        }
        return flags;
    }

    private validateScenario(scenario: StressScenario): void {
        ensureBps("marketLossBps", scenario.marketLossBps);
        ensureBps("liquidityHaircutBps", scenario.liquidityHaircutBps);
        ensureBps("exitPenaltyShockBps", scenario.exitPenaltyShockBps);
        ensureBps("lossAlertBps", scenario.lossAlertBps);
        if (
            !Number.isSafeInteger(scenario.maximumReportAgeMs) ||
            scenario.maximumReportAgeMs <= 0
        ) {
            throw new RangeError("maximumReportAgeMs must be a positive safe integer");
        }
    }
}
