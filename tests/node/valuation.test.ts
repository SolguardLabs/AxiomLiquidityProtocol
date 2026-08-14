import assert from "node:assert/strict";
import test from "node:test";

import { bps } from "../../src/domain/amount.ts";
import { allocatedProtocol } from "../../src/simulation/fixtures.ts";

test("report valuation exposes confidence for observable pool states", () => {
    const protocol = allocatedProtocol();
    const strategy = protocol.strategies.read("stable-range-alpha");
    const quote = protocol.reporter.quote(strategy.id);
    const valuation = protocol.reporter.valuation.resolve(
        strategy.accounting.accountedValue,
        { strategyId: strategy.id, timestamp: 20 },
        quote,
    );

    assert.equal(valuation.quality, "estimated");
    assert.ok(valuation.confidenceBps < bps(10_000));
    assert.ok(valuation.confidenceBps > bps(9_000));
    assert.ok(valuation.adjustedValue <= valuation.reportedValue);
});

test("reports without positions are classified as unavailable", () => {
    const protocol = allocatedProtocol();
    const quote = protocol.pools.quoteStrategy("empty", []);
    const valuation = protocol.reporter.valuation.resolve(
        0n,
        { strategyId: "empty", timestamp: 30 },
        quote,
    );

    assert.equal(valuation.quality, "unavailable");
    assert.equal(valuation.adjustedValue, 0n);
    assert.equal(valuation.confidenceBps, 0n);
});
