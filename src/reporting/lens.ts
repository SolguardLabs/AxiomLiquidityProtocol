import { ZERO, formatAsset, formatShares, ratioBps } from "../domain/amount.ts";
import type {
    AccountId,
    AssetAmount,
    PoolSnapshot,
    ProtocolSnapshot,
    ShareSnapshot,
    StrategySnapshot,
    VaultSnapshot,
} from "../domain/types.ts";
import { EventLog } from "../domain/events.ts";
import { PoolRegistry } from "../adapters/poolRegistry.ts";
import { StrategyBook } from "../strategies/strategyBook.ts";
import { AxiomVault } from "../vault/vaultLedger.ts";

export interface AccountLine {
    readonly account: AccountId;
    readonly shares: string;
    readonly assets: string;
    readonly shareBps: bigint;
}

export interface NavBreakdown {
    readonly idle: AssetAmount;
    readonly managed: AssetAmount;
    readonly total: AssetAmount;
    readonly strategyCount: number;
    readonly poolCount: number;
}

export class ProtocolLens {
    readonly vault: AxiomVault;
    readonly strategies: StrategyBook;
    readonly pools: PoolRegistry;
    readonly events: EventLog;

    constructor(input: {
        vault: AxiomVault;
        strategies: StrategyBook;
        pools: PoolRegistry;
        events: EventLog;
    }) {
        this.vault = input.vault;
        this.strategies = input.strategies;
        this.pools = input.pools;
        this.events = input.events;
    }

    snapshot(): ProtocolSnapshot {
        const vault = this.vault.snapshot();
        return {
            vault,
            strategies: this.strategies.snapshots(vault.totalAssets),
            pools: this.pools.snapshots(),
            events: this.events.count(),
        };
    }

    vaultSnapshot(): VaultSnapshot {
        return this.vault.snapshot();
    }

    strategySnapshots(): StrategySnapshot[] {
        return this.strategies.snapshots(this.vault.totalAssets());
    }

    poolSnapshots(): PoolSnapshot[] {
        return this.pools.snapshots();
    }

    nav(): NavBreakdown {
        return {
            idle: this.vault.idleAssets(),
            managed: this.vault.managedAssets(),
            total: this.vault.totalAssets(),
            strategyCount: this.strategies.list().length,
            poolCount: this.pools.pools().length,
        };
    }

    accounts(): AccountLine[] {
        return this.vault
            .snapshot()
            .accounts.map((account) => this.formatAccountLine(account))
            .sort((a, b) => (b.shareBps < a.shareBps ? -1 : b.shareBps > a.shareBps ? 1 : 0));
    }

    exposureByPool(): { poolId: string; accountedBps: bigint; principal: AssetAmount }[] {
        const total = this.vault.totalAssets();
        return this.pools.snapshots().map((pool) => ({
            poolId: pool.id,
            accountedBps: total === ZERO ? ZERO : ratioBps(pool.totalPrincipal, total),
            principal: pool.totalPrincipal,
        }));
    }

    strategyById(id: string): StrategySnapshot | undefined {
        return this.strategySnapshots().find((strategy) => strategy.id === id);
    }

    renderSummary(): string {
        const snapshot = this.snapshot();
        const lines = [
            `AxiomLiquidityProtocol`,
            `NAV ${formatAsset(snapshot.vault.totalAssets)} ${snapshot.vault.asset}`,
            `Idle ${formatAsset(snapshot.vault.idleAssets)}`,
            `Managed ${formatAsset(snapshot.vault.managedAssets)}`,
            `Shares ${formatShares(snapshot.vault.totalShares)}`,
            `Strategies ${snapshot.strategies.length}`,
            `Pools ${snapshot.pools.length}`,
            `Events ${snapshot.events}`,
        ];
        for (const strategy of snapshot.strategies) {
            lines.push(
                `- ${strategy.id}: value=${formatAsset(strategy.accountedValue)} principal=${formatAsset(
                    strategy.principal,
                )} fees=${formatAsset(strategy.cumulativeFees)}`,
            );
        }
        return lines.join("\n");
    }

    private formatAccountLine(account: ShareSnapshot): AccountLine {
        return {
            account: account.account,
            shares: formatShares(account.shares),
            assets: formatAsset(account.assets),
            shareBps: account.shareBps,
        };
    }
}
