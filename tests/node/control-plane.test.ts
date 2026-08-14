import assert from "node:assert/strict";
import test from "node:test";

import { asset } from "../../src/domain/amount.ts";
import { AxiomControlPlane } from "../../src/security/controlPlane.ts";
import { allocatedProtocol, fundedProtocol } from "../../src/simulation/fixtures.ts";

test("governance grants bounded operational roles", () => {
    const protocol = fundedProtocol();
    const controls = new AxiomControlPlane(protocol, "governor");
    controls.grantRole("governor", "allocator", "allocator-east", 10);

    const allocation = controls.allocate("allocator-east", {
        strategyId: "stable-range-alpha",
        poolId: "curve-usdc-usdt",
        rangeId: "stable-tight",
        amount: asset(50_000),
        timestamp: 11,
    });

    assert.equal(allocation.amount, asset(50_000));
    assert.deepEqual(controls.members("allocator"), ["allocator-east"]);
    assert.throws(() =>
        controls.allocate("unknown-operator", {
            strategyId: "stable-range-alpha",
            poolId: "curve-usdc-usdt",
            rangeId: "stable-tight",
            amount: asset(50_000),
            timestamp: 12,
        }),
    );
});

test("guardians pause operations while governors control recovery", () => {
    const protocol = fundedProtocol();
    const controls = new AxiomControlPlane(protocol, "governor");
    controls.grantRole("governor", "guardian", "guardian", 20);
    controls.grantRole("governor", "allocator", "allocator", 20);
    controls.pause("guardian", "allocation", 21);

    assert.equal(controls.isPaused("allocation"), true);
    assert.throws(() =>
        controls.allocate("allocator", {
            strategyId: "stable-range-alpha",
            poolId: "curve-usdc-usdt",
            rangeId: "stable-tight",
            amount: asset(50_000),
            timestamp: 22,
        }),
    );

    controls.unpause("governor", "allocation", 23);
    assert.equal(controls.isPaused("allocation"), false);
});

test("strategy owners and delegated reporters can submit reports", () => {
    const protocol = allocatedProtocol();
    const controls = new AxiomControlPlane(protocol, "governor");

    const ownerReport = controls.report("strategist-alpha", {
        strategyId: "stable-range-alpha",
        timestamp: 30,
    });
    assert.equal(ownerReport.strategyId, "stable-range-alpha");

    controls.grantRole("governor", "reporter", "reporter-service", 31);
    const delegatedReport = controls.report("reporter-service", {
        strategyId: "eth-range-beta",
        timestamp: 32,
    });
    assert.equal(delegatedReport.strategyId, "eth-range-beta");
});

test("the final governor cannot be removed", () => {
    const controls = new AxiomControlPlane(fundedProtocol(), "governor");
    assert.throws(() => controls.revokeRole("governor", "governor", "governor"));
});
