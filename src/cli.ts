import { formatAsset, formatShares } from "./domain/amount.ts";
import { runScenario, scenarioNames } from "./simulation/scenarios.ts";

const requested = process.argv[2] ?? "fees";
if (!scenarioNames.includes(requested as (typeof scenarioNames)[number])) {
    console.error(`Unknown scenario "${requested}". Available: ${scenarioNames.join(", ")}`);
    process.exit(1);
}

const result = runScenario(requested);
const { snapshot } = result;

console.log(`Scenario: ${result.name}`);
console.log(`NAV: ${formatAsset(snapshot.vault.totalAssets)} ${snapshot.vault.asset}`);
console.log(`Idle: ${formatAsset(snapshot.vault.idleAssets)}`);
console.log(`Managed: ${formatAsset(snapshot.vault.managedAssets)}`);
console.log(`Shares: ${formatShares(snapshot.vault.totalShares)}`);
console.log("");

console.log("Accounts");
for (const account of snapshot.vault.accounts) {
    console.log(
        `- ${account.account}: ${formatShares(account.shares)} shares / ${formatAsset(account.assets)}`,
    );
}

console.log("");
console.log("Strategies");
for (const strategy of snapshot.strategies) {
    console.log(
        `- ${strategy.id}: value=${formatAsset(strategy.accountedValue)} principal=${formatAsset(
            strategy.principal,
        )} fees=${formatAsset(strategy.cumulativeFees)} losses=${formatAsset(strategy.cumulativeLosses)}`,
    );
}

if (result.reports.length > 0) {
    console.log("");
    console.log("Reports");
    for (const report of result.reports) {
        console.log(
            `- ${report.strategyId}: reported=${formatAsset(report.reportedValue)} adjusted=${formatAsset(
                report.adjustedValue,
            )} feeAssets=${formatAsset(report.feeAssets)} feeShares=${formatShares(report.feeShares)}`,
        );
    }
}

if (result.withdrawals.length > 0) {
    console.log("");
    console.log("Withdrawals");
    for (const withdrawal of result.withdrawals) {
        console.log(
            `- ${withdrawal.account}: burned=${formatShares(withdrawal.burnedShares)} assets=${formatAsset(
                withdrawal.assetsOut,
            )} source=${withdrawal.source}`,
        );
    }
}
