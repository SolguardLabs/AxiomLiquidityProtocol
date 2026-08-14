import test from "node:test";
import assert from "node:assert/strict";
import { AxiomError } from "../../src/domain/errors.ts";
import { asset, bps } from "../../src/domain/amount.ts";
import { AxiomProtocol } from "../../src/axiomProtocol.ts";
import {
    allocatedProtocol,
    defaultPools,
    defaultRiskLimits,
    defaultVaultConfig,
    ethStrategyDraft,
    fundedProtocol,
    stableStrategyDraft,
} from "../../src/simulation/fixtures.ts";
import { assertStrategyValue, assertVaultReconciles } from "../helpers/assertions.ts";

test("strategists allocate idle deposits into configured external pools", () => {
    const protocol = allocatedProtocol();
    const snapshot = protocol.snapshot();

    assert.equal(snapshot.vault.idleAssets, asset(260_000));
    assert.equal(snapshot.vault.managedAssets, asset(540_000));
    assert.equal(
        snapshot.pools.reduce((total, pool) => total + pool.openPositions, 0),
        3,
    );
    assertStrategyValue(protocol, "stable-range-alpha", asset(380_000));
    assertStrategyValue(protocol, "eth-range-beta", asset(160_000));
    assertVaultReconciles(protocol);
});

test("allocation respects strategy pool allowlists", () => {
    const protocol = fundedProtocol();
    assert.throws(
        () =>
            protocol.allocate({
                strategyId: "stable-range-alpha",
                poolId: "axiom-eth-usdc",
                rangeId: "stable-tight",
                amount: asset(25_000),
            }),
        (error) => error instanceof AxiomError && error.code === "POOL_NOT_ALLOWED",
    );
});

test("allocation preserves the vault minimum idle buffer", () => {
    const protocol = new AxiomProtocol({
        vault: { ...defaultVaultConfig, minIdleBps: bps(5_000) },
        risk: defaultRiskLimits,
    });
    for (const pool of defaultPools) protocol.registerPool(pool);
    protocol.createStrategy(stableStrategyDraft());
    protocol.createStrategy(ethStrategyDraft());
    protocol.seedAccount("treasury", asset(800_000));
    protocol.deposit("treasury", asset(800_000), 1);

    assert.throws(
        () =>
            protocol.allocate({
                strategyId: "stable-range-alpha",
                poolId: "curve-usdc-usdt",
                rangeId: "stable-tight",
                amount: asset(400_001),
                timestamp: 2,
            }),
        (error) => error instanceof AxiomError && error.code === "IDLE_BUFFER_BREACHED",
    );
});
