import assert from "node:assert/strict";
import { asset } from "../../src/domain/amount.ts";
import type { AxiomProtocol } from "../../src/axiomProtocol.ts";

export function assertVaultReconciles(protocol: AxiomProtocol): void {
    const snapshot = protocol.snapshot();
    assert.equal(
        snapshot.vault.totalAssets,
        snapshot.vault.idleAssets + snapshot.vault.managedAssets,
    );
    const accountAssets = snapshot.vault.accounts.reduce(
        (total, account) => total + account.assets,
        0n,
    );
    assert.ok(accountAssets <= snapshot.vault.totalAssets);
    assert.ok(snapshot.vault.totalShares > 0n);
}

export function assertStrategyValue(
    protocol: AxiomProtocol,
    strategyId: string,
    minimum: bigint,
): void {
    const strategy = protocol.snapshot().strategies.find((entry) => entry.id === strategyId);
    assert.ok(strategy, `missing strategy ${strategyId}`);
    assert.ok(strategy.accountedValue >= minimum);
}

export function assertCloseAssets(
    actual: bigint,
    expected: bigint,
    tolerance = asset("0.000010"),
): void {
    const diff = actual > expected ? actual - expected : expected - actual;
    assert.ok(diff <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}
