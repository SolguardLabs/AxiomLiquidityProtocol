import { EventLog } from "./domain/events.ts";
import type {
    AccountId,
    AllocationRequest,
    AllocationResult,
    AssetAmount,
    DepositResult,
    PerformanceReportRequest,
    PerformanceReportResult,
    PoolConfig,
    ProtocolSnapshot,
    RiskLimits,
    StrategyDraft,
    StrategyState,
    VaultConfig,
    WithdrawalRequest,
    WithdrawalResult,
} from "./domain/types.ts";
import { AccountBook } from "./state/accountBook.ts";
import { PoolRegistry } from "./adapters/poolRegistry.ts";
import { PerformanceFeePolicy } from "./fees/performanceFees.ts";
import { ProtocolLens } from "./reporting/lens.ts";
import { RiskController } from "./risk/riskController.ts";
import { AxiomAllocator } from "./services/allocator.ts";
import { AxiomReporter } from "./services/reporter.ts";
import { WithdrawalService } from "./services/withdrawals.ts";
import { StrategyBook } from "./strategies/strategyBook.ts";
import { AxiomVault } from "./vault/vaultLedger.ts";

export interface AxiomProtocolConfig {
    readonly vault: VaultConfig;
    readonly risk: RiskLimits;
}

export class AxiomProtocol {
    readonly accounts: AccountBook;
    readonly events: EventLog;
    readonly vault: AxiomVault;
    readonly strategies: StrategyBook;
    readonly pools: PoolRegistry;
    readonly risk: RiskController;
    readonly fees: PerformanceFeePolicy;
    readonly allocator: AxiomAllocator;
    readonly reporter: AxiomReporter;
    readonly withdrawals: WithdrawalService;
    readonly lens: ProtocolLens;

    constructor(config: AxiomProtocolConfig) {
        this.accounts = new AccountBook();
        this.events = new EventLog();
        this.risk = new RiskController(config.risk);
        this.vault = new AxiomVault(config.vault, this.events);
        this.strategies = new StrategyBook();
        this.pools = new PoolRegistry();
        this.fees = new PerformanceFeePolicy(config.risk.maxStrategistFeeBps);
        this.allocator = new AxiomAllocator({
            vault: this.vault,
            strategies: this.strategies,
            pools: this.pools,
            risk: this.risk,
            events: this.events,
        });
        this.reporter = new AxiomReporter({
            vault: this.vault,
            strategies: this.strategies,
            pools: this.pools,
            risk: this.risk,
            fees: this.fees,
            events: this.events,
        });
        this.withdrawals = new WithdrawalService({
            vault: this.vault,
            allocator: this.allocator,
            risk: this.risk,
            events: this.events,
        });
        this.lens = new ProtocolLens({
            vault: this.vault,
            strategies: this.strategies,
            pools: this.pools,
            events: this.events,
        });
    }

    registerAccount(id: AccountId, label = id): void {
        this.accounts.register(id, label);
        this.events.emit("account.registered", { account: id, label });
    }

    seedAccount(id: AccountId, amount: AssetAmount, label = id): void {
        this.accounts.register(id, label);
        this.accounts.credit(id, amount);
    }

    registerPool(config: PoolConfig): void {
        this.risk.validatePool(config);
        this.pools.register(config);
        this.events.emit("pool.created", {
            poolId: config.id,
            kind: config.kind,
            liquidityDepth: config.liquidityDepth,
            exitPenaltyBps: config.exitPenaltyBps,
        });
    }

    createStrategy(draft: StrategyDraft): StrategyState {
        const strategy = this.strategies.create(draft, {
            performanceFeeBps: this.vault.config.performanceFeeBps,
        });
        this.risk.validateStrategy(strategy);
        this.events.emit("strategy.created", {
            strategyId: strategy.id,
            strategist: strategy.policy.strategist,
            feeRecipient: strategy.policy.feeRecipient,
            performanceFeeBps: strategy.policy.performanceFeeBps,
        });
        for (const range of strategy.ranges) {
            this.events.emit("strategy.range-added", {
                strategyId: strategy.id,
                rangeId: range.id,
                lowerTick: range.lowerTick,
                upperTick: range.upperTick,
                targetWeightBps: range.targetWeightBps,
            });
        }
        return strategy;
    }

    deposit(account: AccountId, amount: AssetAmount, timestamp = Date.now()): DepositResult {
        this.accounts.debit(account, amount);
        return this.vault.deposit(account, amount, timestamp);
    }

    allocate(request: AllocationRequest): AllocationResult {
        return this.allocator.allocate(request);
    }

    report(request: PerformanceReportRequest): PerformanceReportResult {
        return this.reporter.report(request);
    }

    withdraw(request: WithdrawalRequest): WithdrawalResult {
        const result = this.withdrawals.withdraw(request);
        this.accounts.credit(request.account, result.assetsOut);
        return result;
    }

    withdrawAll(account: AccountId, timestamp = Date.now()): WithdrawalResult {
        const result = this.withdrawals.withdrawAll(account, timestamp);
        this.accounts.credit(account, result.assetsOut);
        return result;
    }

    snapshot(): ProtocolSnapshot {
        return this.lens.snapshot();
    }
}
