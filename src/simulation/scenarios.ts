import { asset, bps } from "../domain/amount.ts";
import type { PerformanceReportResult, ScenarioResult, WithdrawalResult } from "../domain/types.ts";
import { allocatedProtocol, fundedProtocol } from "./fixtures.ts";

export function runDepositScenario(): ScenarioResult {
    const protocol = fundedProtocol();
    return {
        name: "deposits",
        snapshot: protocol.snapshot(),
        reports: [],
        withdrawals: [],
    };
}

export function runAllocationScenario(): ScenarioResult {
    const protocol = allocatedProtocol();
    return {
        name: "allocations",
        snapshot: protocol.snapshot(),
        reports: [],
        withdrawals: [],
    };
}

export function runFeeScenario(): ScenarioResult {
    const protocol = allocatedProtocol();
    const positionIds = protocol.strategies.read("stable-range-alpha").positions;
    for (const positionId of positionIds) {
        const pool = protocol.pools.poolForPosition(positionId);
        pool.accrueFees(positionId, bps(650), 20);
    }
    const report = protocol.report({
        strategyId: "stable-range-alpha",
        timestamp: 21,
        note: "stable venue fee report",
    });
    return {
        name: "fees",
        snapshot: protocol.snapshot(),
        reports: [report],
        withdrawals: [],
    };
}

export function runLossScenario(): ScenarioResult {
    const protocol = allocatedProtocol();
    const [positionId] = protocol.strategies.read("eth-range-beta").positions;
    const pool = protocol.pools.poolForPosition(positionId!);
    pool.recordLoss(positionId!, asset(24_000), 30);
    const report = protocol.report({
        strategyId: "eth-range-beta",
        timestamp: 31,
        note: "range inventory update",
    });
    return {
        name: "losses",
        snapshot: protocol.snapshot(),
        reports: [report],
        withdrawals: [],
    };
}

export function runWithdrawalScenario(): ScenarioResult {
    const protocol = allocatedProtocol();
    const reports: PerformanceReportResult[] = [];
    const withdrawals: WithdrawalResult[] = [];
    const positionIds = protocol.strategies.read("stable-range-alpha").positions;
    for (const positionId of positionIds) {
        protocol.pools.poolForPosition(positionId).accrueFees(positionId, bps(250), 40);
    }
    reports.push(
        protocol.report({
            strategyId: "stable-range-alpha",
            timestamp: 41,
            note: "pre-withdrawal report",
        }),
    );
    withdrawals.push(
        protocol.withdraw({
            account: "bob",
            shares: protocol.vault.balanceOf("bob") / 2n,
            timestamp: 42,
        }),
    );
    return {
        name: "withdrawals",
        snapshot: protocol.snapshot(),
        reports,
        withdrawals,
    };
}

export function runScenario(name: string): ScenarioResult {
    switch (name) {
        case "deposits":
            return runDepositScenario();
        case "allocations":
            return runAllocationScenario();
        case "fees":
            return runFeeScenario();
        case "losses":
            return runLossScenario();
        case "withdrawals":
            return runWithdrawalScenario();
        default:
            throw new Error(`unknown scenario: ${name}`);
    }
}

export const scenarioNames = ["deposits", "allocations", "fees", "losses", "withdrawals"] as const;
