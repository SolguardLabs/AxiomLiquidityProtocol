import test from "node:test";
import assert from "node:assert/strict";
import { asset } from "../../src/domain/amount.ts";
import { createDefaultProtocol, fundedProtocol } from "../../src/simulation/fixtures.ts";
import { assertCloseAssets, assertVaultReconciles } from "../helpers/assertions.ts";

test("initial deposits mint proportional vault shares", () => {
    const protocol = createDefaultProtocol();
    const alice = protocol.deposit("alice", asset(400_000), 1);
    const bob = protocol.deposit("bob", asset(100_000), 2);

    assert.equal(alice.shares, asset(400_000));
    assert.equal(bob.shares, asset(100_000));
    assert.equal(protocol.vault.totalAssets(), asset(500_000));
    assert.equal(protocol.vault.totalShares(), asset(500_000));
    assertCloseAssets(
        protocol.vault.previewRedeem(protocol.vault.balanceOf("alice")),
        asset(400_000),
    );
    assertVaultReconciles(protocol);
});

test("later depositors enter at the current share price", () => {
    const protocol = fundedProtocol();
    protocol.allocate({
        strategyId: "stable-range-alpha",
        poolId: "curve-usdc-usdt",
        rangeId: "stable-tight",
        amount: asset(200_000),
        timestamp: 10,
    });
    const [positionId] = protocol.strategies.read("stable-range-alpha").positions;
    protocol.pools.poolForPosition(positionId!).accrueFees(positionId!, 500n, 11);
    protocol.report({ strategyId: "stable-range-alpha", timestamp: 12 });

    protocol.seedAccount("dave", asset(100_000), "Dave LP");
    const beforeAssets = protocol.vault.totalAssets();
    const beforeShares = protocol.vault.totalShares();
    const deposit = protocol.deposit("dave", asset(100_000), 13);

    assert.ok(beforeAssets > beforeShares);
    assert.ok(deposit.shares < asset(100_000));
    assert.equal(protocol.vault.totalAssets(), beforeAssets + asset(100_000));
    assertVaultReconciles(protocol);
});
