import test from "node:test";
import assert from "node:assert/strict";
import { asset, bps } from "../../src/domain/amount.ts";
import { AxiomProtocol } from "../../src/axiomProtocol.ts";
import {
    allocatedProtocol,
    defaultRiskLimits,
    defaultVaultConfig,
} from "../../src/simulation/fixtures.ts";
import { runWithdrawalScenario } from "../../src/simulation/scenarios.ts";
import { assertVaultReconciles } from "../helpers/assertions.ts";

test("idle withdrawals burn shares and return proportional assets", () => {
    const protocol = allocatedProtocol();
    const bobShares = protocol.vault.balanceOf("bob");
    const preview = protocol.vault.previewRedeem(bobShares / 2n);
    const cashBefore = protocol.accounts.balanceOf("bob");
    const result = protocol.withdraw({
        account: "bob",
        shares: bobShares / 2n,
        timestamp: 50,
    });

    assert.equal(result.source, "idle");
    assert.equal(result.assetsOut, preview);
    assert.equal(protocol.accounts.balanceOf("bob"), cashBefore + result.assetsOut);
    assert.equal(protocol.vault.balanceOf("bob"), bobShares - result.burnedShares);
    assertVaultReconciles(protocol);
});

test("large withdrawals can recall managed liquidity", () => {
    const protocol = allocatedProtocol();
    const aliceShares = protocol.vault.balanceOf("alice");
    const stablePositions = protocol.strategies.read("stable-range-alpha").positions;
    for (const positionId of stablePositions) {
        protocol.pools.poolForPosition(positionId).accrueFees(positionId, bps(100), 60);
    }
    protocol.report({ strategyId: "stable-range-alpha", timestamp: 61 });

    const result = protocol.withdraw({
        account: "alice",
        shares: aliceShares,
        timestamp: 62,
    });

    assert.notEqual(result.source, "idle");
    assert.ok(result.assetsOut > asset(390_000));
    assert.equal(protocol.vault.balanceOf("alice"), 0n);
    assertVaultReconciles(protocol);
});

test("published withdrawal scenario emits a withdrawal result", () => {
    const result = runWithdrawalScenario();
    const [withdrawal] = result.withdrawals;

    assert.equal(result.name, "withdrawals");
    assert.ok(withdrawal!.assetsOut > 0n);
    assert.ok(result.snapshot.vault.totalShares < asset(800_000));
});

test("partial withdrawals use the vault withdrawal policy", () => {
    const protocol = new AxiomProtocol({
        vault: { ...defaultVaultConfig, maxWithdrawalBps: bps(4_000) },
        risk: defaultRiskLimits,
    });
    protocol.seedAccount("alice", asset(400_000));
    protocol.seedAccount("bob", asset(400_000));
    protocol.deposit("alice", asset(400_000), 1);
    protocol.deposit("bob", asset(400_000), 2);

    assert.throws(() => protocol.withdrawAll("alice", 3));
});
