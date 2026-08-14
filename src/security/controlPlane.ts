import type { AxiomProtocol } from "../axiomProtocol.ts";
import { fail, normalizeId } from "../domain/errors.ts";
import type {
    AllocationRequest,
    AllocationResult,
    PerformanceReportRequest,
    PerformanceReportResult,
    RiskLimits,
} from "../domain/types.ts";

export type ControlRole = "governor" | "allocator" | "reporter" | "guardian";
export type ControlledAction = "allocation" | "reporting";

/**
 * Application boundary for privileged operations. The underlying protocol remains a domain engine;
 * services should expose this control plane rather than its mutable collaborators directly.
 */
export class AxiomControlPlane {
    readonly protocol: AxiomProtocol;
    #roles = new Map<ControlRole, Set<string>>();
    #paused = new Set<ControlledAction>();

    constructor(protocol: AxiomProtocol, bootstrapGovernor: string) {
        this.protocol = protocol;
        this.#roles.set("governor", new Set([normalizeId("governor", bootstrapGovernor)]));
        this.#roles.set("allocator", new Set());
        this.#roles.set("reporter", new Set());
        this.#roles.set("guardian", new Set());
    }

    hasRole(role: ControlRole, account: string): boolean {
        return this.#roles.get(role)?.has(normalizeId("account", account)) ?? false;
    }

    members(role: ControlRole): readonly string[] {
        return [...(this.#roles.get(role) ?? new Set())].sort();
    }

    grantRole(caller: string, role: ControlRole, account: string, timestamp = Date.now()): void {
        this.requireRole(caller, "governor");
        const member = normalizeId("account", account);
        this.#roles.get(role)?.add(member);
        this.protocol.events.emit(
            "control.role-granted",
            { caller: normalizeId("caller", caller), role, account: member },
            timestamp,
        );
    }

    revokeRole(caller: string, role: ControlRole, account: string, timestamp = Date.now()): void {
        this.requireRole(caller, "governor");
        const member = normalizeId("account", account);
        const members = this.#roles.get(role);
        if (role === "governor" && members?.has(member) && members.size === 1) {
            fail("LAST_GOVERNOR", "cannot revoke the final governor", { account: member });
        }
        members?.delete(member);
        this.protocol.events.emit(
            "control.role-revoked",
            { caller: normalizeId("caller", caller), role, account: member },
            timestamp,
        );
    }

    pause(caller: string, action: ControlledAction, timestamp = Date.now()): void {
        this.requireAnyRole(caller, ["guardian", "governor"]);
        this.#paused.add(action);
        this.protocol.events.emit(
            "control.pause-changed",
            { caller: normalizeId("caller", caller), action, paused: true },
            timestamp,
        );
    }

    unpause(caller: string, action: ControlledAction, timestamp = Date.now()): void {
        this.requireRole(caller, "governor");
        this.#paused.delete(action);
        this.protocol.events.emit(
            "control.pause-changed",
            { caller: normalizeId("caller", caller), action, paused: false },
            timestamp,
        );
    }

    isPaused(action: ControlledAction): boolean {
        return this.#paused.has(action);
    }

    allocate(caller: string, request: AllocationRequest): AllocationResult {
        this.requireActive("allocation");
        this.requireAnyRole(caller, ["allocator", "governor"]);
        return this.protocol.allocate(request);
    }

    report(caller: string, request: PerformanceReportRequest): PerformanceReportResult {
        this.requireActive("reporting");
        const strategy = this.protocol.strategies.read(request.strategyId);
        const operator = normalizeId("caller", caller);
        if (
            operator !== strategy.policy.strategist &&
            !this.hasRole("reporter", operator) &&
            !this.hasRole("governor", operator)
        ) {
            fail("UNAUTHORIZED_REPORTER", "caller cannot report this strategy", {
                caller: operator,
                strategy: strategy.id,
            });
        }
        return this.protocol.report(request);
    }

    updateRiskLimits(
        caller: string,
        partial: Partial<RiskLimits>,
        timestamp = Date.now(),
    ): RiskLimits {
        this.requireRole(caller, "governor");
        const next = this.protocol.risk.update(partial);
        this.protocol.events.emit(
            "risk.limit-updated",
            { caller: normalizeId("caller", caller), fields: Object.keys(partial).sort() },
            timestamp,
        );
        return next;
    }

    private requireActive(action: ControlledAction): void {
        if (this.#paused.has(action)) {
            fail("ACTION_PAUSED", "controlled action is paused", { action });
        }
    }

    private requireRole(caller: string, role: ControlRole): void {
        if (!this.hasRole(role, caller)) {
            fail("MISSING_ROLE", "caller does not hold the required role", {
                caller: normalizeId("caller", caller),
                role,
            });
        }
    }

    private requireAnyRole(caller: string, roles: readonly ControlRole[]): void {
        if (!roles.some((role) => this.hasRole(role, caller))) {
            fail("MISSING_ROLE", "caller does not hold an accepted role", {
                caller: normalizeId("caller", caller),
                roles: roles.join(","),
            });
        }
    }
}
