import test from "node:test";
import assert from "node:assert/strict";
import { asset } from "../../src/domain/amount.ts";
import { allocatedProtocol } from "../../src/simulation/fixtures.ts";
import { runLossScenario } from "../../src/simulation/scenarios.ts";
import { assertVaultReconciles } from "../helpers/assertions.ts";

test("strategy losses reduce managed NAV without minting fee shares", () => {
    const protocol = allocatedProtocol();
    const [positionId] = protocol.strategies.read("eth-range-beta").positions;
    const pool = protocol.pools.poolForPosition(positionId!);
    pool.recordLoss(positionId!, asset(24_000), 30);

    const beforeSupply = protocol.vault.totalShares();
    const report = protocol.report({
        strategyId: "eth-range-beta",
        timestamp: 31,
        note: "range inventory update",
    });

    assert.ok(report.realizedLoss > asset(20_000));
    assert.equal(report.feeAssets, 0n);
    assert.equal(report.feeShares, 0n);
    assert.equal(protocol.vault.totalShares(), beforeSupply);
    assert.ok(protocol.vault.totalAssets() < asset(800_000));
    assertVaultReconciles(protocol);
});

test("published loss scenario records lower NAV", () => {
    const result = runLossScenario();
    const [report] = result.reports;

    assert.equal(result.name, "losses");
    assert.ok(report!.adjustedValue < report!.reportedValue);
    assert.ok(result.snapshot.vault.totalAssets < asset(800_000));
});
