import test from "node:test";
import assert from "node:assert/strict";
import { asset, bps } from "../../src/domain/amount.ts";
import { allocatedProtocol } from "../../src/simulation/fixtures.ts";
import { runFeeScenario } from "../../src/simulation/scenarios.ts";
import { assertVaultReconciles } from "../helpers/assertions.ts";

test("positive strategy reports mint performance fee shares", () => {
    const protocol = allocatedProtocol();
    const positions = protocol.strategies.read("stable-range-alpha").positions;
    for (const positionId of positions) {
        protocol.pools.poolForPosition(positionId).accrueFees(positionId, bps(650), 20);
    }

    const beforeStrategistShares = protocol.vault.balanceOf("strategist-alpha");
    const report = protocol.report({
        strategyId: "stable-range-alpha",
        timestamp: 21,
        note: "stable venue fee report",
    });

    assert.ok(report.grossGain > asset(20_000));
    assert.ok(report.feeAssets > 0n);
    assert.ok(report.feeShares > 0n);
    assert.ok(protocol.vault.balanceOf("strategist-alpha") > beforeStrategistShares);
    assert.equal(
        protocol.strategies.read("stable-range-alpha").accounting.cumulativeFees,
        report.feeAssets,
    );
    assertVaultReconciles(protocol);
});

test("published fee scenario exposes aggregate accounting", () => {
    const result = runFeeScenario();
    const [report] = result.reports;

    assert.equal(result.name, "fees");
    assert.ok(report!.feeAssets > 0n);
    assert.ok(result.snapshot.vault.totalAssets > asset(800_000));
    assert.ok(result.snapshot.strategies.some((strategy) => strategy.cumulativeFees > 0n));
});
