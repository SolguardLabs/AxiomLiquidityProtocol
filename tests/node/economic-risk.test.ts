import assert from "node:assert/strict";
import test from "node:test";

import { asset, bps } from "../../src/domain/amount.ts";
import { DEFAULT_STRESS_SCENARIO } from "../../src/monitoring/economicRiskLens.ts";
import { allocatedProtocol } from "../../src/simulation/fixtures.ts";

test("economic risk snapshots reconcile the stress waterfall", () => {
    const protocol = allocatedProtocol();
    const report = protocol.economicRisk.evaluate(DEFAULT_STRESS_SCENARIO, 100);

    assert.equal(report.accountingGap, 0n);
    assert.ok(report.currentNav > report.stressedNav);
    assert.equal(report.currentNav - report.stressedNav, report.expectedShortfall);
    assert.equal(
        report.marketLoss + report.liquidityHaircut + report.exitPenaltyShock,
        report.expectedShortfall,
    );
    assert.ok(report.currentPricePerShare > report.stressedPricePerShare);
    assert.equal(report.healthy, true);
});

test("stress limits emit deterministic operational flags", () => {
    const protocol = allocatedProtocol();
    const latestReport = Math.max(
        ...protocol.strategies.list().map((strategy) => strategy.accounting.lastReportAt),
    );
    const report = protocol.economicRisk.evaluate(
        {
            marketLossBps: 3_000n,
            liquidityHaircutBps: 2_000n,
            exitPenaltyShockBps: 1_000n,
            lossAlertBps: 2_000n,
            maximumReportAgeMs: 1_000,
        },
        latestReport + 1_001,
    );

    assert.equal(report.healthy, false);
    assert.ok(report.flags.includes("STRESS_LOSS_HIGH"));
    assert.ok(report.flags.includes("STRATEGY_REPORT_STALE"));
});

test("accounting drift is surfaced without mutating protocol state", () => {
    const protocol = allocatedProtocol();
    protocol.vault.revalueManaged(0n, 1n);

    const report = protocol.economicRisk.evaluate(DEFAULT_STRESS_SCENARIO, 100);

    assert.equal(report.accountingGap, 1n);
    assert.ok(report.flags.includes("ACCOUNTING_GAP"));
});

test("required idle capital follows the configured basis-point policy", () => {
    const protocol = allocatedProtocol();
    assert.equal(protocol.risk.requiredIdle(asset(800_000), bps(500)), asset(40_000));
});
